/**
 * Food part of the assistant (services/assistant.ts): validating the agent's food items,
 * deciding whether a food is already in the database, creating new products and writing
 * the diary — so matching stays deterministic and duplicate-free. The agent only
 * understands the text and researches nutrition facts.
 */
import type { Food } from '@prisma/client';
import { prisma } from '../../db.js';
import { parseServings, searchLocalFoods } from './foodSearch.js';
import { normalizeSearch, round1, scaleMacros, searchStems, sumMacros, type Macros } from './nutritionMath.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABEL: Record<Meal, string> = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', snack: 'перекус' };

/** The agent sometimes answers "обед" instead of "lunch" — accept both. */
export function toMeal(v: unknown): Meal | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if ((MEALS as readonly string[]).includes(s)) return s as Meal;
  const ru = (Object.entries(MEAL_LABEL) as [Meal, string][]).find(([, label]) => s.startsWith(label.slice(0, 4)));
  return ru ? ru[0] : null;
}

/** Meal by the Moscow clock. */
export function mealByTimeMsk(): Meal {
  const h = new Date(Date.now() + 3 * 3_600_000).getUTCHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

// ─── Agent contract (food part) ───────────────────────────────────────────────

export interface AgentItem {
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

/** Food rules of the system prompt; the JSON shape is described by the assistant. */
export const FOOD_PROMPT = `Еда. Для каждого продукта или блюда из записи:
1. Определи название, место покупки и съеденный вес в граммах. Если вес не указан — возьми вес упаковки/порции этого конкретного товара или блюда, иначе обычную порцию. Штуки, ложки, упаковки переводи в граммы.
2. Если продукт есть в списке «Мои продукты» (совпадают название и магазин) — укажи его id в own_food_id и возьми КБЖУ оттуда.
3. Иначе найди КБЖУ на 100 г: для товаров магазинов и блюд ресторанов — поиском в интернете по названию и месту (сайт магазина или ресторана, меню, calorizator, fatsecret); для домашней или простой еды — по типичным значениям. Если нашёл страницу товара — дай ссылку в source_url.

Работай быстро: продукты из «Моих продуктов» не ищи в интернете, на остальные — не больше 1–2 поисков на позицию; если точных данных нет, бери типичные значения для такого блюда.

Составное блюдо, где пользователь перечислил ингредиенты с весами, разбивай на ингредиенты; блюдо без весов ингредиентов — одной позицией. Не выдумывай продукты, которых нет в тексте.

meal — приём пищи, если он назван в тексте: строго одно из "breakfast", "lunch", "dinner", "snack" (завтрак, обед, ужин, перекус), иначе null. day_offset — 0, или -1 если пользователь пишет про вчера. store — null, если место не указано и не очевидно.`;

export const FOOD_ITEM_EXAMPLE =
  '{"name":"Удон с курицей терияки","store":"Яндекс Лавка","grams":400,"own_food_id":null,"kcal_per_100g":153,"protein_per_100g":7.8,"fat_per_100g":5.3,"carbs_per_100g":18.8,"source_url":null}';

export function num(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Drop items with missing or implausible numbers; returns the reason for each dropped one. */
export function validateFoodItems(raw: unknown): { items: AgentItem[]; skipped: string[] } {
  const items: AgentItem[] = [];
  const skipped: string[] = [];
  for (const it of Array.isArray(raw) ? (raw as Partial<AgentItem>[]) : []) {
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
      name,
      grams,
      kcal_per_100g: macros[0]!,
      protein_per_100g: macros[1]!,
      fat_per_100g: macros[2]!,
      carbs_per_100g: macros[3]!,
      store: typeof it.store === 'string' && it.store.trim() ? it.store.trim().slice(0, 60) : null,
      own_food_id: num(it.own_food_id),
      source_url: typeof it.source_url === 'string' && /^https?:\/\//.test(it.source_url) ? it.source_url.slice(0, 500) : null,
    });
  }
  return { items, skipped };
}

/** "Мои продукты" list for the prompt + the foods by id (for the own_food_id hint). */
export async function ownFoodsForPrompt(userId: number): Promise<{ list: string; byId: Map<number, Food> }> {
  const ownFoods = await prisma.food.findMany({ where: { ownerId: userId }, orderBy: { usageCount: 'desc' }, take: 200 });
  const list = ownFoods.length
    ? ownFoods
        .map((f) => {
          const s = parseServings(f.servings).map((x) => `${x.label}=${x.grams}г`).join(', ');
          return `${f.id}: ${f.name}${f.brand ? ` (${f.brand})` : ''} — ${f.kcal} ккал, Б${f.protein} Ж${f.fat} У${f.carbs} на 100 г${s ? ` [${s}]` : ''}`;
        })
        .join('\n')
    : '(пусто)';
  return { list, byId: new Map(ownFoods.map((f) => [f.id, f])) };
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

async function createFood(userId: number, it: AgentItem): Promise<{ food: Food; created: boolean }> {
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
  const before = await prisma.food.findUnique({ where: { source_externalId: { source: 'llm', externalId } }, select: { id: true } });
  const food = await prisma.food.upsert({
    where: { source_externalId: { source: 'llm', externalId } },
    update: data,
    create: { ...data, source: 'llm', externalId },
  });
  return { food, created: !before };
}

// ─── Writing ──────────────────────────────────────────────────────────────────

export interface LoggedItem extends Macros {
  entryId: number;
  foodId: number;
  name: string;
  brand: string | null;
  grams: number;
  status: 'existing' | 'new';
}

export interface FoodLogResult {
  date: string;
  meal: Meal;
  items: LoggedItem[];
  totals: Macros;
  skipped: string[];
}

/**
 * Writes the items into (date, meal). `createdFoodIds` = products this call created
 * (an undo removes them when unused); `usedFoodIds` = every food whose usageCount was bumped.
 */
export async function logFoodItems(
  userId: number,
  items: AgentItem[],
  date: string,
  meal: Meal,
  own: Map<number, Food>,
): Promise<{ logged: LoggedItem[]; createdFoodIds: number[] }> {
  const dateObj = new Date(date + 'T00:00:00.000Z');
  const logged: LoggedItem[] = [];
  const createdFoodIds: number[] = [];
  for (const it of items) {
    const existing = await findExisting(userId, it, own);
    let food: Food;
    if (existing) food = existing;
    else {
      const c = await createFood(userId, it);
      food = c.food;
      if (c.created) createdFoodIds.push(food.id);
    }

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
  return { logged, createdFoodIds };
}

/** Removes diary entries written by an assistant message and the products it created (unless something else uses them now). */
export async function undoFoodLog(userId: number, items: LoggedItem[], createdFoodIds: number[]): Promise<void> {
  await prisma.foodLogEntry.deleteMany({ where: { userId, id: { in: items.map((i) => i.entryId) } } });
  for (const i of items) {
    if (createdFoodIds.includes(i.foodId)) continue;
    await prisma.food.updateMany({ where: { id: i.foodId, usageCount: { gt: 0 } }, data: { usageCount: { decrement: 1 } } });
  }
  for (const foodId of createdFoodIds) {
    const used = await prisma.foodLogEntry.count({ where: { foodId } });
    if (used === 0) await prisma.food.deleteMany({ where: { id: foodId, ownerId: userId } });
  }
}

export function totalsOf(items: LoggedItem[]): Macros {
  return sumMacros(items);
}

export function fmtNum(n: number, digits = 0): string {
  return n.toFixed(digits).replace('.', ',');
}

/** «🍽 …» section for the bot. `today` = local YYYY-MM-DD. */
export function formatFood(r: FoodLogResult, today: string): string[] {
  const yesterday = new Date(new Date(today + 'T00:00:00.000Z').getTime() - 86_400_000).toISOString().slice(0, 10);
  const when = r.date === today ? 'сегодня' : r.date === yesterday ? 'вчера' : r.date;
  const lines = [`🍽 ${MEAL_LABEL[r.meal][0]!.toUpperCase()}${MEAL_LABEL[r.meal].slice(1)} (${when}):`];
  for (const i of r.items) {
    lines.push(
      `• ${i.name}${i.brand ? ` (${i.brand})` : ''} — ${fmtNum(i.grams)} г, ${fmtNum(i.kcal)} ккал${i.status === 'new' ? ' · 🆕 добавил в базу' : ''}`,
    );
  }
  if (r.items.length > 1) {
    lines.push(`Итого: ${fmtNum(r.totals.kcal)} ккал · Б ${fmtNum(r.totals.protein)} · Ж ${fmtNum(r.totals.fat)} · У ${fmtNum(r.totals.carbs)}`);
  } else if (r.items.length === 1) {
    lines.push(`Б ${fmtNum(r.totals.protein)} · Ж ${fmtNum(r.totals.fat)} · У ${fmtNum(r.totals.carbs)}`);
  }
  return lines;
}
