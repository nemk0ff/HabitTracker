/**
 * "Добавить текстом" via the developer's Hermes agent.
 *
 * The agent only understands the text and researches nutrition facts; the
 * tracker's code decides whether the food is already in the database, creates
 * new products and writes the diary — so matching stays deterministic and
 * duplicate-free. Agent calls take minutes, so every request runs as an
 * in-memory background job that the Mini App polls and the bot awaits.
 */
import { randomUUID } from 'crypto';
import type { Food } from '@prisma/client';
import { prisma } from '../../db.js';
import { track } from '../analytics.js';
import { HermesError, extractJson, hermesChat } from '../hermes.js';
import { parseServings, searchLocalFoods } from './foodSearch.js';
import { normalizeSearch, round1, scaleMacros, searchStems, sumMacros, type Macros } from './nutritionMath.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

const MEAL_LABEL: Record<Meal, string> = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', snack: 'перекус' };

/** The agent sometimes answers "обед" instead of "lunch" — accept both. */
function toMeal(v: unknown): Meal | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if ((MEALS as readonly string[]).includes(s)) return s as Meal;
  const ru = (Object.entries(MEAL_LABEL) as [Meal, string][]).find(([, label]) => s.startsWith(label.slice(0, 4)));
  return ru ? ru[0] : null;
}
const JOB_TTL_MS = 24 * 3_600_000;

// ─── Agent contract ───────────────────────────────────────────────────────────

interface AgentItem {
  name: string;
  store: string | null;
  grams: number;
  own_food_id: number | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  source_url: string | null;
}

interface AgentReply {
  items: AgentItem[];
  meal: Meal | null;
  day_offset: number;
}

const SYSTEM_PROMPT = `Ты помогаешь вести дневник питания. Пользователь пишет, что съел, иногда — где (магазин, ресторан, доставка) и сколько.

Для каждого продукта или блюда из записи:
1. Определи название, место покупки и съеденный вес в граммах. Если вес не указан — возьми вес упаковки/порции этого конкретного товара или блюда, иначе обычную порцию. Штуки, ложки, упаковки переводи в граммы.
2. Если продукт есть в списке «Мои продукты» (совпадают название и магазин) — укажи его id в own_food_id и возьми КБЖУ оттуда.
3. Иначе найди КБЖУ на 100 г: для товаров магазинов и блюд ресторанов — поиском в интернете по названию и месту (сайт магазина или ресторана, меню, calorizator, fatsecret); для домашней или простой еды — по типичным значениям. Если нашёл страницу товара — дай ссылку в source_url.

Работай быстро: продукты из «Моих продуктов» не ищи в интернете, на остальные — не больше 1–2 поисков на позицию; если точных данных нет, бери типичные значения для такого блюда.

Составное блюдо, где пользователь перечислил ингредиенты с весами, разбивай на ингредиенты; блюдо без весов ингредиентов — одной позицией. Не выдумывай продукты, которых нет в тексте.

meal — приём пищи, если он назван в тексте: строго одно из "breakfast", "lunch", "dinner", "snack" (завтрак, обед, ужин, перекус), иначе null. day_offset — 0, или -1 если пользователь пишет про вчера.

Ответь ТОЛЬКО JSON-объектом, без пояснений:
{"items":[{"name":"Удон с курицей терияки","store":"Яндекс Лавка","grams":400,"own_food_id":null,"kcal_per_100g":153,"protein_per_100g":7.8,"fat_per_100g":5.3,"carbs_per_100g":18.8,"source_url":null}],"meal":null,"day_offset":0}
store — null, если место не указано и не очевидно.`;

