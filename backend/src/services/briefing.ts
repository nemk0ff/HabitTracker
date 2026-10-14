/**
 * Morning and evening briefings (iteration B, stage 3): two messages a day instead of the separate
 * sleep / weight / training / «всё записал?» prompts and the bare habit check-in.
 *
 * - Morning (`morningCheckinTime`, default 09:00): yesterday's kcal/protein vs plan and habits X/Y, today's
 *   plan (phase, training day), weight −0.5 / как вчера / +0.5, sleep bed–wake presets from the owner's
 *   usual schedule + «другое время» (Mini App), morning habit buttons.
 * - Evening (`checkinTime`): kcal/protein left, 1–2 favorite foods to close the protein gap, habit buttons,
 *   «тренировка была?» when the linked training habit isn't marked, «день записан полностью».
 *
 * Builders are pure (`buildMorningBriefing` / `buildEveningBriefing` over loaded data). Buttons: habits use
 * the check-in callbacks (`ci:<habitId>:…`), the nutrition answers `ci:<sl|wt|tr|dc>:…` — both handled in
 * `checkin.ts`, which re-renders the whole briefing after a tap. A trailing `:m` marks the morning message.
 */
import cron from 'node-cron';
import { prisma } from '../db.js';
import { track } from './analytics.js';
import { forEachSafe } from '../utils/safe.js';
import { sendToUser } from './messaging.js';
import { ownerWhere } from '../utils/owner.js';
import { addDays, datesByHabit, dayDate, isDone, skippedByHabit } from './habitStats.js';
import {
  checkinHabitsFor,
  footerRow,
  habitRows,
  loadUserHabits,
  localClock,
  morningTimeOf,
  weekLine,
  type CheckinEntry,
  type CheckinHabit,
  type CheckinKind,
  type CheckinMessage,
  type Keyboard,
} from './checkin.js';
import { computePlan, type PlanPhase } from './nutrition/model.js';
import { compactHHMM, fmtKg } from './nutrition/prompts.js';
import { isHHMM, sleepMinutes } from './sleep.js';
import { nearestGoalLine } from './dashboard.js';

const WEBAPP_URL = process.env.WEBAPP_URL || '';

// ─── Data shapes ──────────────────────────────────────────────────────────────

export interface DayTarget {
  kcal: number | null;
  protein: number | null;
}

export interface BedWake {
  bed: string;
  wake: string;
}

export interface MorningData {
  date: string;
  /** Null without a nutrition goal. */
  yesterday: { eatenKcal: number; eatenProtein: number; logged: boolean; target: DayTarget } | null;
  /** Null when no habit counted yesterday. */
  habitsYesterday: { done: number; total: number } | null;
  today: { target: DayTarget; isTrainingDay: boolean; phase: PlanPhase | null } | null;
  /** Morning habits (the sleep habit is asked separately). */
  habits: CheckinHabit[];
  entries: CheckinEntry[];
  /** Null without a goal. */
  weight: { todayKg: number | null; lastKg: number | null } | null;
  /** Null without a linked sleep habit. */
  sleep: { logged: { bed: string | null; wake: string | null; minutes: number } | null; presets: BedWake[] } | null;
  /** «🎯 …» summary of the active quarter goal with the nearest deadline. */
  goalLine?: string | null;
}

export interface ProteinSuggestion {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
}

export interface EveningData {
  date: string;
  /** Null without a nutrition goal. */
  nutrition: { target: DayTarget; eatenKcal: number; eatenProtein: number; logged: number; dayComplete: boolean } | null;
  suggestions: ProteinSuggestion[];
  habits: CheckinHabit[];
  entries: CheckinEntry[];
  /** Set when the linked training habit isn't marked (or skipped) today — the question is asked. */
  training: { habitId: number } | null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fmtMin = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const fmtH = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10).replace('.', ',');
const r0 = (n: number) => Math.round(n);

const DEFAULT_BED = 0; // 00:00
const DEFAULT_WAKE = 8 * 60;
const MIN_NIGHTS = 3;
const PRESET_STEP = 30;

