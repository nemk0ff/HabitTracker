/**
 * The owner's text assistant (plan «Этап 2. Hermes как главный интерфейс»): one free-text
 * message from the bot or the Mini App («Текстом») can log food, weight, sleep and habits
 * and ask a question. Simple messages («вес 70,5», «спал 7», «лёг 1:30 встал 8», «сделал
 * зарядку») are parsed offline by regex; everything else goes to the Hermes agent, which only
 * turns the text into JSON — this code decides what to write. Every write is recorded so one
 * «↩️ Отменить» restores exactly what was there before.
 *
 * Agent calls take minutes, so each message runs as an in-memory background job (lost on
 * restart) that the Mini App polls and the bot awaits.
 */
import { randomUUID } from 'crypto';
import type { Food, Habit } from '@prisma/client';
import { prisma } from '../db.js';
import { track } from './analytics.js';
import { HermesError, extractJson, hermesChat, type ChatMessage } from './hermes.js';
import {
  countTarget,
  datesByHabit,
  dayDate,
  formatStreak,
  habitStreak,
  isDone,
  isValidEntryValue,
  setHabitEntry,
  skippedByHabit,
  addDays,
  weekStats,
} from './habitStats.js';
import { setSleepEntry, isHHMM } from './sleep.js';
import { computePlan } from './nutrition/model.js';
import {
  FOOD_ITEM_EXAMPLE,
  FOOD_PROMPT,
  fmtNum,
  formatFood,
  logFoodItems,
  mealByTimeMsk,
  num,
  ownFoodsForPrompt,
  toMeal,
  totalsOf,
  undoFoodLog,
  validateFoodItems,
  type FoodLogResult,
  type LoggedItem,
  type Meal,
} from './nutrition/textLog.js';
import { getWeight, isValidWeight, setWeight, deleteWeight } from './nutrition/weight.js';

const JOB_TTL_MS = 24 * 3_600_000;
const DEFAULT_TZ_OFFSET = -180; // Moscow

// ─── Agent contract ───────────────────────────────────────────────────────────

export interface AgentHabit {
  name: string;
  done?: boolean;
  value?: number;
  skip?: boolean;
}

export interface AgentSleep {
  bed?: string;
  wake?: string;
  hours?: number;
}

/** What the agent (or the offline parser) extracted from one message. `items` = the old food-only answer. */
export interface AssistantReply {
  food?: unknown[];
  items?: unknown[];
  meal?: unknown;
  day_offset?: unknown;
  weight?: { kg?: unknown } | null;
  sleep?: AgentSleep | null;
  habits?: AgentHabit[] | null;
  question?: string | null;
}

function systemPrompt(today: string, habits: Habit[]): string {
  const habitList = habits.length
    ? habits
        .map((h) => {
          const kind =
            h.measure === 'hours' ? 'часы' : h.measure === 'count' ? `количество, цель ${countTarget(h)} в день` : 'сделал/не сделал';
          return `- ${h.name} (${kind})`;
        })
        .join('\n')
    : '(нет)';
  return `Ты — личный ассистент: ведёшь дневник питания, веса, сна и привычек одного человека. Сегодня ${today}. Он пишет одно сообщение в свободной форме; разложи его по разделам. Записывает в базу не ты, а программа по твоему JSON.

${FOOD_PROMPT}

Вес — если указан вес тела: {"kg": 70.5}, иначе null.

Сон — если написано, когда лёг и встал: {"bed":"01:30","wake":"08:00"} (24-часовой формат HH:MM; «встал в 8» = "08:00"); если только сколько спал: {"hours": 7.5}; иначе null. Ночь относится к дню подъёма.

Привычки — только из этого списка, name пиши точно как в списке:
${habitList}
Для каждой упомянутой: {"name":"Зарядка","done":true}; для количества или часов — {"name":"Вода","value":8} (часы — числом часов); «сегодня не делаю / выходной / пропуск» — {"name":"…","skip":true}; «не сделал / отмени» — {"name":"…","done":false}. Сон не дублируй в привычках.

Вопрос — если человек о чём-то спрашивает (сколько съел, сколько осталось, как идёт фаза, серии и т.п.), перепиши вопрос в question, но НЕ отвечай на него: ответ подготовит программа по фактам из базы. Иначе null.

Ничего не выдумывай: разделы, которых нет в тексте, оставляй пустыми ([] или null). Интернет нужен только для КБЖУ еды.

Ответь ТОЛЬКО JSON-объектом, без пояснений:
{"food":[${FOOD_ITEM_EXAMPLE}],"meal":null,"day_offset":0,"weight":null,"sleep":null,"habits":[],"question":null}`;
}

