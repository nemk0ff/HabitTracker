/**
 * Dashboard + quarter goals (plans/14-10-2026-iteration-C.md). Everything is computed here so the
 * Mini App makes one request: weekly kcal/protein (complete days only) vs plan, sleep, trainings,
 * weight with its EMA trend and the current phase's plan line, «связи», and goal progress.
 *
 * Dates are local 'YYYY-MM-DD'; DB rows store them as UTC midnight (HabitEntry convention).
 */
import type { NutritionGoal, QuarterGoal as QuarterGoalRow } from '@prisma/client';
import { prisma } from '../db.js';
import { pluralForm } from '../utils/plural.js';
import { addDays, dayDate, isDone, mondayOf, toDateString } from './habitStats.js';
import { completeIntakeDays, computePlan, currentPhase, parsePhases, weightTrend, type PlanPhase } from './nutrition/model.js';
import { isHHMM } from './sleep.js';

// ─── Contract (frontend/src/types/index.ts) ───────────────────────────────────

export type QuarterGoalMetric = 'weight' | 'trainings' | 'sleep_share' | 'habit_count' | 'protein_days';
export const GOAL_METRICS: readonly QuarterGoalMetric[] = ['weight', 'trainings', 'sleep_share', 'habit_count', 'protein_days'];

export interface QuarterGoal {
  id: number;
  title: string;
  metric: QuarterGoalMetric;
  target: number;
  param: number | null;
  deadline: string;
  startDate: string;
  startValue: number | null;
  current: number | null;
  progress: number;
  daysLeft: number;
  status: 'done' | 'on' | 'behind' | 'unknown';
  summary: string;
}

export interface DashboardWeek {
  weekStart: string;
  kcalAvg: number | null;
  kcalTarget: number | null;
  proteinAvg: number | null;
  proteinTarget: number | null;
  completeDays: number;
  sleepAvgMin: number | null;
  bedtimeAvg: string | null;
  bedtimeSpreadMin: number | null;
  /** null when no training habit is linked. */
  trainings: number | null;
  trainingTarget: number | null;
}

export interface DashboardLink {
  label: string;
  a: string;
  b: string;
  note: string;
}

export interface DashboardData {
  weeks: DashboardWeek[];
  weight: { points: { date: string; kg: number }[]; trend: { date: string; kg: number }[]; plan: { date: string; kg: number }[] };
  phaseLine: string | null;
  links: DashboardLink[] | null;
  goals: QuarterGoal[];
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const LINKS_MIN_DAYS = 14;
const LINK_MIN_GROUP = 3;
const ON_TRACK_SLACK = 0.05;
const SHORT_NIGHT_MIN = 6 * 60;
const GOOD_NIGHT_MIN = 7 * 60;
const MIN_SLEEP_NIGHTS = 3;
const SLEEP_BASELINE_DAYS = 30;
/** Each day's completeness is judged against the median of its own trailing window (like the model). */
const COMPLETE_WINDOW_DAYS = 28;
const SLEEP_PACE_SLACK_PCT = 5;
const HOLD_WEIGHT_KG = 0.5;

const roundTo = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
/** Same as the frontend `fmt`: ru-RU, up to `digits` decimals. */
const fmt = (n: number, digits = 0) => roundTo(n, digits).toLocaleString('ru-RU', { maximumFractionDigits: digits });
const signed = (n: number, digits = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), digits)}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const daysBetween = (a: string, b: string) => Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / 86_400_000);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const minDate = (...ds: string[]) => ds.reduce((a, b) => (b < a ? b : a));

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «1 января», with the year when it differs from today's. */
function fmtDateRu(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS_GEN[m - 1]}${date.slice(0, 4) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

/** Bed time in minutes, times before noon shifted past midnight so 23:30 < 01:00. */
const bedMinutes = (hhmm: string) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return t < 12 * 60 ? t + 1440 : t;
};
const fmtClock = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** «Набор до 77 кг · осталось 138 дн · +0,2/0,35 кг/нед» — same as frontend utils/phases.ts phaseLine. */
export function phaseLine(p: PlanPhase): string {
  const parts = [p.label];
  if (p.daysLeft >= 0) parts.push(`осталось ${fmt(p.daysLeft)} дн`);
  if (p.plannedRateKgWeek !== null) {
    const planned = fmt(Math.abs(p.plannedRateKgWeek), 2);
    parts.push(
      p.actualRateKgWeek !== null ? `${signed(p.actualRateKgWeek)}/${planned} кг/нед` : `план ${signed(p.plannedRateKgWeek)} кг/нед`,
    );
  }
  return parts.join(' · ');
}