/**
 * Three bed–wake presets: the median of the given nights (rounded to 30 min), then 30 min later and
 * 30 min earlier. Bed times are compared across midnight (23:30 < 01:00). Fewer than 3 nights → 00:00–08:00.
 */
export function sleepPresets(nights: { startTime: string | null; endTime: string | null }[]): BedWake[] {
  const valid = nights.filter((n) => isHHMM(n.startTime) && isHHMM(n.endTime)) as { startTime: string; endTime: string }[];
  let bed = DEFAULT_BED;
  let wake = DEFAULT_WAKE;
  if (valid.length >= MIN_NIGHTS) {
    // Bed before noon belongs to the night after midnight: shift it past 24:00 so the median works.
    bed = median(valid.map((n) => (toMin(n.startTime) < 12 * 60 ? toMin(n.startTime) + 1440 : toMin(n.startTime))));
    wake = median(valid.map((n) => toMin(n.endTime)));
  }
  const round = (m: number) => Math.round(m / PRESET_STEP) * PRESET_STEP;
  return [0, PRESET_STEP, -PRESET_STEP].map((d) => ({ bed: fmtMin(round(bed) + d), wake: fmtMin(round(wake) + d) }));
}

/** The kcal gap below which the day counts as closed (frontend utils/suggest.ts DONE_KCAL). */
const DONE_KCAL = 50;
const PROTEIN_MATTERS_G = 10;
const MAX_PORTIONS = 3;
const OVERSHOOT = 1.15;
const MIN_PROTEIN_GAIN_G = 5;

export interface SuggestFood {
  name: string;
  /** Per 100 g. */
  kcal: number;
  protein: number;
  /** First serving's grams, if the food has servings. */
  servingGrams: number | null;
}

/**
 * Simplified server port of the frontend «Что доесть»: favorites with the best protein per kcal, each with the
 * grams that close min(protein gap, kcal gap) — half-portion steps (10 g without servings), ≤ 3 portions.
 */
export function proteinSuggestions(foods: SuggestFood[], kcalLeft: number, proteinLeft: number, max = 2): ProteinSuggestion[] {
  if (proteinLeft <= PROTEIN_MATTERS_G || kcalLeft <= DONE_KCAL) return [];
  return foods
    .filter((f) => f.kcal > 0 && f.protein > 0)
    .map((f) => {
      const step = f.servingGrams ? f.servingGrams / 2 : 10;
      const portion = f.servingGrams ?? 100;
      const need = Math.min(proteinLeft / f.protein, kcalLeft / f.kcal) * 100;
      const grams = Math.min(Math.floor(need / step) * step, MAX_PORTIONS * portion);
      return { food: f, grams, kcal: (f.kcal * grams) / 100, protein: (f.protein * grams) / 100 };
    })
    .filter((s) => s.grams > 0 && s.kcal <= kcalLeft * OVERSHOOT && s.protein >= MIN_PROTEIN_GAIN_G)
    .sort((a, b) => b.food.protein / b.food.kcal - a.food.protein / a.food.kcal)
    .slice(0, max)
    .map((s) => ({ name: s.food.name, grams: r0(s.grams), kcal: r0(s.kcal), protein: r0(s.protein) }));
}

function phaseLine(p: PlanPhase): string {
  let line = `Фаза: ${p.label}`;
  if (p.daysLeft >= 0) line += ` · ещё ${p.daysLeft} дн.`;
  if (p.onTrack) line += p.onTrack === 'on' ? ' · по плану' : p.onTrack === 'ahead' ? ' · быстрее плана' : ' · отстаёшь от плана';
  return line;
}

const vsTarget = (eaten: number, target: number | null, unit: string) =>
  target ? `${r0(eaten)} / ${r0(target)} ${unit}` : `${r0(eaten)} ${unit}`;

const openRow = (text: string): Keyboard[number] => (WEBAPP_URL ? [{ text, web_app: { url: WEBAPP_URL } }] : []);

// ─── Builders (pure) ──────────────────────────────────────────────────────────