const ANSWER_PROMPT = `Ты — личный ассистент по питанию, весу, сну и привычкам. Ответь на вопрос человека коротко (1–4 предложения, по-русски, на «ты»), опираясь ТОЛЬКО на факты из базы ниже. Ничего не ищи в интернете и не выдумывай цифр. Если фактов не хватает — так и скажи.`;

// ─── Text normalization / habit matching ──────────────────────────────────────

/** lower-case, ё→е, trimmed, collapsed whitespace. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** «зарядка» → «зарядку» (сделал зарядку): the last word in the accusative, for the simplest endings. */
function accusative(n: string): string {
  if (n.endsWith('а')) return n.slice(0, -1) + 'у';
  if (n.endsWith('я')) return n.slice(0, -1) + 'ю';
  return n;
}

export type HabitMatch = { habit: Habit } | { error: string };

/** Exact → startsWith → contains; ambiguous or none → an error for the reply. */
export function matchHabit(name: string, habits: Habit[]): HabitMatch {
  const q = normalizeName(name);
  if (!q) return { error: 'пустое имя привычки' };
  const names = habits.map((h) => ({ habit: h, n: normalizeName(h.name) }));
  const levels: ((n: string) => boolean)[] = [
    (n) => n === q || accusative(n) === q,
    (n) => n.startsWith(q) || q.startsWith(n),
    (n) => n.includes(q) || q.includes(n),
  ];
  for (const test of levels) {
    const hits = names.filter((x) => test(x.n));
    if (hits.length === 1) return { habit: hits[0]!.habit };
    if (hits.length > 1) return { error: `не понял, какую привычку «${name}» отметить: ${hits.map((x) => x.habit.name).join(', ')}` };
  }
  return { error: `не нашёл привычку «${name}»` };
}

// ─── Offline parser ───────────────────────────────────────────────────────────

const END = '(?=$|[\\s,;.!?])';
const START = '(?:^|(?<=[\\s,;.!?]))';
const TIME = '(\\d{1,2})(?:[:.](\\d{2}))?';