// ─── Data loading ─────────────────────────────────────────────────────────────

interface Night {
  minutes: number;
  bed: string | null;
}

interface Ctx {
  today: string;
  goal: NutritionGoal | null;
  /** All weigh-ins up to today. */
  weights: { date: string; weightKg: number }[];
  /** Daily EMA trend from the first weigh-in to today. */
  trendByDate: Map<string, number>;
  trendNow: number | null;
  /** Logged days (kcal > 0) since `from` (plus the trailing window before it). */
  intake: { date: string; kcal: number; protein: number }[];
  /**
   * Complete diary days (today only when explicitly marked complete). Each day is judged against the
   * median of its own trailing 28 days, so a week's numbers don't depend on the loaded range.
   */
  complete: Set<string>;
  training: { weeklyTarget: number | null; done: Set<string> } | null;
  /** Nights by wake date (value > 0, not skipped). */
  sleep: Map<string, Night> | null;
}

async function loadCtx(userId: number, from: string, today: string): Promise<Ctx> {
  const range = { gte: dayDate(from), lte: dayDate(today) };
  const intakeRange = { gte: dayDate(addDays(from, -(COMPLETE_WINDOW_DAYS - 1))), lte: dayDate(today) };
  const goal = await prisma.nutritionGoal.findUnique({ where: { userId } });
  const [weightsRaw, days, marks, trainingHabit, sleepHabit] = await Promise.all([
    prisma.weightEntry.findMany({ where: { userId, date: { lte: dayDate(today) } }, orderBy: { date: 'asc' } }),
    prisma.foodLogEntry.groupBy({ by: ['date'], where: { userId, date: intakeRange }, _sum: { kcal: true, protein: true } }),
    prisma.dayMark.findMany({ where: { userId, date: intakeRange } }),
    goal?.trainingHabitId
      ? prisma.habit.findFirst({ where: { id: goal.trainingHabitId, userId }, select: { id: true, measure: true, dailyTarget: true, weeklyTarget: true } })
      : null,
    goal?.sleepHabitId ? prisma.habit.findFirst({ where: { id: goal.sleepHabitId, userId, measure: 'hours' }, select: { id: true } }) : null,
  ]);
  const habitIds = [trainingHabit?.id, sleepHabit?.id].filter((x): x is number => x != null);
  const entries = habitIds.length ? await prisma.habitEntry.findMany({ where: { habitId: { in: habitIds }, date: range } }) : [];

  const weights = weightsRaw.map((w) => ({ date: toDateString(w.date), weightKg: w.weightKg }));
  const trend = weightTrend(weights, today);
  const marked = new Map(marks.map((m) => [toDateString(m.date), m.complete]));
  const intake = days
    .map((d) => ({ date: toDateString(d.date), kcal: d._sum.kcal ?? 0, protein: d._sum.protein ?? 0 }))
    .filter((d) => d.kcal > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Today is still being logged: it counts only with an explicit «день полный».
  const candidates = intake.filter((d) => d.date < today || marked.get(d.date) === true);

  let sleep: Map<string, Night> | null = null;
  if (sleepHabit) {
    sleep = new Map();
    for (const e of entries) {
      if (e.habitId !== sleepHabit.id || e.skipped || e.value <= 0) continue;
      sleep.set(toDateString(e.date), { minutes: e.value, bed: isHHMM(e.startTime) ? e.startTime : null });
    }
  }

  return {
    today,
    goal,
    weights,
    trendByDate: new Map(trend.map((p) => [p.date, p.trendKg])),
    trendNow: trend.length ? trend[trend.length - 1]!.trendKg : null,
    intake,
    complete: completeByTrailingWindow(candidates, marked),
    training: trainingHabit
      ? {
          weeklyTarget: trainingHabit.weeklyTarget,
          done: new Set(entries.filter((e) => e.habitId === trainingHabit.id && isDone(trainingHabit, e.value, e.skipped)).map((e) => toDateString(e.date))),
        }
      : null,
    sleep,
  };
}

/** Days complete relative to the median of their own trailing COMPLETE_WINDOW_DAYS (sorted input). */
function completeByTrailingWindow(days: { date: string; kcal: number }[], marked: ReadonlyMap<string, boolean>): Set<string> {
  const out = new Set<string>();
  let lo = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const windowStart = addDays(d.date, -(COMPLETE_WINDOW_DAYS - 1));
    while (days[lo]!.date < windowStart) lo++;
    if (completeIntakeDays(days.slice(lo, i + 1), marked).some((x) => x.date === d.date)) out.add(d.date);
  }
  return out;
}

