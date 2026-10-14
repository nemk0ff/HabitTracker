/**
 * Nutrition model: weight trend → adaptive energy expenditure → daily target.
 *
 * - Weight trend: exponential moving average (α = 0.1/day, as in Hacker's Diet /
 *   Happy Scale) — smooths water noise and the 0.5 kg resolution of the scale.
 * - Adaptive TDEE: mean intake over the last 28 days (complete days only) minus
 *   the trend change × 7700 kcal/kg. Falls back to the manual goal until there is
 *   enough data.
 * - Training days get a small carb bonus; rest days give it back, so the weekly
 *   total is unchanged. Sleep never enters the formula — it only feeds insights.
 */
import { prisma } from '../../db.js';
import { pluralForm } from '../../utils/plural.js';
import { isDone } from '../habitStats.js';

export const KCAL_PER_KG = 7700;
const EMA_ALPHA = 0.1;
const WINDOW_DAYS = 28;
const MIN_COMPLETE_DAYS = 10;
const MIN_WEIGH_INS = 7;
const TRAINING_BONUS = 150;
const MAX_SURPLUS = 600;
const MAX_DEFICIT = -750;
const LOW_TRAINING_SURPLUS_CAP = 250;
const DAY_MS = 86_400_000;

export interface Insight {
  level: 'good' | 'info' | 'warn';
  text: string;
}

export interface TrendPoint {
  date: string;
  weightKg: number | null;
  trendKg: number;
}

export interface Plan {
  date: string;
  /** adaptive = measured TDEE; goal = manual goal kcal (not enough data yet); none = no goal set. */
  mode: 'adaptive' | 'goal' | 'none';
  tdee: number | null;
  completeDays: number;
  dailyDelta: number | null;
  /** Average daily target (the weekly target / 7). */
  baseKcal: number | null;
  todayKcal: number | null;
  isTrainingDay: boolean;
  trainingBonus: number;
  proteinTarget: number | null;
  /** Raw weigh-in on `date`, if any. */
  weightKg: number | null;
  /** Latest raw weigh-in on or before `date` (base for the ±0.5 kg quick buttons). */
  lastWeightKg: number | null;
  trendKg: number | null;
  trendKgPerWeek: number | null;
  trainingsPerWeek: number | null;
  sleepLastNightH: number | null;
  sleepAvg7H: number | null;
  /** Current goal phase; null when the goal has no phases. */
  phase: PlanPhase | null;
  insights: Insight[];
}

export type PhaseType = 'bulk' | 'cut' | 'maintain';

/** Stored as JSON in NutritionGoal.phases, ordered by `until`. */
export interface GoalPhase {
  type: PhaseType;
  /** Last day of the phase, local YYYY-MM-DD. */
  until: string;
  targetWeightKg?: number;
  rateKgPerWeek?: number;
}

export interface PlanPhase {
  type: PhaseType;
  label: string;
  until: string;
  /** −1 after the last phase ended (open-ended maintenance). */
  daysLeft: number;
  plannedRateKgWeek: number | null;
  actualRateKgWeek: number | null;
  onTrack: 'ahead' | 'on' | 'behind' | null;
}

const PHASE_TYPES: readonly PhaseType[] = ['bulk', 'cut', 'maintain'];
const MAX_PHASES = 6;
const ON_TRACK_TOLERANCE = 0.1;
const ACTUAL_RATE_DAYS = 14;

function isStrictDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00.000Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Validates client input; returns the normalized phases or an error message. */
export function validatePhases(v: unknown): GoalPhase[] | string {
  if (!Array.isArray(v)) return 'phases must be an array or null';
  if (v.length > MAX_PHASES) return `at most ${MAX_PHASES} phases`;
  const out: GoalPhase[] = [];
  for (const [i, raw] of v.entries()) {
    if (!raw || typeof raw !== 'object') return `phase ${i + 1}: must be an object`;
    const p = raw as Record<string, unknown>;
    if (!PHASE_TYPES.includes(p.type as PhaseType)) return `phase ${i + 1}: type must be bulk, cut or maintain`;
    if (!isStrictDay(p.until)) return `phase ${i + 1}: until must be a valid YYYY-MM-DD`;
    if (out.length && p.until <= out[out.length - 1]!.until) return `phase ${i + 1}: until must be after the previous phase`;
    const phase: GoalPhase = { type: p.type as PhaseType, until: p.until };
    if (p.targetWeightKg != null) {
      if (!inRange(p.targetWeightKg, 30, 200)) return `phase ${i + 1}: targetWeightKg must be between 30 and 200`;
      phase.targetWeightKg = Math.round(p.targetWeightKg * 10) / 10;
    }
    if (p.rateKgPerWeek != null) {
      if (!inRange(p.rateKgPerWeek, -1, 1)) return `phase ${i + 1}: rateKgPerWeek must be between -1 and 1`;
      if (phase.type === 'cut' && p.rateKgPerWeek > 0) return `phase ${i + 1}: cut rateKgPerWeek must be ≤ 0`;
      if (phase.type === 'bulk' && p.rateKgPerWeek < 0) return `phase ${i + 1}: bulk rateKgPerWeek must be ≥ 0`;
      phase.rateKgPerWeek = Math.round(p.rateKgPerWeek * 100) / 100;
    }
    if (phase.type !== 'maintain' && phase.targetWeightKg === undefined && phase.rateKgPerWeek === undefined) {
      return `phase ${i + 1}: bulk/cut needs targetWeightKg or rateKgPerWeek`;
    }
    out.push(phase);
  }
  return out;
}

/** Reads NutritionGoal.phases; malformed JSON is treated as "no phases". */
export function parsePhases(json: string | null | undefined): GoalPhase[] | null {
  if (!json) return null;
  try {
    const v = validatePhases(JSON.parse(json));
    return typeof v === 'string' || v.length === 0 ? null : v;
  } catch {
    return null;
  }
}

/** First phase not yet over; after the last one ends the goal continues as maintenance. */
export function currentPhase(phases: GoalPhase[], date: string): GoalPhase {
  return phases.find((p) => p.until >= date) ?? { type: 'maintain', until: phases[phases.length - 1]!.until };
}

/** "+0,35", "−0,1", "0". */
function fmtRate(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + String(Math.abs(r)).replace('.', ',');
}