function hhmm(h: string | undefined, m: string | undefined): string | null {
  const hh = Number(h);
  const mm = m === undefined ? 0 : Number(m);
  if (!Number.isInteger(hh) || hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const decimal = (s: string) => Number(s.replace(',', '.'));

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface OfflineParse {
  reply: AssistantReply;
  /** Text the regexes didn't understand (empty = the whole message was parsed). */
  rest: string;
}

/**
 * Regex parse of the simple messages: weight, sleep (hours or bed/wake), habits by exact name
 * («сделал зарядку», «зарядка ✓»). Never guesses food.
 */
export function parseOffline(text: string, habits: Pick<Habit, 'name'>[]): OfflineParse {
  let t = ' ' + normalizeName(text) + ' ';
  const reply: AssistantReply = {};
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    t = t.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      return fn(m) ? ' ' : (m[0] as string);
    });
  };

  // «лёг 1:30 встал 8» / «лег в 01:30, встал в 08:00»
  take(
    new RegExp(`${START}(?:лег|легла|уснул|уснула)\\s+(?:в\\s+)?${TIME}\\s*[,;]?\\s*(?:и\\s+|а\\s+)?(?:встал|встала|проснулся|проснулась)\\s+(?:в\\s+)?${TIME}(?:\\s*ч(?:ас(?:а|ов)?)?)?${END}`, 'g'),
    (m) => {
      const bed = hhmm(m[1], m[2]);
      const wake = hhmm(m[3], m[4]);
      if (!bed || !wake || reply.sleep) return false;
      reply.sleep = { bed, wake };
      return true;
    },
  );
  // «спал с 1:30 до 8»
  take(new RegExp(`${START}спал[аи]?\\s+с\\s+${TIME}\\s+до\\s+${TIME}${END}`, 'g'), (m) => {
    const bed = hhmm(m[1], m[2]);
    const wake = hhmm(m[3], m[4]);
    if (!bed || !wake || reply.sleep) return false;
    reply.sleep = { bed, wake };
    return true;
  });
  // «спал 7» / «спал 7,5 ч» / «спал 8 часов» / «спал 7 ч 30 мин» / «спал 450 минут»
  const MIN_UNIT = 'мин(?:ут[аы]?)?\\.?';
  take(
    new RegExp(
      `${START}спал[аи]?\\s+(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:(ч(?:ас(?:а|ов)?)?\\.?)(?:\\s*(\\d{1,2})\\s*${MIN_UNIT})?|(${MIN_UNIT}))?${END}`,
      'g',
    ),
    (m) => {
      const n = decimal(m[1]!);
      const hours = m[4] ? n / 60 : n + (m[3] ? Number(m[3]) / 60 : 0);
      if (!(hours > 0 && hours <= 16) || reply.sleep) return false;
      reply.sleep = { hours: Math.round(hours * 100) / 100 };
      return true;
    },
  );
  // «вес 70.5» / «вес: 70,5 кг» / «70,5 кг»
  const W = '(\\d{2,3}(?:[.,]\\d{1,2})?)';
  const onWeight = (m: RegExpMatchArray) => {
    const kg = decimal(m[1]!);
    if (!isValidWeight(kg) || reply.weight) return false;
    reply.weight = { kg };
    return true;
  };
  // Not a food weight: «вес 200 г», «вес 330 мл», «вес 70,5 г» (no backtracking into a partial number either).
  const NOT_FOOD_UNIT = '(?![.,]?\\d)(?!\\s*(?:г|гр|грамм(?:а|ов)?|мл|ккал)\\.?(?=$|[\\s,;.!?]))';
  take(new RegExp(`${START}(?:мой\\s+)?(?:вес|взвесил(?:ся|ась))\\s*:?\\s*${W}${NOT_FOOD_UNIT}(?:\\s*кг)?${END}`, 'g'), onWeight);
  take(new RegExp(`${START}${W}\\s*кг${END}`, 'g'), onWeight);

  // Habits — exact name (or its accusative) only.
  const DONE_AFTER = '(?:✓|✅|✔️?|☑️?|\\+|сделан[аоы]?|выполнен[аоы]?|готов[аоы]?)';
  for (const h of habits) {
    const n = normalizeName(h.name);
    if (!n) continue;
    const names = [...new Set([n, accusative(n)])].map(escapeRe).join('|');
    const mark = () => {
      if (reply.habits?.some((x) => x.name === h.name)) return true;
      (reply.habits ??= []).push({ name: h.name, done: true });
      return true;
    };
    take(new RegExp(`${START}(?:сделал[аи]?|выполнил[аи]?)\\s+(?:${names})${END}`, 'g'), mark);
    take(new RegExp(`${START}(?:${names})\\s*${DONE_AFTER}(?=$|[\\s,;.!?])`, 'g'), mark);
  }

  const rest = t
    .replace(/(^|\s)(и|а|еще|также|сегодня|утром)(?=\s|$)/g, ' ')
    .replace(/[\s,;.!]+/g, ' ')
    .trim();
  return { reply, rest };
}

function hasWrites(r: AssistantReply): boolean {
  const food = Array.isArray(r.food) ? r.food : Array.isArray(r.items) ? r.items : [];
  return food.length > 0 || !!r.weight || !!r.sleep || (r.habits?.length ?? 0) > 0;
}

// ─── Jobs / undo log ──────────────────────────────────────────────────────────

interface EntrySnapshot {
  value: number;
  skipped: boolean;
  startTime: string | null;
  endTime: string | null;
}

