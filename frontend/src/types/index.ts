export interface HabitEntry {
  id: number;
  date: string; // YYYY-MM-DD
  /** Level 1–4, minutes (hours habits) or a count (count habits). 0 only together with `skipped`. */
  value: number;
  /** A deliberate pass (ill / vacation): not done, but it does not break the streak. */
  skipped?: boolean;
}

export type TimeOfDay = 'morning' | 'day' | 'evening';

export interface Habit {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  binary: boolean;
  /** null = intensity levels; 'hours' = entry value is minutes; 'count' = value is how many (vs dailyTarget). */
  measure: 'hours' | 'count' | null;
  /** null = every day; 1–6 = N times a week. */
  weeklyTarget: number | null;
  /** Section on the Today screen; null = «В любое время». */
  timeOfDay: TimeOfDay | null;
  /** Count habits: how many per day makes the day done (e.g. 8 glasses). Null for other kinds. */
  dailyTarget: number | null;
  /** Manual order on Today / Progress (ascending), then createdAt. */
  sortOrder: number;
  archived: boolean;
  /** Challenge: reach `challengeDays` done days counting from `challengeStart` (local YYYY-MM-DD). Null = not a challenge. */
  challengeDays: number | null;
  challengeStart: string | null;
  createdAt: string;
  entries: HabitEntry[];
}

export interface User {
  id: number;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  /** Evening check-in time, local HH:MM; null = no check-in message. */
  checkinTime?: string | null;
  /** Optional second check-in in the morning with morning habits only (local HH:MM). */
  morningCheckinTime?: string | null;
  /** Whether the bot can message this user (Telegram write access). null = unknown. */
  canMessage?: boolean | null;
}

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Reminder {
  id: number;
  habitId: number;
  enabled: boolean;
  days: DayOfWeek[];
  time: string;
  snooze: boolean;
}

export type Screen =
  | 'hub'
  | 'home'
  | 'habit'
  | 'create'
  | 'edit'
  | 'settings'
  | 'food-day'
  | 'food-add'
  | 'food-product'
  | 'food-stats'
  | 'food-goal'
  | 'food-suggest';

// ─── Nutrition ────────────────────────────────────────────────────────────────

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface Serving {
  label: string;
  grams: number;
}

/** Catalog food; macros are per 100 g. */
export interface Food extends Macros {
  id: number;
  name: string;
  brand: string | null;
  source: 'seed' | 'custom' | 'off' | 'llm';
  sourceUrl: string | null;
  servings: Serving[];
  own: boolean;
  /** Starred by the user (shown on "Что доесть"). */
  favorite: boolean;
}

/** Diary entry; macros are for the eaten `grams`. */
export interface FoodLogEntry extends Macros {
  id: number;
  date: string;
  meal: Meal;
  foodId: number | null;
  name: string;
  grams: number;
  source: 'manual' | 'llm';
}

export interface NutritionGoal {
  kcal: number;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  trainingHabitId: number | null;
  sleepHabitId: number | null;
  /** Protein target as g per kg of the weight trend; null = manual `protein` (or 1.8 g/kg default). */
  proteinPerKg: number | null;
  /** Ordered phases; the current one drives the kcal delta. Empty/null = old targetWeightKg/targetDate logic. */
  phases: GoalPhase[] | null;
}

export interface FoodDay {
  date: string;
  entries: FoodLogEntry[];
  totals: Macros;
  goal: NutritionGoal | null;
  /** User marked the day as fully logged. */
  complete: boolean;
}

export interface DayTotals extends Macros {
  date: string;
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface NutritionStats {
  /** Daily EMA-smoothed weight, from the first weigh-in. */
  trend: { date: string; trendKg: number }[];
  days: DayTotals[];
  weights: WeightPoint[];
  goal: NutritionGoal | null;
}

export interface Insight {
  level: 'good' | 'info' | 'warn';
  text: string;
}

/** Output of the backend nutrition model (GET /api/nutrition/plan). */
export interface Plan {
  date: string;
  mode: 'adaptive' | 'goal' | 'none';
  tdee: number | null;
  completeDays: number;
  dailyDelta: number | null;
  baseKcal: number | null;
  todayKcal: number | null;
  isTrainingDay: boolean;
  trainingBonus: number;
  proteinTarget: number | null;
  weightKg: number | null;
  lastWeightKg: number | null;
  trendKg: number | null;
  trendKgPerWeek: number | null;
  trainingsPerWeek: number | null;
  sleepLastNightH: number | null;
  sleepAvg7H: number | null;
  /** Current phase of the goal, null when no phases are set. */
  phase: PlanPhase | null;
  insights: Insight[];
}

/** A saved set of foods added in one tap («Мой завтрак»). */
export interface MealTemplate {
  id: number;
  name: string;
  /** Suggested meal slot, null = any. */
  meal: Meal | null;
  items: { foodId: number; name: string; grams: number; kcal: number }[];
  totals: { kcal: number; protein: number; fat: number; carbs: number };
}

export type PhaseType = 'bulk' | 'cut' | 'maintain';

export interface GoalPhase {
  type: PhaseType;
  /** Last day of the phase, local YYYY-MM-DD. */
  until: string;
  targetWeightKg?: number;
  rateKgPerWeek?: number;
}

export interface PlanPhase {
  type: PhaseType;
  /** «Набор до 77 кг», «Поддержание». */
  label: string;
  until: string;
  daysLeft: number;
  plannedRateKgWeek: number | null;
  actualRateKgWeek: number | null;
  onTrack: 'ahead' | 'on' | 'behind' | null;
}