export function buildMorningBriefing(d: MorningData): CheckinMessage {
  const lines: string[] = ['☀️ Доброе утро!'];
  const block: string[] = [];
  if (d.yesterday) {
    const y = d.yesterday;
    block.push(
      y.logged
        ? `Вчера: ${vsTarget(y.eatenKcal, y.target.kcal, 'ккал')} · белок ${vsTarget(y.eatenProtein, y.target.protein, 'г')}`
        : 'Вчера: дневник пуст',
    );
  }
  if (d.habitsYesterday) block.push(`Привычки вчера: ${d.habitsYesterday.done} из ${d.habitsYesterday.total}`);
  if (block.length) lines.push('', ...block);

  if (d.today) {
    const t = d.today;
    const parts = [t.target.kcal ? `${r0(t.target.kcal)} ккал` : null, t.target.protein ? `белок ${r0(t.target.protein)} г` : null];
    if (t.isTrainingDay) parts.push('💪 тренировочный день');
    const plan = parts.filter(Boolean).join(' · ');
    lines.push('');
    if (plan) lines.push(`Сегодня: ${plan}`);
    if (t.phase) lines.push(phaseLine(t.phase));
  }
  if (d.goalLine) {
    if (!d.today) lines.push('');
    lines.push(d.goalLine);
  }

  const keyboard: Keyboard = [];
  const asks: string[] = [];
  if (d.weight) {
    const { todayKg, lastKg } = d.weight;
    if (todayKg !== null) asks.push(`⚖️ Вес: ${fmtKg(todayKg)} кг ✓`);
    else if (lastKg !== null) {
      asks.push(`⚖️ Вес утром? В прошлый раз ${fmtKg(lastKg)} кг`);
      keyboard.push(
        [lastKg - 0.5, lastKg, lastKg + 0.5].map((v) => {
          const kg = Math.round(v * 10) / 10;
          return { text: v === lastKg ? 'как вчера' : `${v < lastKg ? '−' : '+'}0,5 → ${fmtKg(kg)}`, callback_data: `ci:wt:${d.date}:${kg}:m` };
        }),
      );
    }
  }
  if (d.sleep) {
    const { logged, presets } = d.sleep;
    if (logged) {
      const span = logged.bed && logged.wake ? `${logged.bed}–${logged.wake} · ` : '';
      asks.push(`😴 Сон: ${span}${fmtH(logged.minutes)} ч ✓`);
    } else {
      asks.push('😴 Во сколько лёг и встал?');
      keyboard.push(
        presets.map((p) => ({
          text: `${p.bed}–${p.wake}`,
          callback_data: `ci:sl:${d.date}:${compactHHMM(p.bed)}-${compactHHMM(p.wake)}:m`,
        })),
      );
      keyboard.push(openRow('🕐 Другое время'));
    }
  }
  if (asks.length) lines.push('', ...asks);

  if (d.habits.length) {
    lines.push('', 'Утренние привычки:');
    keyboard.push(...habitRows(d.habits, d.entries, d.date, 'morning'));
  }
  keyboard.push(footerRow(d.date, d.habits.length > 0, ':m'));
  return { text: lines.join('\n'), keyboard: keyboard.filter((r) => r.length > 0) };
}