type UndoOp =
  | { kind: 'food'; items: LoggedItem[]; createdFoodIds: number[] }
  | { kind: 'weight'; date: string; prev: number | null }
  | { kind: 'habit'; habitId: number; date: string; prev: EntrySnapshot | null };

export interface HabitWrite {
  habitId: number;
  name: string;
  icon: string | null;
  action: 'done' | 'undone' | 'skip';
  /** Stored value (count, minutes for hours habits, level); null for a plain done/undone/skip. */
  value: number | null;
  measure: string | null;
}

export interface AssistantResult extends FoodLogResult {
  /** Local date the owner is in («today» for the reply wording). */
  today: string;
  weight: { kg: number; date: string } | null;
  sleep: { date: string; bed: string | null; wake: string | null; minutes: number } | null;
  habits: HabitWrite[];
  answer: string | null;
  /** «не нашёл привычку X» and similar. */
  notes: string[];
  /** Set when the agent was unreachable and only the offline-parsed part was written. */
  agentError: string | null;
}

export interface Job {
  id: string;
  userId: number;
  status: 'running' | 'done' | 'error' | 'undone';
  result?: AssistantResult;
  error?: string;
  undo: UndoOp[];
  createdAt: number;
}

const jobs = new Map<string, Job>();

/** Agent transport; the smoke script injects a mock. */
export type AgentFn = (messages: ChatMessage[]) => Promise<string>;

// ─── Context ──────────────────────────────────────────────────────────────────

function localToday(tzOffset: number | null): string {
  return new Date(Date.now() - (tzOffset ?? DEFAULT_TZ_OFFSET) * 60_000).toISOString().slice(0, 10);
}

async function loadContext(userId: number) {
  const [user, habits, goal] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { tzOffset: true } }),
    prisma.habit.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.nutritionGoal.findUnique({ where: { userId } }),
  ]);
  // Sleep goes to the goal's sleep habit; without one, to the only hours habit (if exactly one).
  let sleepHabit = goal?.sleepHabitId ? habits.find((h) => h.id === goal.sleepHabitId && h.measure === 'hours') : undefined;
  if (!sleepHabit && !goal?.sleepHabitId) {
    const hours = habits.filter((h) => h.measure === 'hours');
    if (hours.length === 1) sleepHabit = hours[0];
  }
  return { today: localToday(user?.tzOffset ?? null), habits, sleepHabit: sleepHabit ?? null };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

async function snapshotEntry(habitId: number, date: string): Promise<EntrySnapshot | null> {
  const e = await prisma.habitEntry.findUnique({ where: { habitId_date: { habitId, date: dayDate(date) } } });
  return e ? { value: e.value, skipped: e.skipped, startTime: e.startTime, endTime: e.endTime } : null;
}

// ─── Apply ────────────────────────────────────────────────────────────────────

async function applyHabit(job: Job, ctx: Context, item: AgentHabit, date: string, out: AssistantResult) {
  if (!item || typeof item.name !== 'string') return;
  const match = matchHabit(item.name, ctx.habits);
  if ('error' in match) {
    out.notes.push(match.error);
    return;
  }
  const h = match.habit;
  let value: number;
  let skipped = false;
  let action: HabitWrite['action'] = 'done';
  const v = num(item.value);
  if (item.skip === true) {
    value = 0;
    skipped = true;
    action = 'skip';
  } else if (item.done === false || v === 0) {
    value = 0;
    action = 'undone';
  } else if (v !== null && v > 0) {
    value = h.measure === 'hours' ? Math.round(v * 60) : h.measure === 'count' ? Math.round(v) : Math.min(4, Math.max(1, Math.round(v)));
  } else if (h.measure === 'hours') {
    out.notes.push(`«${h.name}»: сколько часов?`);
    return;
  } else {
    value = h.measure === 'count' ? countTarget(h) : 1;
  }
  if (!isValidEntryValue(h, value)) {
    out.notes.push(`«${h.name}»: непонятное значение`);
    return;
  }
  const prev = await snapshotEntry(h.id, date);
  await setHabitEntry(h, dayDate(date), value, skipped);
  if (h.measure === 'hours') {
    // A plain duration replaces any bed/wake span (undo restores the snapshot with them).
    await prisma.habitEntry.updateMany({ where: { habitId: h.id, date: dayDate(date) }, data: { startTime: null, endTime: null } });
  }
  job.undo.push({ kind: 'habit', habitId: h.id, date, prev });
  out.habits = out.habits.filter((x) => x.habitId !== h.id);
  out.habits.push({
    habitId: h.id,
    name: h.name,
    icon: h.icon,
    action,
    value: action === 'done' && (h.measure === 'count' || h.measure === 'hours' || (v !== null && v > 1)) ? value : null,
    measure: h.measure,
  });
}