/** Trend on `date`; before the first weigh-in — the first trend value. */
function trendAt(ctx: Ctx, date: string): number | null {
  const v = ctx.trendByDate.get(date);
  if (v !== undefined) return v;
  if (!ctx.weights.length) return null;
  return date < ctx.weights[0]!.date ? ctx.trendByDate.get(ctx.weights[0]!.date) ?? null : ctx.trendNow;
}

/** Protein target of a day — the model's rule (g/kg of the trend, else manual grams, else 1.8 g/kg). */
function proteinTargetOn(ctx: Ctx, date: string): number | null {
  const g = ctx.goal;
  if (!g) return null;
  const t = trendAt(ctx, date);
  if (g.proteinPerKg != null && t !== null) return Math.round(t * g.proteinPerKg);
  return g.protein ?? (t !== null ? Math.round(t * 1.8) : null);
}

// ─── Weeks ────────────────────────────────────────────────────────────────────

type PlanResult = Awaited<ReturnType<typeof computePlan>>;

async function buildWeeks(userId: number, ctx: Ctx, rangeStart: string, count: number, todayPlan: PlanResult | null): Promise<DashboardWeek[]> {
  const starts = Array.from({ length: count }, (_, i) => addDays(rangeStart, i * 7));
  // The model's targets as of each week's last (evaluated) day; nothing without a goal.
  // The current week evaluates on today — reuse today's plan instead of recomputing it.
  const plans = ctx.goal
    ? await Promise.all(
        starts.map((ws) => {
          const at = minDate(addDays(ws, 6), ctx.today);
          return at === ctx.today && todayPlan ? todayPlan : computePlan(userId, at);
        }),
      )
    : starts.map(() => null);

  return starts.map((ws, i) => {
    const we = addDays(ws, 6);
    const inWeek = (d: string) => d >= ws && d <= we;
    const days = ctx.intake.filter((d) => inWeek(d.date) && ctx.complete.has(d.date));
    const kcal = avg(days.map((d) => d.kcal));
    const protein = avg(days.map((d) => d.protein));

    const nights = ctx.sleep ? [...ctx.sleep.entries()].filter(([d]) => inWeek(d)).map(([, n]) => n) : [];
    const sleepAvg = avg(nights.map((n) => n.minutes));
    const beds = nights.flatMap((n) => (n.bed ? [bedMinutes(n.bed)] : []));
    const bedAvg = avg(beds);
    const spread =
      bedAvg !== null && beds.length >= 2 ? Math.sqrt(beds.reduce((s, b) => s + (b - bedAvg) ** 2, 0) / beds.length) : null;

    const plan = plans[i];
    return {
      weekStart: ws,
      kcalAvg: kcal !== null ? Math.round(kcal) : null,
      kcalTarget: plan?.baseKcal ?? null,
      proteinAvg: protein !== null ? Math.round(protein) : null,
      proteinTarget: plan?.proteinTarget ?? null,
      completeDays: days.length,
      sleepAvgMin: sleepAvg !== null ? Math.round(sleepAvg) : null,
      bedtimeAvg: bedAvg !== null ? fmtClock(bedAvg) : null,
      bedtimeSpreadMin: spread !== null ? Math.round(spread) : null,
      trainings: ctx.training ? [...ctx.training.done].filter(inWeek).length : null,
      trainingTarget: ctx.training?.weeklyTarget ?? null,
    };
  });
}