export function buildEveningBriefing(d: EveningData): CheckinMessage {
  const lines: string[] = ['🌙 Как прошёл день?'];
  const keyboard: Keyboard = [];
  const n = d.nutrition;
  if (n) {
    lines.push('');
    if (n.logged === 0) lines.push('🍽 В дневнике сегодня пусто — запиши, что ел');
    else {
      const left: string[] = [];
      if (n.target.kcal) {
        const gap = n.target.kcal - n.eatenKcal;
        left.push(gap >= 0 ? `осталось ${r0(gap)} ккал` : `перебор ${r0(-gap)} ккал`);
      }
      if (n.target.protein) {
        const gap = n.target.protein - n.eatenProtein;
        left.push(gap > 0 ? `белка ещё ${r0(gap)} г` : 'белок закрыт ✓');
      }
      lines.push(`🍽 Съедено ${vsTarget(n.eatenKcal, n.target.kcal, 'ккал')}${left.length ? ` — ${left.join(', ')}` : ''}`);
      if (d.suggestions.length) {
        lines.push('Добрать белок:');
        for (const s of d.suggestions) lines.push(`• ${s.name} — ${s.grams} г: +${s.protein} г белка, ${s.kcal} ккал`);
      }
    }
    if (n.dayComplete) lines.push('✅ День записан полностью');
  }
  const week = weekLine(d.habits, d.entries, d.date);
  if (week) lines.push('', week);

  keyboard.push(...habitRows(d.habits, d.entries, d.date, 'evening'));
  if (d.training) {
    keyboard.push([
      { text: '💪 Тренировка была', callback_data: `ci:tr:${d.date}:1` },
      { text: 'Отдых', callback_data: `ci:tr:${d.date}:0` },
    ]);
  }
  if (n && n.logged > 0 && !n.dayComplete) {
    keyboard.push([{ text: '✅ День записан полностью', callback_data: `ci:dc:${d.date}` }]);
  }
  keyboard.push(footerRow(d.date, d.habits.length > 0));
  return { text: lines.join('\n'), keyboard: keyboard.filter((r) => r.length > 0) };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const SLEEP_NIGHTS = 14;

function firstServingGrams(servings: string | null): number | null {
  if (!servings) return null;
  try {
    const g = (JSON.parse(servings) as { grams?: unknown }[])[0]?.grams;
    return typeof g === 'number' && g > 0 ? g : null;
  } catch {
    return null;
  }
}

async function eatenOn(userId: number, date: string) {
  const sum = await prisma.foodLogEntry.aggregate({
    where: { userId, date: dayDate(date) },
    _sum: { kcal: true, protein: true },
    _count: true,
  });
  return { kcal: sum._sum.kcal ?? 0, protein: sum._sum.protein ?? 0, count: sum._count };
}

/** Habits done / counted on `date` (skipped days and habits created later are left out). */
function habitsDoneOn(habits: CheckinHabit[], entries: CheckinEntry[], date: string) {
  const end = dayDate(addDays(date, 1)).getTime();
  const byHabit = datesByHabit(entries, habits);
  const skips = skippedByHabit(entries);
  const counted = habits.filter((h) => h.createdAt.getTime() < end && !skips.get(h.id)?.has(date));
  return { done: counted.filter((h) => byHabit.get(h.id)?.has(date)).length, total: counted.length };
}

export async function loadMorningData(userId: number, date: string): Promise<MorningData> {
  const yesterday = addDays(date, -1);
  const [goal, loaded] = await Promise.all([prisma.nutritionGoal.findUnique({ where: { userId } }), loadUserHabits(userId, date)]);
  const sleepHabit = goal?.sleepHabitId ? loaded.habits.find((h) => h.id === goal.sleepHabitId && h.measure === 'hours') : undefined;

  const hy = habitsDoneOn(loaded.habits, loaded.entries, yesterday);
  const data: MorningData = {
    date,
    yesterday: null,
    habitsYesterday: hy.total > 0 ? hy : null,
    today: null,
    habits: checkinHabitsFor('morning', loaded.habits).filter((h) => h.id !== sleepHabit?.id),
    entries: loaded.entries,
    weight: null,
    sleep: null,
    goalLine: await nearestGoalLine(userId, date).catch((e) => {
      console.error('[briefing] goal line failed:', e);
      return null;
    }),
  };

  if (goal) {
    const [plan, yPlan, eaten, todayW, lastW] = await Promise.all([
      computePlan(userId, date),
      computePlan(userId, yesterday),
      eatenOn(userId, yesterday),
      prisma.weightEntry.findUnique({ where: { userId_date: { userId, date: dayDate(date) } } }),
      prisma.weightEntry.findFirst({ where: { userId, date: { lt: dayDate(date) } }, orderBy: { date: 'desc' } }),
    ]);
    data.yesterday = {
      eatenKcal: eaten.kcal,
      eatenProtein: eaten.protein,
      logged: eaten.count > 0,
      target: { kcal: yPlan.todayKcal, protein: yPlan.proteinTarget },
    };
    data.today = { target: { kcal: plan.todayKcal, protein: plan.proteinTarget }, isTrainingDay: plan.isTrainingDay, phase: plan.phase };
    data.weight = { todayKg: todayW?.weightKg ?? null, lastKg: lastW?.weightKg ?? null };
  }

  if (sleepHabit) {
    const nights = await prisma.habitEntry.findMany({
      where: { habitId: sleepHabit.id, date: { gte: dayDate(addDays(date, -SLEEP_NIGHTS)), lte: dayDate(date) } },
      select: { date: true, value: true, skipped: true, startTime: true, endTime: true },
    });
    const todayMs = dayDate(date).getTime();
    const tonight = nights.find((e) => e.date.getTime() === todayMs && (e.value > 0 || e.skipped));
    data.sleep = {
      logged: tonight
        ? {
            bed: tonight.startTime,
            wake: tonight.endTime,
            minutes: tonight.startTime && tonight.endTime ? sleepMinutes(tonight.startTime, tonight.endTime) : tonight.value,
          }
        : null,
      presets: sleepPresets(nights.filter((e) => e.date.getTime() !== todayMs)),
    };
  }
  return data;
}

export async function loadEveningData(userId: number, date: string): Promise<EveningData> {
  const [goal, loaded] = await Promise.all([prisma.nutritionGoal.findUnique({ where: { userId } }), loadUserHabits(userId, date)]);
  const todayMs = dayDate(date).getTime();

  let training: EveningData['training'] = null;
  const trainingHabit = goal?.trainingHabitId ? loaded.habits.find((h) => h.id === goal.trainingHabitId) : undefined;
  if (trainingHabit) {
    const e = loaded.entries.find((x) => x.habitId === trainingHabit.id && x.date.getTime() === todayMs);
    if (!e?.skipped && !isDone(trainingHabit, e?.value)) training = { habitId: trainingHabit.id };
  }

  const data: EveningData = {
    date,
    nutrition: null,
    suggestions: [],
    // An unanswered training habit is asked as «тренировка была?» instead of a plain toggle; sleep is
    // asked in the morning (bed–wake), a plain toggle would write a bogus duration.
    habits: checkinHabitsFor('evening', loaded.habits).filter((h) => h.id !== training?.habitId && h.id !== goal?.sleepHabitId),
    entries: loaded.entries,
    training,
  };

  if (goal) {
    const [plan, eaten, mark, favs] = await Promise.all([
      computePlan(userId, date),
      eatenOn(userId, date),
      prisma.dayMark.findUnique({ where: { userId_date: { userId, date: dayDate(date) } } }),
      prisma.favoriteFood.findMany({ where: { userId }, include: { food: true } }),
    ]);
    const target = { kcal: plan.todayKcal ?? goal.kcal, protein: plan.proteinTarget };
    data.nutrition = {
      target,
      eatenKcal: eaten.kcal,
      eatenProtein: eaten.protein,
      logged: eaten.count,
      dayComplete: mark?.complete === true,
    };
    if (target.kcal && target.protein && eaten.count > 0) {
      data.suggestions = proteinSuggestions(
        favs.map((f) => ({ name: f.food.name, kcal: f.food.kcal, protein: f.food.protein, servingGrams: firstServingGrams(f.food.servings) })),
        target.kcal - eaten.kcal,
        target.protein - eaten.protein,
      );
    }
  }
  return data;
}

/** The current briefing of `kind` for `date` (used by the cron and to re-render after a tap). */
export async function buildBriefing(user: { id: number }, date: string, kind: CheckinKind): Promise<CheckinMessage> {
  return kind === 'morning'
    ? buildMorningBriefing(await loadMorningData(user.id, date))
    : buildEveningBriefing(await loadEveningData(user.id, date));
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/** A tick can be missed (pm2 restart during a deploy, a slow previous run) — catch up within this window. */
const SEND_WINDOW_MIN = 10;

const unresolved = (habits: CheckinHabit[], entries: CheckinEntry[], date: string) => {
  const ms = dayDate(date).getTime();
  return habits.some((h) => !entries.some((e) => e.habitId === h.id && e.date.getTime() === ms && (e.skipped || isDone(h, e.value))));
};

/** Something worth a message: nutrition info, a question, or a habit left to mark. */
function worthSending(kind: CheckinKind, d: MorningData | EveningData): boolean {
  if (kind === 'morning') {
    const m = d as MorningData;
    return m.today !== null || (m.sleep !== null && !m.sleep.logged) || unresolved(m.habits, m.entries, m.date);
  }
  const e = d as EveningData;
  return e.nutrition !== null || e.training !== null || unresolved(e.habits, e.entries, e.date);
}

/** Sends both briefings (evening, then morning) that are due. */
export async function sendDueBriefings(now = new Date()): Promise<void> {
  await sendDue('evening', now);
  await sendDue('morning', now);
}

/**
 * Sends the `kind` briefing to the owner when their `checkinTime` / `morningCheckinTime` (default 09:00) passed
 * less than SEND_WINDOW_MIN ago — once per local day, deduped by `lastCheckinDate` / `lastMorningCheckinDate`.
 */
async function sendDue(kind: CheckinKind, now: Date): Promise<void> {
  const morning = kind === 'morning';
  const users = await prisma.user.findMany({
    // A personal app: the owner only. The evening briefing needs a check-in time; the morning one defaults.
    where: { AND: [ownerWhere(), morning ? {} : { checkinTime: { not: null } }] },
  });
  const due = users.flatMap((user) => {
    const clock = localClock(now, user.tzOffset);
    const at = morning ? morningTimeOf(user) : user.checkinTime;
    const last = morning ? user.lastMorningCheckinDate : user.lastCheckinDate;
    if (!at || !isHHMM(at)) return [];
    // Minutes since `at`, across midnight (23:55 → 00:02 = 7); a wrapped catch-up belongs to yesterday's date.
    const late = (toMin(clock.hhmm) - toMin(at) + 1440) % 1440;
    const date = toMin(clock.hhmm) < toMin(at) ? addDays(clock.date, -1) : clock.date;
    return late < SEND_WINDOW_MIN && last !== date && user.canMessage !== false ? [{ user, clock: { date } }] : [];
  });

  await forEachSafe(due, `[briefing] send ${kind}`, ({ user }) => `user ${user.id}`, async ({ user, clock }) => {
    // Claim the day first: a slow send must never repeat on the next tick.
    const previous = morning ? user.lastMorningCheckinDate : user.lastCheckinDate;
    const release = () =>
      prisma.user.update({
        where: { id: user.id },
        data: morning ? { lastMorningCheckinDate: previous } : { lastCheckinDate: previous },
      });
    await prisma.user.update({
      where: { id: user.id },
      data: morning ? { lastMorningCheckinDate: clock.date } : { lastCheckinDate: clock.date },
    });
    let sent: Awaited<ReturnType<typeof sendToUser>>;
    try {
      const data = morning ? await loadMorningData(user.id, clock.date) : await loadEveningData(user.id, clock.date);
      if (!worthSending(kind, data)) return;

      const msg = morning ? buildMorningBriefing(data as MorningData) : buildEveningBriefing(data as EveningData);
      // A 403 marks the channel closed (canMessage=false) but keeps the check-in time (see messaging.ts).
      sent = await sendToUser(user, msg.text, { reply_markup: { inline_keyboard: msg.keyboard as any } }, { purpose: `briefing_${kind}` });
    } catch (e) {
      // A failed load/send: release the claim so the next tick inside the window retries.
      await release().catch((re) => console.error('[briefing] release failed:', re));
      throw e;
    }
    if (!sent) {
      // Closed channel (403 / skipped): release the claim so a grant later today still gets it in the window.
      await release();
      return;
    }
    track({ userId: user.id, event: morning ? 'morning_checkin_sent' : 'checkin_sent', category: 'bot', label: clock.date });
  });
}

let isRunning = false;

export function startBriefingCron(): void {
  cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        await sendDueBriefings();
      } catch (e) {
        console.error('[briefing] tick failed:', e);
      } finally {
        isRunning = false;
      }
    },
    { timezone: 'UTC' },
  );
  console.log('[briefing] scheduled (runs every minute)');
}