async function apply(
  job: Job,
  reply: AssistantReply,
  ctx: Context,
  opts: { date?: string; meal?: Meal },
  agent: AgentFn | null,
  ownById: Map<number, Food> | null,
): Promise<AssistantResult> {
  const { userId } = job;
  const dayOffset = Math.max(-7, Math.min(0, Math.round(num(reply.day_offset) ?? 0)));
  const date = opts.date ?? addDays(ctx.today, dayOffset);
  const meal: Meal = toMeal(reply.meal) ?? opts.meal ?? mealByTimeMsk();
  const out: AssistantResult = {
    today: ctx.today,
    date,
    meal,
    items: [],
    totals: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    skipped: [],
    weight: null,
    sleep: null,
    habits: [],
    answer: null,
    notes: [],
    agentError: null,
  };

  // Food
  const { items, skipped } = validateFoodItems(Array.isArray(reply.food) ? reply.food : reply.items);
  out.skipped = skipped;
  if (items.length) {
    const own = ownById ?? (await ownFoodsForPrompt(userId)).byId;
    const { logged, createdFoodIds } = await logFoodItems(userId, items, date, meal, own);
    job.undo.push({ kind: 'food', items: logged, createdFoodIds });
    out.items = logged;
    out.totals = totalsOf(logged);
  }

  // Weight
  const kg = num(reply.weight?.kg);
  if (kg !== null) {
    if (isValidWeight(kg)) {
      const prev = await getWeight(userId, date);
      const w = await setWeight(userId, date, kg);
      job.undo.push({ kind: 'weight', date, prev });
      out.weight = { kg: w.weightKg, date };
    } else out.notes.push(`вес ${kg} кг не похож на правду — не записал`);
  }

  // Sleep
  if (reply.sleep && typeof reply.sleep === 'object') {
    const pad = (s: unknown) => (typeof s === 'string' ? (/^\d:\d{2}$/.test(s.trim()) ? `0${s.trim()}` : s.trim()) : undefined);
    const bed = pad(reply.sleep.bed);
    const wake = pad(reply.sleep.wake);
    const hours = num(reply.sleep.hours) ?? undefined;
    if (!ctx.sleepHabit) {
      out.notes.push('сон не записал: не выбрана привычка сна (Питание → Цель)');
    } else {
      const prev = await snapshotEntry(ctx.sleepHabit.id, date);
      const input = isHHMM(bed) && isHHMM(wake) ? { bed, wake } : { hours };
      const minutes = await setSleepEntry(ctx.sleepHabit.id, date, input);
      if (minutes === null) out.notes.push('не понял, сколько спал');
      else {
        job.undo.push({ kind: 'habit', habitId: ctx.sleepHabit.id, date, prev });
        out.sleep = { date, bed: 'bed' in input ? input.bed! : null, wake: 'wake' in input ? input.wake! : null, minutes };
      }
    }
  }

  // Habits
  for (const h of Array.isArray(reply.habits) ? reply.habits : []) {
    if (ctx.sleepHabit && typeof h?.name === 'string' && out.sleep && normalizeName(h.name) === normalizeName(ctx.sleepHabit.name)) continue;
    await applyHabit(job, ctx, h, date, out);
  }

  // Question — answered after the writes so the facts include them.
  const question = typeof reply.question === 'string' ? reply.question.trim() : '';
  if (question) {
    const facts = await buildFacts(userId, ctx);
    let answer: string | null = null;
    if (agent) {
      try {
        answer = (
          await agent([
            { role: 'system', content: ANSWER_PROMPT },
            { role: 'user', content: `Факты (${ctx.today}):\n${facts.join('\n')}\n\nВопрос: ${question.slice(0, 500)}` },
          ])
        ).trim();
      } catch (e) {
        if (!(e instanceof HermesError)) console.error('[assistant] answer failed:', e);
      }
    }
    out.answer = answer || facts.join('\n');
  }
  return out;
}

