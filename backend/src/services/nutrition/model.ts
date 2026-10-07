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
  insights: Insight[];
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
  const trainingHabitCreated = goal?.trainingHabitId
    ? ((await prisma.habit.findFirst({ where: { id: goal.trainingHabitId, userId }, select: { createdAt: true } }))?.createdAt ?? null)
    : null;

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
  const trainingDates = new Set(training.filter((e) => e.value > 0).map((e) => day(e.date)));
  const isTrainingDay = trainingDates.has(date);
  const trainingsPerWeek = goal?.trainingHabitId
    ? Math.round(([...trainingDates].filter((d) => d >= addDays(date, -21) && d <= date).length / 3) * 10) / 10
    : null;

  // ─── Target ────────────────────────────────────────────────────────────────
  let mode: Plan['mode'] = 'none';
  let dailyDelta: number | null = null;
  let baseKcal: number | null = null;

  if (goal) {
    const daysLeft = goal.targetDate ? Math.round((goal.targetDate.getTime() - parseDay(date).getTime()) / DAY_MS) : null;
    if (goal.targetWeightKg !== null && trendNow !== null && daysLeft !== null && daysLeft > 0) {
      dailyDelta = ((goal.targetWeightKg - trendNow) * KCAL_PER_KG) / daysLeft;
      dailyDelta = Math.max(MAX_DEFICIT, Math.min(MAX_SURPLUS, dailyDelta));
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
  const proteinTarget = goal?.protein ?? (trendNow !== null ? Math.round(trendNow * 1.8) : null);

  // ─── Insights: progress ────────────────────────────────────────────────────
  if (mode === 'goal' && goal) {
    const need = [
      complete.length < MIN_COMPLETE_DAYS && `${MIN_COMPLETE_DAYS - complete.length} полных дней дневника`,
      weighInsInWindow < MIN_WEIGH_INS && `${MIN_WEIGH_INS - weighInsInWindow} взвешиваний`,
    ].filter(Boolean);
    if (need.length) insights.push({ level: 'info', text: `Адаптивный расчёт включится, когда наберётся ещё ${need.join(' и ')}` });
  }
  if (trendKgPerWeek !== null && goal?.targetWeightKg != null && trendNow !== null) {
    const gaining = goal.targetWeightKg > trendNow;
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
    lastWeightKg: weights.length ? weights[weights.length - 1]!.weightKg : null,
    trendKg: trendNow,
    trendKgPerWeek: trendKgPerWeek !== null ? Math.round(trendKgPerWeek * 100) / 100 : null,
    trainingsPerWeek,
    sleepLastNightH: sleepLastNightH !== null ? Math.round(sleepLastNightH * 10) / 10 : null,
    sleepAvg7H,
    insights,
    trend,
  };
}