// ─── Weight plan line ─────────────────────────────────────────────────────────

/** Dashed line from today's trend to the current phase's end (or the goal's target date without phases). */
function weightPlanLine(ctx: Ctx, phase: PlanPhase | null): { date: string; kg: number }[] {
  const g = ctx.goal;
  const now = ctx.trendNow;
  if (!g || now === null) return [];
  const today = ctx.today;
  const phases = parsePhases(g.phases);
  let end: { date: string; kg: number } | null = null;
  if (phases) {
    if (!phase || phase.daysLeft < 0) return [];
    const p = currentPhase(phases, today);
    if (p.type === 'maintain') end = { date: p.until, kg: now };
    else if (p.targetWeightKg !== undefined) end = { date: p.until, kg: p.targetWeightKg };
    else if (phase.plannedRateKgWeek !== null) end = { date: p.until, kg: now + (phase.plannedRateKgWeek * phase.daysLeft) / 7 };
  } else if (g.targetWeightKg !== null && g.targetDate) {
    const date = toDateString(g.targetDate);
    if (date > today) end = { date, kg: g.targetWeightKg };
  }
  if (!end || end.date <= today) return [];
  return [
    { date: today, kg: roundTo(now, 2) },
    { date: end.date, kg: roundTo(end.kg, 2) },
  ];
}

// ─── Links («Связи») ──────────────────────────────────────────────────────────

function compareKcal(label: string, a: number[], b: number[], aName: string, bName: string): DashboardLink {
  const show = (xs: number[]) => (xs.length ? `${fmt(avg(xs)!, 0)} ккал · ${xs.length} дн` : '—');
  if (a.length < LINK_MIN_GROUP || b.length < LINK_MIN_GROUP) {
    return { label, a: show(a), b: show(b), note: `Мало дней для сравнения (нужно хотя бы ${LINK_MIN_GROUP} в каждой группе)` };
  }
  const diff = Math.round((avg(a)! - avg(b)!) / 10) * 10;
  const note =
    Math.abs(diff) < 100
      ? 'Разницы почти нет'
      : `${aName} ты ешь на ${fmt(Math.abs(diff))} ккал ${diff > 0 ? 'больше' : 'меньше'}, чем ${bName}`;
  return { label, a: show(a), b: show(b), note };
}

function buildLinks(ctx: Ctx, rangeStart: string, weekStarts: string[]): DashboardLink[] | null {
  const days = ctx.intake.filter((d) => d.date >= rangeStart && ctx.complete.has(d.date));
  if (days.length < LINKS_MIN_DAYS) return null;
  const links: DashboardLink[] = [];

  if (ctx.sleep) {
    const short: number[] = [];
    const good: number[] = [];
    for (const d of days) {
      const n = ctx.sleep.get(d.date);
      if (!n) continue;
      if (n.minutes < SHORT_NIGHT_MIN) short.push(d.kcal);
      else if (n.minutes >= GOOD_NIGHT_MIN) good.push(d.kcal);
    }
    links.push(compareKcal('Ккал после сна < 6 ч и ≥ 7 ч', short, good, 'После короткой ночи', 'после нормальной'));
  }

  if (ctx.training) {
    const tr = days.filter((d) => ctx.training!.done.has(d.date)).map((d) => d.kcal);
    const rest = days.filter((d) => !ctx.training!.done.has(d.date)).map((d) => d.kcal);
    links.push(compareKcal('Ккал в дни тренировок и без', tr, rest, 'В дни тренировок', 'в дни отдыха'));

    // Weekly trend change in finished weeks with weigh-ins on both ends.
    const active: number[] = [];
    const other: number[] = [];
    for (const ws of weekStarts) {
      const we = addDays(ws, 6);
      if (we >= ctx.today || !ctx.weights.length || addDays(ws, -1) < ctx.weights[0]!.date) continue;
      const a = trendAt(ctx, addDays(ws, -1));
      const b = trendAt(ctx, we);
      if (a === null || b === null) continue;
      const n = [...ctx.training.done].filter((d) => d >= ws && d <= we).length;
      (n >= 3 ? active : other).push(b - a);
    }
    const show = (xs: number[]) => (xs.length ? `${signed(avg(xs)!)} кг/нед · ${xs.length} ${pluralForm(xs.length, 'неделя', 'недели', 'недель')}` : '—');
    const note =
      !active.length || !other.length
        ? 'Нужны и недели с ≥ 3 тренировками, и без — пока сравнивать не с чем'
        : `Разница ${signed(avg(active)! - avg(other)!)} кг/нед в пользу ${avg(active)! >= avg(other)! ? 'активных' : 'остальных'} недель`;
    links.push({ label: 'Вес-тренд в недели с ≥ 3 тренировками и остальные', a: show(active), b: show(other), note });
  }
  return links;
}