// ─── Facts for questions ──────────────────────────────────────────────────────

const ON_TRACK: Record<string, string> = { ahead: 'опережаешь план', on: 'идёшь по плану', behind: 'отстаёшь от плана' };

/** Plain-text facts about today (nutrition plan, weight trend, phase, sleep, habits). Also the template answer. */
export async function buildFacts(userId: number, ctx: Pick<Context, 'today' | 'habits'>): Promise<string[]> {
  const { today, habits } = ctx;
  const lines: string[] = [];
  const [plan, eaten, entries] = await Promise.all([
    computePlan(userId, today),
    prisma.foodLogEntry.aggregate({ where: { userId, date: dayDate(today) }, _sum: { kcal: true, protein: true } }),
    prisma.habitEntry.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: { gte: dayDate(addDays(today, -400)), lte: dayDate(today) } },
    }),
  ]);
  const kcal = Math.round(eaten._sum.kcal ?? 0);
  const protein = Math.round(eaten._sum.protein ?? 0);
  if (plan.todayKcal) {
    const left = plan.todayKcal - kcal;
    lines.push(`🍽 Сегодня съедено ${kcal} из ${plan.todayKcal} ккал (${left >= 0 ? `осталось ${left}` : `перебор ${-left}`})`);
  } else lines.push(`🍽 Сегодня съедено ${kcal} ккал (цель не задана)`);
  if (plan.proteinTarget) lines.push(`Белок ${protein} из ${Math.round(plan.proteinTarget)} г`);
  if (plan.phase) {
    const p = plan.phase;
    const rate = p.actualRateKgWeek !== null ? `, факт ${fmtNum(p.actualRateKgWeek, 2)} кг/нед` : '';
    const plannedRate = p.plannedRateKgWeek !== null ? ` при плане ${fmtNum(p.plannedRateKgWeek, 2)}` : '';
    const track = p.onTrack ? ` — ${ON_TRACK[p.onTrack]}` : '';
    lines.push(`🎯 Фаза: ${p.label}${p.daysLeft >= 0 ? `, осталось ${p.daysLeft} дн.` : ''}${rate}${plannedRate}${track}`);
  }
  if (plan.trendKg !== null) {
    const perWeek = plan.trendKgPerWeek !== null ? `, ${plan.trendKgPerWeek >= 0 ? '+' : ''}${fmtNum(plan.trendKgPerWeek, 2)} кг/нед` : '';
    const last = plan.lastWeightKg !== null ? `последний ${fmtNum(plan.lastWeightKg, 1)} кг, ` : '';
    lines.push(`⚖️ Вес: ${last}тренд ${fmtNum(plan.trendKg, 1)} кг${perWeek}`);
  }
  if (plan.sleepLastNightH !== null) {
    lines.push(`😴 Сон: ${fmtNum(plan.sleepLastNightH, 1)} ч${plan.sleepAvg7H !== null ? `, в среднем за неделю ${fmtNum(plan.sleepAvg7H, 1)} ч` : ''}`);
  }
  if (habits.length) {
    const done = datesByHabit(entries, habits);
    const skips = skippedByHabit(entries);
    const todayDone = habits.filter((h) => done.get(h.id)?.has(today));
    const todayOpen = habits.filter((h) => !done.get(h.id)?.has(today) && !skips.get(h.id)?.has(today));
    lines.push(
      `✅ Привычки сегодня: ${todayDone.length} из ${habits.length}` +
        (todayDone.length ? ` (${todayDone.map((h) => h.name).join(', ')})` : '') +
        (todayOpen.length ? `; не отмечены: ${todayOpen.map((h) => h.name).join(', ')}` : ''),
    );
    const streaks = habits
      .map((h) => ({ h, s: habitStreak(h, done.get(h.id) ?? new Set(), today, skips.get(h.id)) }))
      .filter((x) => x.s.count > 0)
      .map((x) => `${x.h.name} — ${formatStreak(x.s)}`);
    if (streaks.length) lines.push(`🔥 Серии: ${streaks.join(', ')}`);
    const week = weekStats(habits, done, today, skips);
    lines.push(`📅 Неделя: ${week.done} из ${week.target} отметок`);
  }
  return lines;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

