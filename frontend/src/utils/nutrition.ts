import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DayTotals, Food, Macros, Meal, NutritionGoal, WeightPoint } from '../types';

/** Accent color of the nutrition module (heatmap, rings, buttons). */
export const NUTRITION_COLOR = '#2E9A6E';
/** Neutral progress-track color readable in both light and dark Telegram themes. */
export const TRACK_COLOR = 'rgba(128,128,128,0.18)';
export const MACRO_COLORS = { protein: '#C2366A', fat: '#C9971C', carbs: '#4A74C0' };

export const MEALS: { key: Meal; label: string; icon: string }[] = [
  { key: 'breakfast', label: 'Завтрак', icon: '🍳' },
  { key: 'lunch', label: 'Обед', icon: '🍲' },
  { key: 'dinner', label: 'Ужин', icon: '🍽' },
  { key: 'snack', label: 'Перекус', icon: '🍎' },
];

export const KCAL_PER_KG = 7700;

export function mealLabel(meal: Meal): string {
  return MEALS.find((m) => m.key === meal)?.label ?? meal;
}

/** Meal that fits the current local time — default for "add food". */
export function mealByTime(date = new Date()): Meal {
  const h = date.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export function round(n: number, digits = 0): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

export function fmt(n: number, digits = 0): string {
  return round(n, digits).toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

/**
 * Protein target when the model's plan isn't loaded: only a manual grams goal is usable —
 * a per-kg goal follows the weight trend, so its stored grams would be stale (null instead).
 */
export function fallbackProtein(goal: Pick<NutritionGoal, 'protein' | 'proteinPerKg'> | null | undefined): number | null {
  if (!goal || goal.proteinPerKg != null) return null;
  return goal.protein ?? null;
}

export function scaleMacros(per100: Macros, grams: number): Macros {
  const k = grams / 100;
  return {
    kcal: per100.kcal * k,
    protein: per100.protein * k,
    fat: per100.fat * k,
    carbs: per100.carbs * k,
  };
}

export function sumMacros(items: Macros[]): Macros {
  return items.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein: a.protein + m.protein,
      fat: a.fat + m.fat,
      carbs: a.carbs + m.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

export function foodSourceLabel(f: Food): string {
  if (f.own) return 'Мой';
  if (f.source === 'off') return 'Из интернета';
  if (f.source === 'llm') return 'Нашёл агент';
  return 'База';
}

/** "сегодня" / "вчера" / "пн, 21 сентября". */
export function formatDayTitle(date: string, today: string): string {
  const diff = differenceInCalendarDays(parseISO(today), parseISO(date));
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff === -1) return 'Завтра';
  return format(parseISO(date), 'EEEEEE, d MMMM', { locale: ru });
}

/**
 * Heatmap intensity (1–4) of a day relative to the kcal goal:
 * <50% → 1, 50–90% → 2, 90–110% (on target) → 3, >110% → 4.
 */
export function goalLevel(kcal: number, goalKcal: number | null | undefined): number {
  if (kcal <= 0) return 0;
  if (!goalKcal) return 3;
  const r = kcal / goalKcal;
  if (r < 0.5) return 1;
  if (r < 0.9) return 2;
  if (r <= 1.1) return 3;
  return 4;
}

export function isOnTarget(kcal: number, goalKcal: number): boolean {
  const r = kcal / goalKcal;
  return r >= 0.9 && r <= 1.1;
}

/** Consecutive on-target days ending today (or yesterday, if today isn't done yet). */
export function targetStreak(days: DayTotals[], goalKcal: number, today: string): number {
  const hit = new Set(days.filter((d) => isOnTarget(d.kcal, goalKcal)).map((d) => d.date));
  let d = parseISO(today);
  if (!hit.has(today)) d = new Date(d.getTime() - 86_400_000);
  let streak = 0;
  while (hit.has(format(d, 'yyyy-MM-dd'))) {
    streak++;
    d = new Date(d.getTime() - 86_400_000);
  }
  return streak;
}

// ─── Weight forecast ──────────────────────────────────────────────────────────

export interface Forecast {
  currentKg: number | null;
  /** Gained (or lost, negative) since the start weight. */
  changedKg: number | null;
  /** Total change the goal asks for. */
  goalChangeKg: number | null;
  daysLeft: number | null;
  /** Measured trend, kg per week (least squares over the last 28 days). */
  trendKgPerWeek: number | null;
  /** Required pace from now, kg per week. */
  requiredKgPerWeek: number | null;
  projectedKg: number | null;
  /** Extra kcal/day needed to catch up with the required pace (negative = ahead). */
  kcalAdjustment: number | null;
}

function slopePerDay(points: WeightPoint[]): number | null {
  if (points.length < 2) return null;
  const t0 = parseISO(points[0]!.date).getTime();
  const xs = points.map((p) => (parseISO(p.date).getTime() - t0) / 86_400_000);
  const ys = points.map((p) => p.weightKg);
  const span = xs[xs.length - 1]! - xs[0]!;
  if (span < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function computeForecast(goal: NutritionGoal | null, weights: WeightPoint[], today: string): Forecast {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const currentKg = sorted.length ? sorted[sorted.length - 1]!.weightKg : goal?.startWeightKg ?? null;
  const startKg = goal?.startWeightKg ?? sorted[0]?.weightKg ?? null;
  const targetKg = goal?.targetWeightKg ?? null;

  const daysLeft = goal?.targetDate
    ? Math.max(0, differenceInCalendarDays(parseISO(goal.targetDate), parseISO(today)))
    : null;

  const recentFrom = format(new Date(parseISO(today).getTime() - 28 * 86_400_000), 'yyyy-MM-dd');
  const slope = slopePerDay(sorted.filter((p) => p.date >= recentFrom));

  const requiredPerDay =
    currentKg !== null && targetKg !== null && daysLeft ? (targetKg - currentKg) / daysLeft : null;

  return {
    currentKg,
    changedKg: currentKg !== null && startKg !== null ? currentKg - startKg : null,
    goalChangeKg: startKg !== null && targetKg !== null ? targetKg - startKg : null,
    daysLeft,
    trendKgPerWeek: slope !== null ? slope * 7 : null,
    requiredKgPerWeek: requiredPerDay !== null ? requiredPerDay * 7 : null,
    projectedKg: slope !== null && currentKg !== null && daysLeft !== null ? currentKg + slope * daysLeft : null,
    kcalAdjustment:
      slope !== null && requiredPerDay !== null ? (requiredPerDay - slope) * KCAL_PER_KG : null,
  };
}

// ─── Goal calculator (Mifflin–St Jeor) ────────────────────────────────────────

export type Sex = 'male' | 'female';

export const ACTIVITY_LEVELS = [
  { factor: 1.2, label: 'Сидячий' },
  { factor: 1.375, label: 'Лёгкая (1–3 трен./нед)' },
  { factor: 1.55, label: 'Средняя (3–5 трен./нед)' },
  { factor: 1.725, label: 'Высокая (6–7 трен./нед)' },
];

export interface CalcInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: number;
  targetWeightKg: number;
  targetDate: string;
}

export interface CalcResult {
  tdee: number;
  dailyDelta: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export function calculateGoal(input: CalcInput, today: string): CalcResult {
  const bmr =
    10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === 'male' ? 5 : -161);
  const tdee = bmr * input.activity;
  const days = Math.max(1, differenceInCalendarDays(parseISO(input.targetDate), parseISO(today)));
  const dailyDelta = ((input.targetWeightKg - input.weightKg) * KCAL_PER_KG) / days;
  const kcal = Math.round((tdee + dailyDelta) / 50) * 50;

  // Protein 1.8 g/kg and fat 1 g/kg of current weight; carbs fill the rest.
  const protein = Math.round(input.weightKg * 1.8);
  const fat = Math.round(input.weightKg * 1);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { tdee: Math.round(tdee), dailyDelta: Math.round(dailyDelta), kcal, protein, fat, carbs };
}