// ─── Quarter goals ────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<QuarterGoal['status'], string> = {
  done: 'выполнено ✓',
  on: 'по графику',
  behind: 'отстаёшь',
  unknown: 'мало данных',
};

/** Linear plan from start to deadline: done ≥ 1, else on track while progress keeps up with elapsed time. */
function linearStatus(progress: number, startDate: string, deadline: string, today: string): QuarterGoal['status'] {
  if (progress >= 1) return 'done';
  if (today > deadline) return 'behind';
  const elapsed = clamp01(daysBetween(startDate, today) / Math.max(1, daysBetween(startDate, deadline)));
  return progress + ON_TRACK_SLACK >= elapsed ? 'on' : 'behind';
}

/** Share of logged nights ≥ `hours` between `from` and `to` (percent), with the number of nights. */
function sleepShare(ctx: Ctx, hours: number, from: string, to: string): { pct: number; nights: number } | null {
  if (!ctx.sleep) return null;
  const nights = [...ctx.sleep.entries()].filter(([d]) => d >= from && d <= to);
  if (!nights.length) return { pct: 0, nights: 0 };
  return { pct: Math.round((nights.filter(([, n]) => n.minutes >= hours * 60).length / nights.length) * 100), nights: nights.length };
}

type HabitCounts = Map<number, { name: string; icon: string | null; done: Set<string> }>;