/**
 * Agent fields win; habits the agent missed are added from the offline parse. Offline weight/sleep are
 * NOT merged: in a mixed message a number may belong to food («вес 200 г», «30 минут») — they are only
 * trusted on the fast path, where the regexes understood the whole message.
 */
function merge(agent: AssistantReply, offline: AssistantReply): AssistantReply {
  const habits = [...(Array.isArray(agent.habits) ? agent.habits : [])];
  for (const h of offline.habits ?? []) {
    if (!habits.some((x) => typeof x?.name === 'string' && normalizeName(x.name) === normalizeName(h.name))) habits.push(h);
  }
  return {
    ...agent,
    weight: agent.weight && num(agent.weight.kg) !== null ? agent.weight : null,
    sleep: agent.sleep && typeof agent.sleep === 'object' && Object.keys(agent.sleep).length ? agent.sleep : null,
    habits,
  };
}

async function run(job: Job, text: string, opts: { date?: string; meal?: Meal }, agent: AgentFn): Promise<AssistantResult> {
  const ctx = await loadContext(job.userId);
  const offline = parseOffline(text, ctx.habits);

  // Fast path: the regexes understood the whole message.
  if (!offline.rest && hasWrites(offline.reply)) {
    const result = await apply(job, offline.reply, ctx, opts, null, null);
    track({ userId: job.userId, event: 'assistant_logged', category: 'miniapp', metadata: { agent: false } });
    return result;
  }

  const own = await ownFoodsForPrompt(job.userId);
  let reply: AssistantReply;
  let agentError: string | null = null;
  try {
    reply = extractJson<AssistantReply>(
      await agent([
        { role: 'system', content: systemPrompt(ctx.today, ctx.habits) },
        { role: 'user', content: `Мои продукты (id: название (магазин) — КБЖУ):\n${own.list}\n\nЗапись:\n${text}` },
      ]),
    );
    if (!reply || typeof reply !== 'object') throw new HermesError('Агент ответил не в том формате');
    reply = merge(reply, offline.reply);
  } catch (e) {
    if (!(e instanceof HermesError)) throw e;
    const question = offline.rest.includes('?') ? text : null;
    // Only the habit marks: offline weight/sleep are trusted on the fast path only (see merge).
    const fallback: AssistantReply = { habits: offline.reply.habits ?? [] };
    if (!hasWrites(fallback) && !question) throw e;
    agentError = e.message;
    reply = { ...fallback, question };
  }

  const result = await apply(job, reply, ctx, opts, agentError ? null : agent, own.byId);
  result.agentError = agentError;
  if (!job.undo.length && !result.answer) {
    const why = [...result.skipped, ...result.notes];
    throw new HermesError(why.length ? `Не получилось записать: ${why.join('; ')}` : 'Агент не нашёл в тексте, что записать');
  }
  track({
    userId: job.userId,
    event: 'assistant_logged',
    category: 'miniapp',
    metadata: {
      agent: !agentError,
      food: result.items.length,
      weight: !!result.weight,
      sleep: !!result.sleep,
      habits: result.habits.length,
      question: !!result.answer,
    },
  });
  return result;
}

