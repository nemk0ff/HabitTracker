export interface HabitEntry {
  id: number;
  date: string; // YYYY-MM-DD
  value: number; // 0-3
}

export interface Habit {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  binary: boolean;
  /** null = intensity levels; 'hours' = entry value is minutes. */
  measure: 'hours' | null;
  createdAt: string;
  entries: HabitEntry[];
}

export interface User {
  id: number;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isAdmin: boolean;
  features: {
    nutrition: boolean;
    /** "Добавить текстом" through the developer's Hermes agent. */
    agentLog: boolean;
  };
}

export interface AdminUserGroup {
  user: {
    id: number;
    telegramId: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastSeenAt: string | null;
  };
  habits: Habit[];
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
  | 'admin'
  | 'food-day'
  | 'food-add'
  | 'food-product'
  | 'food-stats'
  | 'food-goal';

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
}

export interface FoodDay {
  date: string;
  entries: FoodLogEntry[];
  totals: Macros;
  goal: NutritionGoal | null;
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
  trendKg: number | null;
  trendKgPerWeek: number | null;
  trainingsPerWeek: number | null;
  sleepLastNightH: number | null;
  sleepAvg7H: number | null;
  insights: Insight[];
}