function goalProgress(g: QuarterGoalRow, ctx: Ctx, habits: HabitCounts): QuarterGoal {
  const today = ctx.today;
  const metric = g.metric as QuarterGoalMetric;
  const daysLeft = Math.max(0, daysBetween(today, g.deadline));
  const when = `к ${fmtDateRu(g.deadline, today)}`;
  const tail = (s: QuarterGoal['status']) => ` · ${STATUS_TEXT[s]}`;
  let current: number | null = null;
  let progress = 0;
  let status: QuarterGoal['status'] = 'unknown';
  let summary: string;

  const countGoal = (dates: Set<string> | null, what: string, missing: string) => {
    if (!dates) {
      summary = `${what} ${when}: ${missing}`;
      return;
    }
    current = [...dates].filter((d) => d >= g.startDate && d <= today).length;
    progress = clamp01(current / g.target);
    status = linearStatus(progress, g.startDate, g.deadline, today);
    const rest = Math.max(0, g.target - current);
    summary =
      status === 'done'
        ? `${what} ${when}: ${current} из ${fmt(g.target)}${tail(status)}`
        : `${what} ${when}: ${current} из ${fmt(g.target)}, ещё ${fmt(rest)} за ${daysLeft} дн${tail(status)}`;
  };

  switch (metric) {
    case 'weight': {
      const what = `${fmt(g.target, 1)} кг`;
      current = ctx.trendNow !== null ? roundTo(ctx.trendNow, 1) : null;
      const start = g.startValue ?? trendAt(ctx, g.startDate);
      if (current === null || start === null) {
        summary = `${what} ${when}: нет данных о весе`;
        break;
      }
      const gap = g.target - start;
      if (Math.abs(gap) < HOLD_WEIGHT_KG) {
        // «Держать вес»: on track while within ±0.5 kg; outside, progress fades with the distance.
        const off = Math.abs(current - g.target);
        const inside = off <= HOLD_WEIGHT_KG;
        progress = inside ? 1 : clamp01(HOLD_WEIGHT_KG / off);
        status = inside ? (today >= g.deadline ? 'done' : 'on') : 'behind';
        summary = inside
          ? `${what} ${when}: держишь ±${fmt(HOLD_WEIGHT_KG, 1)} кг${tail(status)}`
          : `${what} ${when}: отклонение ${fmt(off, 1)} кг${tail(status)}`;
        break;
      }
      // Reached when the trend crossed the target in the goal's direction.
      progress = clamp01((current - start) / gap);
      status = linearStatus(progress, g.startDate, g.deadline, today);
      summary =
        status === 'done'
          ? `${what} ${when}: цель достигнута ✓`
          : `${what} ${when}: осталось ${fmt(Math.abs(g.target - current), 1)} кг за ${daysLeft} дн${tail(status)}`;
      break;
    }
    case 'trainings':
      countGoal(ctx.training?.done ?? null, `${fmt(g.target)} ${pluralForm(g.target, 'тренировка', 'тренировки', 'тренировок')}`, 'привяжи привычку-тренировку в цели питания');
      break;
    case 'habit_count': {
      const h = g.param != null ? habits.get(g.param) : undefined;
      countGoal(h?.done ?? null, `${h ? (h.icon ? `${h.icon} ${h.name}` : h.name) : 'Привычка'} ${fmt(g.target)} раз`, 'привычка не найдена');
      break;
    }
    case 'protein_days': {
      const met = new Set(
        ctx.intake.filter((d) => {
          const t = proteinTargetOn(ctx, d.date);
          return t !== null && d.protein >= t;
        }).map((d) => d.date),
      );
      countGoal(ctx.goal ? met : null, `${fmt(g.target)} ${pluralForm(g.target, 'день', 'дня', 'дней')} с нормой белка`, 'нет цели питания');
      break;
    }
    case 'sleep_share': {
      const hours = g.param ?? 7;
      const what = `Сон ≥ ${fmt(hours, 1)} ч в ${fmt(g.target)}% ночей`;
      const s = sleepShare(ctx, hours, g.startDate, today);
      if (!s) {
        summary = `${what} ${when}: привяжи привычку сна в цели питания`;
        break;
      }
      current = s.pct;
      // Paced like the other metrics: the expected share moves from the start value to the target.
      const base = g.startValue;
      progress =
        base !== null && g.target > base ? clamp01((s.pct - base) / (g.target - base)) : clamp01(g.target > 0 ? s.pct / g.target : 1);
      if (s.nights < MIN_SLEEP_NIGHTS) status = 'unknown';
      else if (today >= g.deadline) status = s.pct >= g.target ? 'done' : 'behind';
      else {
        const elapsed = clamp01(daysBetween(g.startDate, today) / Math.max(1, daysBetween(g.startDate, g.deadline)));
        const expected = (base ?? 0) + (g.target - (base ?? 0)) * elapsed;
        status = s.pct + SLEEP_PACE_SLACK_PCT >= expected ? 'on' : 'behind';
      }
      summary = `${what} ${when}: сейчас ${s.pct}% (${s.nights} ${pluralForm(s.nights, 'ночь', 'ночи', 'ночей')})${tail(status)}`;
      break;
    }
    default:
      summary = g.title;
  }

  return {
    id: g.id,
    title: g.title,
    metric,
    target: g.target,
    param: g.param,
    deadline: g.deadline,
    startDate: g.startDate,
    startValue: g.startValue,
    current,
    progress: roundTo(progress, 3),
    daysLeft,
    status,
    summary: summary!,
  };
}

async function loadHabitCounts(userId: number, goals: QuarterGoalRow[], from: string, today: string): Promise<HabitCounts> {
  const ids = [...new Set(goals.filter((g) => g.metric === 'habit_count' && g.param != null).map((g) => g.param!))];
  const out: HabitCounts = new Map();
  if (!ids.length) return out;
  const habits = await prisma.habit.findMany({
    where: { id: { in: ids }, userId },
    include: { entries: { where: { date: { gte: dayDate(from), lte: dayDate(today) } } } },
  });
  for (const h of habits) {
    out.set(h.id, {
      name: h.name,
      icon: h.icon,
      done: new Set(h.entries.filter((e) => isDone(h, e.value, e.skipped)).map((e) => toDateString(e.date))),
    });
  }
  return out;
}