/** Starts a background job; returns it immediately. `agent` is injectable for the smoke script. */
export function startAssistant(
  userId: number,
  text: string,
  opts: { date?: string; meal?: Meal } = {},
  agent: AgentFn = hermesChat,
): Job {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);

  const job: Job = { id: randomUUID(), userId, status: 'running', undo: [], createdAt: now };
  jobs.set(job.id, job);
  run(job, text, opts, agent)
    .then((result) => {
      job.result = result;
      job.status = 'done';
    })
    .catch((e) => {
      job.status = 'error';
      job.error = e instanceof HermesError ? e.message : 'Не удалось записать — ошибка на сервере';
      if (!(e instanceof HermesError)) console.error('[assistant] failed:', e);
    });
  return job;
}

export function getJob(userId: number, id: string): Job | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

/** Resolves when the job leaves the running state (or after `timeoutMs`). */
export async function waitForJob(job: Job, timeoutMs = Infinity): Promise<Job> {
  const until = Date.now() + timeoutMs;
  while (job.status === 'running' && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  return job;
}

/** Restores everything the message wrote, newest first. */
export async function undoJob(userId: number, id: string): Promise<boolean> {
  const job = getJob(userId, id);
  if (!job || job.status !== 'done' || !job.undo.length) return false;
  job.status = 'undone';
  for (const op of [...job.undo].reverse()) {
    if (op.kind === 'food') await undoFoodLog(userId, op.items, op.createdFoodIds);
    else if (op.kind === 'weight') {
      if (op.prev === null) await deleteWeight(userId, op.date);
      else await setWeight(userId, op.date, op.prev);
    } else {
      const date = dayDate(op.date);
      if (op.prev === null) await prisma.habitEntry.deleteMany({ where: { habitId: op.habitId, date } });
      else {
        await prisma.habitEntry.upsert({
          where: { habitId_date: { habitId: op.habitId, date } },
          update: op.prev,
          create: { habitId: op.habitId, date, ...op.prev },
        });
      }
    }
  }
  track({ userId, event: 'assistant_undone', category: 'miniapp' });
  return true;
}

export function jobView(job: Job) {
  return {
    id: job.id,
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
    canUndo: job.status === 'done' && job.undo.length > 0,
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatHours(minutes: number): string {
  return fmtNum(Math.round((minutes / 60) * 10) / 10, 1).replace(/,0$/, '');
}

function habitLine(h: HabitWrite): string {
  const icon = h.icon ? `${h.icon} ` : '';
  if (h.action === 'skip') return `⏭ ${icon}${h.name} — пропуск`;
  if (h.action === 'undone') return `◻️ ${icon}${h.name} — отметка снята`;
  const value = h.value === null ? '' : h.measure === 'hours' ? ` — ${formatHours(h.value)} ч` : ` — ${h.value}`;
  return `✅ ${icon}${h.name}${value}`;
}

/** One message grouped by section, for the bot. */
export function formatAssistantResult(r: AssistantResult): string {
  const blocks: string[] = [];
  const wrote = r.items.length > 0 || !!r.weight || !!r.sleep || r.habits.length > 0;
  if (r.agentError) {
    blocks.push(wrote ? '⚠️ Агент сейчас недоступен — записал только то, что понял:' : '⚠️ Агент сейчас недоступен — вот факты из базы:');
  }
  if (r.items.length) blocks.push(formatFood(r, r.today).join('\n'));
  const short: string[] = [];
  if (r.weight) short.push(`⚖️ ${fmtNum(r.weight.kg, 1).replace(/,0$/, '')} кг`);
  if (r.sleep) {
    short.push(r.sleep.bed && r.sleep.wake ? `😴 ${r.sleep.bed}–${r.sleep.wake} · ${formatHours(r.sleep.minutes)} ч` : `😴 ${formatHours(r.sleep.minutes)} ч`);
  }
  for (const h of r.habits) short.push(habitLine(h));
  if (short.length) blocks.push(short.join('\n'));
  const warn = [...r.skipped, ...r.notes].map((s) => `⚠️ ${s}`);
  if (warn.length) blocks.push(warn.join('\n'));
  if (r.answer) blocks.push(`💬 ${r.answer}`);
  if (r.date !== r.today && short.length) blocks.push(`📅 Записано на ${r.date}`);
  return blocks.join('\n\n') || 'Ничего не записал';
}