function num(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Drop items with missing or implausible numbers; returns the reason for each dropped one. */
function validate(reply: AgentReply): { items: AgentItem[]; skipped: string[] } {
  const items: AgentItem[] = [];
  const skipped: string[] = [];
  for (const it of Array.isArray(reply?.items) ? reply.items : []) {
    const name = typeof it?.name === 'string' ? it.name.trim().slice(0, 120) : '';
    const grams = num(it?.grams);
    const macros = [it?.kcal_per_100g, it?.protein_per_100g, it?.fat_per_100g, it?.carbs_per_100g].map(num);
    if (!name) continue;
    if (grams === null || grams <= 0 || grams > 5000) {
      skipped.push(`${name}: непонятный вес`);
      continue;
    }
    if (macros.some((m) => m === null || m < 0) || macros[0]! > 950 || macros.slice(1).some((m) => m! > 100)) {
      skipped.push(`${name}: не удалось определить КБЖУ`);
      continue;
    }
    items.push({
      ...it,
      name,
      grams,
      store: typeof it.store === 'string' && it.store.trim() ? it.store.trim().slice(0, 60) : null,
      own_food_id: num(it.own_food_id),
      source_url: typeof it.source_url === 'string' && /^https?:\/\//.test(it.source_url) ? it.source_url.slice(0, 500) : null,
    });
  }
  return { items, skipped };
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/** "Лавка" matches brand "Яндекс Лавка", "Пятерочка" matches "Пятёрочка". */
function storeMatches(brand: string | null, store: string): boolean {
  if (!brand) return false;
  const b = normalizeSearch(brand);
  const stems = searchStems(normalizeSearch(store));
  return stems.length > 0 && stems.every((s) => b.includes(s));
}

/**
 * Existing food for an agent item, or null if it must be created:
 * the agent's own_food_id hint → the user's own product (same store when one
 * is named) → a generic catalog food (only when no store is named).
 */
async function findExisting(userId: number, it: AgentItem, own: Map<number, Food>): Promise<Food | null> {
  const hinted = it.own_food_id !== null ? own.get(it.own_food_id) : undefined;
  if (hinted && (!it.store || storeMatches(hinted.brand, it.store))) return hinted;

  const candidates = await searchLocalFoods(userId, it.name);
  const mine = candidates.find((f) => f.ownerId === userId && (!it.store || storeMatches(f.brand, it.store)));
  if (mine) return mine;
  if (it.store) return null; // a store-specific product shouldn't fall back to a generic catalog entry
  return candidates.find((f) => f.source === 'seed') ?? null;
}

async function createFood(userId: number, it: AgentItem): Promise<Food> {
  const externalId = `agent:${normalizeSearch(it.name)}|${normalizeSearch(it.store ?? '')}`;
  const data = {
    ownerId: userId,
    name: it.name,
    brand: it.store,
    searchName: normalizeSearch(`${it.name} ${it.store ?? ''}`),
    sourceUrl: it.source_url,
    kcal: round1(it.kcal_per_100g),
    protein: round1(it.protein_per_100g),
    fat: round1(it.fat_per_100g),
    carbs: round1(it.carbs_per_100g),
    servings: JSON.stringify([{ label: 'порция', grams: round1(it.grams) }]),
  };
  return prisma.food.upsert({
    where: { source_externalId: { source: 'llm', externalId } },
    update: data,
    create: { ...data, source: 'llm', externalId },
  });
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export interface LoggedItem extends Macros {
  entryId: number;
  foodId: number;
  name: string;
  brand: string | null;
  grams: number;
  status: 'existing' | 'new';
}

export interface TextLogResult {
  date: string;
  meal: Meal;
  items: LoggedItem[];
  totals: Macros;
  skipped: string[];
}

interface Job {
  id: string;
  userId: number;
  status: 'running' | 'done' | 'error' | 'undone';
  result?: TextLogResult;
  error?: string;
  createdFoodIds: number[];
  createdAt: number;
}

const jobs = new Map<string, Job>();

function mskNow(): Date {
  return new Date(Date.now() + 3 * 3_600_000);
}

function mealByTimeMsk(): Meal {
  const h = mskNow().getUTCHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function shiftDay(date: string, days: number): string {
  return new Date(new Date(date + 'T00:00:00.000Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function run(job: Job, text: string, opts: { date?: string; meal?: Meal }): Promise<TextLogResult> {
  const { userId } = job;
  const ownFoods = await prisma.food.findMany({ where: { ownerId: userId }, orderBy: { usageCount: 'desc' }, take: 200 });
  const ownList = ownFoods.length
    ? ownFoods
        .map((f) => {
          const s = parseServings(f.servings).map((x) => `${x.label}=${x.grams}г`).join(', ');
          return `${f.id}: ${f.name}${f.brand ? ` (${f.brand})` : ''} — ${f.kcal} ккал, Б${f.protein} Ж${f.fat} У${f.carbs} на 100 г${s ? ` [${s}]` : ''}`;
        })
        .join('\n')
    : '(пусто)';

  const reply = extractJson<AgentReply>(
    await hermesChat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Мои продукты (id: название (магазин) — КБЖУ):\n${ownList}\n\nЗапись:\n${text}` },
    ]),
  );
  const { items, skipped } = validate(reply);
  if (items.length === 0) {
    throw new HermesError(skipped.length ? `Не получилось записать: ${skipped.join('; ')}` : 'Агент не нашёл в тексте еды');
  }

  const today = mskNow().toISOString().slice(0, 10);
  const dayOffset = Math.max(-7, Math.min(0, Math.round(num(reply.day_offset) ?? 0)));
  const date = opts.date ?? shiftDay(today, dayOffset);
  const meal: Meal = toMeal(reply.meal) ?? opts.meal ?? mealByTimeMsk();
  const dateObj = new Date(date + 'T00:00:00.000Z');
  const ownById = new Map(ownFoods.map((f) => [f.id, f]));

  const logged: LoggedItem[] = [];
  for (const it of items) {
    const existing = await findExisting(userId, it, ownById);
    const food = existing ?? (await createFood(userId, it));
    if (!existing) job.createdFoodIds.push(food.id);

    const m = scaleMacros(food, it.grams);
    const entry = await prisma.foodLogEntry.create({
      data: { userId, date: dateObj, meal, foodId: food.id, name: food.name, grams: round1(it.grams), source: 'llm', ...m },
    });
    await prisma.food.update({ where: { id: food.id }, data: { usageCount: { increment: 1 } } });
    logged.push({
      entryId: entry.id,
      foodId: food.id,
      name: food.name,
      brand: food.brand,
      grams: entry.grams,
      ...m,
      status: existing ? 'existing' : 'new',
    });
  }

  track({
    userId,
    event: 'food_agent_logged',
    category: 'miniapp',
    metadata: { items: logged.length, new: job.createdFoodIds.length, skipped: skipped.length },
  });
  return { date, meal, items: logged, totals: sumMacros(logged), skipped };
}

/** Starts a background job; resolves with the job id immediately. */
export function startTextLog(userId: number, text: string, opts: { date?: string; meal?: Meal } = {}): Job {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);

  const job: Job = { id: randomUUID(), userId, status: 'running', createdFoodIds: [], createdAt: now };
  jobs.set(job.id, job);
  run(job, text, opts)
    .then((result) => {
      job.result = result;
      job.status = 'done';
    })
    .catch((e) => {
      job.status = 'error';
      job.error = e instanceof HermesError ? e.message : 'Не удалось записать — ошибка на сервере';
      if (!(e instanceof HermesError)) console.error('[text-log] failed:', e);
    });
  return job;
}

export function getJob(userId: number, id: string): Job | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

/** Resolves when the job leaves the running state (for the bot, which has no polling client). */
export async function waitForJob(job: Job): Promise<Job> {
  while (job.status === 'running') await new Promise((r) => setTimeout(r, 1000));
  return job;
}

/** Removes the job's diary entries and the products it created (unless something else uses them now). */
export async function undoJob(userId: number, id: string): Promise<boolean> {
  const job = getJob(userId, id);
  if (!job || job.status !== 'done' || !job.result) return false;
  await prisma.foodLogEntry.deleteMany({ where: { userId, id: { in: job.result.items.map((i) => i.entryId) } } });
  for (const foodId of job.createdFoodIds) {
    const used = await prisma.foodLogEntry.count({ where: { foodId } });
    if (used === 0) await prisma.food.deleteMany({ where: { id: foodId, ownerId: userId } });
  }
  job.status = 'undone';
  track({ userId, event: 'food_agent_undone', category: 'miniapp' });
  return true;
}

export function jobView(job: Job) {
  return { id: job.id, status: job.status, result: job.result ?? null, error: job.error ?? null };
}

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits).replace('.', ',');
}

/** Plain-text summary for the bot. */
export function formatResult(r: TextLogResult): string {
  const today = mskNow().toISOString().slice(0, 10);
  const when = r.date === today ? 'сегодня' : r.date === shiftDay(today, -1) ? 'вчера' : r.date;
  const lines = [`✅ Записал в ${MEAL_LABEL[r.meal]} (${when}):`];
  for (const i of r.items) {
    lines.push(
      `• ${i.name}${i.brand ? ` (${i.brand})` : ''} — ${fmt(i.grams)} г, ${fmt(i.kcal)} ккал${i.status === 'new' ? ' · 🆕 добавил в базу' : ''}`,
    );
  }
  lines.push(`Итого: ${fmt(r.totals.kcal)} ккал · Б ${fmt(r.totals.protein)} · Ж ${fmt(r.totals.fat)} · У ${fmt(r.totals.carbs)}`);
  for (const s of r.skipped) lines.push(`⚠️ ${s}`);
  return lines.join('\n');
}