/** `ctx`, when given, must be loaded from the earliest goal start or before (the dashboard's is). */
async function progressFor(userId: number, goals: QuarterGoalRow[], today: string, ctx?: Ctx): Promise<QuarterGoal[]> {
  if (!goals.length) return [];
  const from = minDate(today, ...goals.map((g) => g.startDate));
  const [c, habits] = await Promise.all([ctx ?? loadCtx(userId, from, today), loadHabitCounts(userId, goals, from, today)]);
  return goals.map((g) => goalProgress(g, c, habits));
}

/** All the user's goals with progress: active first (nearest deadline), archived last. */
export async function listGoals(userId: number, today: string, opts: { includeArchived?: boolean } = {}): Promise<(QuarterGoal & { archived: boolean })[]> {
  const rows = await prisma.quarterGoal.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: [{ archived: 'asc' }, { deadline: 'asc' }, { id: 'asc' }],
  });
  const progress = await progressFor(userId, rows, today);
  return progress.map((p, i) => ({ ...p, archived: rows[i]!.archived }));
}

/** Goal with progress, for POST/PATCH responses. */
export async function goalWithProgress(userId: number, row: QuarterGoalRow, today: string): Promise<QuarterGoal & { archived: boolean }> {
  const [p] = await progressFor(userId, [row], today);
  return { ...p!, archived: row.archived };
}

/**
 * The value a new goal starts from: weight → today's trend; sleep_share → share of the last 30 nights
 * (a hint for the target); counts start at 0.
 */
export async function goalStartValue(userId: number, metric: QuarterGoalMetric, param: number | null, today: string): Promise<number | null> {
  if (metric === 'trainings' || metric === 'habit_count' || metric === 'protein_days') return 0;
  const ctx = await loadCtx(userId, addDays(today, -SLEEP_BASELINE_DAYS), today);
  if (metric === 'weight') return ctx.trendNow !== null ? roundTo(ctx.trendNow, 2) : null;
  const s = sleepShare(ctx, param ?? 7, addDays(today, -SLEEP_BASELINE_DAYS), today);
  return s && s.nights >= MIN_SLEEP_NIGHTS ? s.pct : null;
}

/** One line for the morning briefing: the active goal with the nearest deadline. */
export async function nearestGoalLine(userId: number, today: string): Promise<string | null> {
  const row = await prisma.quarterGoal.findFirst({
    where: { userId, archived: false, deadline: { gte: today } },
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
  });
  if (!row) return null;
  const [p] = await progressFor(userId, [row], today);
  return p ? `🎯 ${p.summary}` : null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function buildDashboard(userId: number, weeks: 4 | 12, today: string): Promise<DashboardData> {
  const rangeStart = addDays(mondayOf(today), -7 * (weeks - 1));
  const goalRows = await prisma.quarterGoal.findMany({
    where: { userId, archived: false },
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
  });
  const from = minDate(rangeStart, ...goalRows.map((g) => g.startDate));
  const ctx = await loadCtx(userId, from, today);

  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(rangeStart, i * 7));
  const todayPlan = ctx.goal ? await computePlan(userId, today) : null;
  const [weekRows, goals] = await Promise.all([
    buildWeeks(userId, ctx, rangeStart, weeks, todayPlan),
    progressFor(userId, goalRows, today, ctx),
  ]);
  const phase = todayPlan?.phase ?? null;

  return {
    weeks: weekRows,
    weight: {
      points: ctx.weights.filter((w) => w.date >= rangeStart).map((w) => ({ date: w.date, kg: w.weightKg })),
      trend: [...ctx.trendByDate.entries()].filter(([d]) => d >= rangeStart).map(([date, kg]) => ({ date, kg })),
      plan: weightPlanLine(ctx, phase),
    },
    phaseLine: phase ? phaseLine(phase) : null,
    links: buildLinks(ctx, rangeStart, weekStarts),
    goals,
  };
}