function fmtWeight(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function phaseLabel(p: GoalPhase): string {
  if (p.type === 'maintain') return 'Поддержание';
  const name = p.type === 'bulk' ? 'Набор' : 'Сушка';
  if (p.targetWeightKg !== undefined) return `${name} до ${fmtWeight(p.targetWeightKg)} кг`;
  return `${name} ${fmtRate(p.rateKgPerWeek ?? 0)} кг/нед`;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(s: string): Date {
  return new Date(s + 'T00:00:00.000Z');
}

function addDays(s: string, n: number): string {
  return day(new Date(parseDay(s).getTime() + n * DAY_MS));
}

function round(n: number, step = 1): number {
  return Math.round(n / step) * step;
}

function fmtKg(n: number): string {
  return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1).replace('.', ',');
}

/** Daily EMA series from the first weigh-in up to `until` (days without a weigh-in carry the trend). */
export function weightTrend(weights: { date: string; weightKg: number }[], until: string): TrendPoint[] {
  if (weights.length === 0) return [];
  const byDate = new Map(weights.map((w) => [w.date, w.weightKg]));
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let trend = sorted[0]!.weightKg;
  for (let d = sorted[0]!.date; d <= until; d = addDays(d, 1)) {
    const w = byDate.get(d) ?? null;
    if (w !== null) trend = trend + EMA_ALPHA * (w - trend);
    out.push({ date: d, weightKg: w, trendKg: Math.round(trend * 100) / 100 });
  }
  return out;
}

export async function computePlan(userId: number, date: string): Promise<Plan & { trend: TrendPoint[] }> {
  const windowStart = addDays(date, -WINDOW_DAYS);
  const goal = await prisma.nutritionGoal.findUnique({ where: { userId } });
  // Archived habits still count here — the history stays valid for the model.
  const trainingHabit = goal?.trainingHabitId
    ? await prisma.habit.findFirst({
        where: { id: goal.trainingHabitId, userId },
        select: { createdAt: true, measure: true, dailyTarget: true },
      })
    : null;
  const trainingHabitCreated = trainingHabit?.createdAt ?? null;

  const [weightsRaw, days, training, sleep, marks] = await Promise.all([
    prisma.weightEntry.findMany({ where: { userId, date: { lte: parseDay(date) } }, orderBy: { date: 'asc' } }),
    prisma.foodLogEntry.groupBy({
      by: ['date'],
      where: { userId, date: { gte: parseDay(windowStart), lte: parseDay(date) } },
      _sum: { kcal: true, protein: true },
    }),
    goal?.trainingHabitId
      ? prisma.habitEntry.findMany({
          where: { habitId: goal.trainingHabitId, habit: { userId }, date: { gte: parseDay(windowStart), lte: parseDay(date) } },
        })
      : Promise.resolve([]),
    goal?.sleepHabitId
      ? prisma.habitEntry.findMany({
          where: {
            habitId: goal.sleepHabitId,
            habit: { userId, measure: 'hours' },
            date: { gte: parseDay(addDays(date, -60)), lte: parseDay(date) },
          },
        })
      : Promise.resolve([]),
    prisma.dayMark.findMany({ where: { userId, date: { gte: parseDay(windowStart), lte: parseDay(date) } } }),
  ]);

  const weights = weightsRaw.map((w) => ({ date: day(w.date), weightKg: w.weightKg }));
  const trend = weightTrend(weights, date);
  const trendAt = (d: string) => trend.find((p) => p.date === d)?.trendKg ?? null;
  const trendNow = trend.length ? trend[trend.length - 1]!.trendKg : null;
  const insights: Insight[] = [];

  // ─── Intake: complete days only ────────────────────────────────────────────
  // Today is excluded (still being logged); days under 60% of the median are
  // treated as partially logged and dropped so they don't drag TDEE down.
  const pastDays = days
    .map((d) => ({ date: day(d.date), kcal: d._sum.kcal ?? 0, protein: d._sum.protein ?? 0 }))
    .filter((d) => d.date < date && d.kcal > 0);
  const sortedKcal = pastDays.map((d) => d.kcal).sort((a, b) => a - b);
  const median = sortedKcal.length ? sortedKcal[Math.floor(sortedKcal.length / 2)]! : 0;
  // Explicit "день полный" marks win; unmarked days fall back to the 60%-of-median heuristic.
  const marked = new Map(marks.map((m) => [day(m.date), m.complete]));
  const complete = pastDays.filter((d) => marked.get(d.date) ?? d.kcal >= median * 0.6);
  const avgIntake = complete.length ? complete.reduce((s, d) => s + d.kcal, 0) / complete.length : null;

  // ─── Adaptive TDEE ─────────────────────────────────────────────────────────
  const firstComplete = complete.length ? complete.reduce((a, b) => (a.date < b.date ? a : b)).date : null;
  const weighInsInWindow = weights.filter((w) => w.date >= windowStart).length;
  let tdee: number | null = null;
  let trendKgPerWeek: number | null = null;
  if (firstComplete && trendNow !== null) {
    const startTrend = trendAt(firstComplete);
    const spanDays = Math.round((parseDay(date).getTime() - parseDay(firstComplete).getTime()) / DAY_MS);
    if (startTrend !== null && spanDays >= 7) {
      trendKgPerWeek = ((trendNow - startTrend) / spanDays) * 7;
      if (complete.length >= MIN_COMPLETE_DAYS && weighInsInWindow >= MIN_WEIGH_INS && spanDays >= 14 && avgIntake !== null) {
        tdee = round(avgIntake - ((trendNow - startTrend) / spanDays) * KCAL_PER_KG, 10);
      }
    }
  }

  // ─── Training frequency ────────────────────────────────────────────────────
  const trainingDates = new Set(training.filter((e) => trainingHabit != null && isDone(trainingHabit, e.value)).map((e) => day(e.date)));
  const isTrainingDay = trainingDates.has(date);
  const trainingsPerWeek = goal?.trainingHabitId
    ? Math.round(([...trainingDates].filter((d) => d >= addDays(date, -21) && d <= date).length / 3) * 10) / 10
    : null;

  // ─── Target ────────────────────────────────────────────────────────────────
  let mode: Plan['mode'] = 'none';
  let dailyDelta: number | null = null;
  let baseKcal: number | null = null;

  const phases = parsePhases(goal?.phases);
  const phase = goal && phases ? currentPhase(phases, date) : null;
  // After the last phase ended the goal is a synthetic maintenance with no end: daysLeft = −1 (UI hides it).
  const phasesEnded = phases !== null && !phases.some((p) => p.until >= date);
  const phaseDaysLeft = !phase
    ? 0
    : phasesEnded
      ? -1
      : Math.max(0, Math.round((parseDay(phase.until).getTime() - parseDay(date).getTime()) / DAY_MS));

  if (goal) {
    let rawDelta: number | null = null;
    if (phase) {
      if (phase.type === 'maintain') rawDelta = 0;
      else if (phase.targetWeightKg !== undefined && trendNow !== null) {
        // `until` is inclusive: on the phase's last day there is still one day to go.
        rawDelta = ((phase.targetWeightKg - trendNow) * KCAL_PER_KG) / (phaseDaysLeft + 1);
      } else if (phase.rateKgPerWeek !== undefined) rawDelta = (phase.rateKgPerWeek * KCAL_PER_KG) / 7;
      // A bulk never prescribes a deficit and a cut never a surplus (target already passed → hold).
      if (rawDelta !== null && phase.type === 'bulk') rawDelta = Math.max(0, rawDelta);
      if (rawDelta !== null && phase.type === 'cut') rawDelta = Math.min(0, rawDelta);
    } else {
      const daysLeft = goal.targetDate ? Math.round((goal.targetDate.getTime() - parseDay(date).getTime()) / DAY_MS) : null;
      if (goal.targetWeightKg !== null && trendNow !== null && daysLeft !== null && daysLeft > 0) {
        rawDelta = ((goal.targetWeightKg - trendNow) * KCAL_PER_KG) / daysLeft;
      }
    }
    if (rawDelta !== null) {
      dailyDelta = Math.max(MAX_DEFICIT, Math.min(MAX_SURPLUS, rawDelta));
      // Only judge training frequency once the linked habit has 3 weeks of history,
      // and only in adaptive mode (goal mode uses the manual kcal as-is).
      const trainingHistoryOk = trainingHabitCreated !== null && trainingHabitCreated <= parseDay(addDays(date, -21));
      if (
        tdee !== null &&
        trainingHistoryOk &&
        dailyDelta > LOW_TRAINING_SURPLUS_CAP &&
        trainingsPerWeek !== null &&
        trainingsPerWeek < 2
      ) {
        dailyDelta = LOW_TRAINING_SURPLUS_CAP;
        insights.push({
          level: 'warn',
          text: `Тренировок за 3 недели: ${String(trainingsPerWeek).replace('.', ',')} в неделю — профицит урезан до ${LOW_TRAINING_SURPLUS_CAP} ккал, иначе набор пойдёт в жир`,
        });
      }
      dailyDelta = round(dailyDelta, 10);
    }

    if (tdee !== null && dailyDelta !== null) {
      mode = 'adaptive';
      baseKcal = round(tdee + dailyDelta, 50);
    } else {
      mode = 'goal';
      baseKcal = goal.kcal;
    }
  }

  const perWeek = trainingsPerWeek ?? 0;
  const restKcal = baseKcal !== null ? round(baseKcal - (TRAINING_BONUS * perWeek) / 7, 10) : null;
  const todayKcal = restKcal !== null ? restKcal + (isTrainingDay ? TRAINING_BONUS : 0) : null;
  const lastWeightKg = weights.length ? weights[weights.length - 1]!.weightKg : null;
  const proteinBaseKg = trendNow ?? lastWeightKg;
  const proteinTarget =
    goal?.proteinPerKg != null && proteinBaseKg !== null
      ? Math.round(proteinBaseKg * goal.proteinPerKg)
      : goal?.protein ?? (trendNow !== null ? Math.round(trendNow * 1.8) : null);

  // ─── Phase progress: plan vs the trend slope over the last 14 days ────────
  let planPhase: PlanPhase | null = null;
  if (phase) {
    const plannedRate =
      phase.type === 'maintain'
        ? 0
        : phase.targetWeightKg === undefined && phase.rateKgPerWeek !== undefined
          ? // Same sign clamp as the applied delta: a cut never plans a gain, a bulk never a loss.
            phase.type === 'bulk'
            ? Math.max(0, phase.rateKgPerWeek)
            : Math.min(0, phase.rateKgPerWeek)
          : dailyDelta !== null
            ? (dailyDelta * 7) / KCAL_PER_KG
            : null;
    const from = addDays(date, -ACTUAL_RATE_DAYS);
    const trendFrom = trendAt(from);
    const weighInsRecent = weights.filter((w) => w.date > from).length;
    const actualRate =
      trendFrom !== null && trendNow !== null && weighInsRecent >= 3 ? ((trendNow - trendFrom) / ACTUAL_RATE_DAYS) * 7 : null;
    const planned = plannedRate !== null ? Math.round(plannedRate * 100) / 100 : null;
    const actual = actualRate !== null ? Math.round(actualRate * 100) / 100 : null;
    let onTrack: PlanPhase['onTrack'] = null;
    if (planned !== null && actual !== null) {
      const diff = actual - planned;
      if (Math.abs(diff) <= ON_TRACK_TOLERANCE + 1e-9) onTrack = 'on';
      else if (phase.type === 'maintain') onTrack = 'behind';
      else onTrack = (phase.type === 'bulk' ? diff > 0 : diff < 0) ? 'ahead' : 'behind';
    }
    planPhase = {
      type: phase.type,
      label: phaseLabel(phase),
      until: phase.until,
      daysLeft: phaseDaysLeft,
      plannedRateKgWeek: planned,
      actualRateKgWeek: actual,
      onTrack,
    };
    if (planned !== null && actual !== null && (onTrack === 'ahead' || onTrack === 'behind')) {
      const rates = `${fmtRate(actual)} кг/нед вместо ${fmtRate(planned)}`;
      const text =
        phase.type === 'maintain'
          ? `Вес уходит от поддержания: ${rates}`
          : `${phase.type === 'bulk' ? 'Набор' : 'Сушка'} идёт ${onTrack === 'ahead' ? 'быстрее' : 'медленнее'} плана: ${rates}`;
      insights.push({ level: 'info', text: mode === 'adaptive' ? `${text} — норма подстраивается по факту` : text });
    }
  }

  // ─── Insights: progress ────────────────────────────────────────────────────
  if (mode === 'goal' && goal) {
    const need = [
      complete.length < MIN_COMPLETE_DAYS &&
        plural(MIN_COMPLETE_DAYS - complete.length, 'полный день', 'полных дня', 'полных дней') + ' дневника',
      weighInsInWindow < MIN_WEIGH_INS &&
        plural(MIN_WEIGH_INS - weighInsInWindow, 'взвешивание', 'взвешивания', 'взвешиваний'),
    ].filter(Boolean);
    if (need.length) insights.push({ level: 'info', text: `Ещё ${need.join(' и ')} — и норма начнёт подстраиваться под тебя` });
  }
  // Direction of the goal: from the current phase if there are phases, else from targetWeightKg.
  const direction = phase
    ? phase.type === 'maintain'
      ? null
      : phase.type
    : goal?.targetWeightKg != null && trendNow !== null
      ? goal.targetWeightKg > trendNow
        ? 'bulk'
        : 'cut'
      : null;
  if (trendKgPerWeek !== null && direction !== null) {
    const gaining = direction === 'bulk';
    const onPace = gaining ? trendKgPerWeek >= 0.15 : trendKgPerWeek <= -0.15;
    insights.push({
      level: onPace ? 'good' : 'info',
      text: `Тренд веса: ${fmtKg(trendKgPerWeek)} кг/нед${
        trainingsPerWeek !== null ? `, тренировок ${String(trainingsPerWeek).replace('.', ',')}/нед` : ''
      }`,
    });
    if (gaining && trendKgPerWeek > 0.5) {
      insights.push({ level: 'warn', text: 'Набор быстрее 0,5 кг/нед — заметная часть уйдёт в жир' });
    }
  }

  // ─── Insights: sleep (hours habit, value in minutes) ───────────────────────
  const sleepByDate = new Map(sleep.filter((e) => e.value > 0).map((e) => [day(e.date), e.value / 60]));
  const sleepLastNightH = sleepByDate.get(date) ?? null;
  const last7 = [...sleepByDate.entries()].filter(([d]) => d > addDays(date, -7)).map(([, h]) => h);
  const sleepAvg7H = last7.length ? Math.round((last7.reduce((a, b) => a + b, 0) / last7.length) * 10) / 10 : null;

  if (sleepAvg7H !== null && sleepAvg7H < 6 && last7.length >= 3) {
    insights.push({
      level: 'warn',
      text: `Сон за неделю в среднем ${String(sleepAvg7H).replace('.', ',')} ч — при недосыпе больше профицита уходит в жир, а не в мышцы`,
    });
  }
  const todayWeight = weights.find((w) => w.date === date)?.weightKg ?? null;
  if (sleepLastNightH !== null && sleepLastNightH < 5 && todayWeight !== null && trendNow !== null && todayWeight - trendNow >= 0.5) {
    insights.push({ level: 'info', text: 'Скачок веса после короткого сна — скорее всего вода, на тренд почти не влияет' });
  }
  // Appetite vs sleep: compare intake after short and normal nights (needs ≥5 of each, fewer is noise).
  const intakeByDate = new Map(pastDays.map((d) => [d.date, d]));
  const shortNights = [...sleepByDate.entries()].filter(([d, h]) => h < 6 && intakeByDate.has(d)).map(([d]) => intakeByDate.get(d)!);
  const goodNights = [...sleepByDate.entries()].filter(([d, h]) => h >= 7 && intakeByDate.has(d)).map(([d]) => intakeByDate.get(d)!);
  if (shortNights.length >= 5 && goodNights.length >= 5) {
    const avg = (xs: { kcal: number }[]) => xs.reduce((s, x) => s + x.kcal, 0) / xs.length;
    const diff = round(avg(shortNights) - avg(goodNights), 10);
    if (Math.abs(diff) >= 150) {
      insights.push({
        level: 'info',
        text: `После сна меньше 6 ч ты ешь в среднем на ${Math.abs(diff)} ккал ${diff > 0 ? 'больше' : 'меньше'}`,
      });
    }
  }

  return {
    date,
    mode,
    tdee,
    completeDays: complete.length,
    dailyDelta,
    baseKcal,
    todayKcal,
    isTrainingDay,
    trainingBonus: TRAINING_BONUS,
    proteinTarget,
    weightKg: todayWeight,
    lastWeightKg,
    trendKg: trendNow,
    trendKgPerWeek: trendKgPerWeek !== null ? Math.round(trendKgPerWeek * 100) / 100 : null,
    trainingsPerWeek,
    sleepLastNightH: sleepLastNightH !== null ? Math.round(sleepLastNightH * 10) / 10 : null,
    sleepAvg7H,
    phase: planPhase,
    insights,
    trend,
  };
}

/** "1 полный день", "2 полных дня", "5 полных дней". */
function plural(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralForm(n, one, few, many)}`;
}
