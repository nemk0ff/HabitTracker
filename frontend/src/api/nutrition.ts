import { api } from './client';
import type {
  Food,
  FoodDay,
  FoodLogEntry,
  Meal,
  MealTemplate,
  NutritionGoal,
  NutritionStats,
  Plan,
  Serving,
  WeightPoint,
} from '../types';

const BASE = '/api/nutrition';

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export function searchFoods(q: string, signal?: AbortSignal): Promise<Food[]> {
  return api<Food[]>(`${BASE}/foods/search?q=${encodeURIComponent(q)}`, { signal });
}

export function fetchRecentFoods(): Promise<Food[]> {
  return api<Food[]>(`${BASE}/foods/recent`);
}

export function fetchMyFoods(): Promise<Food[]> {
  return api<Food[]>(`${BASE}/foods/mine`);
}

export interface FoodInput {
  name: string;
  brand?: string | null;
  sourceUrl?: string | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servings?: Serving[];
}

export function createFood(data: FoodInput): Promise<Food> {
  return api<Food>(`${BASE}/foods`, json('POST', data));
}

export function updateFood(id: number, data: Partial<FoodInput>): Promise<Food> {
  return api<Food>(`${BASE}/foods/${id}`, json('PATCH', data));
}

export function deleteFood(id: number): Promise<void> {
  return api<void>(`${BASE}/foods/${id}`, { method: 'DELETE' });
}

export function setDayComplete(date: string, complete: boolean): Promise<void> {
  return api<void>(`${BASE}/day-complete`, json('PUT', { date, complete }));
}

export interface FrequentFood {
  food: Food;
  grams: number;
  count: number;
}

export function fetchFrequent(meal: Meal): Promise<FrequentFood[]> {
  return api<FrequentFood[]>(`${BASE}/foods/frequent?meal=${meal}`);
}

export function fetchFavorites(): Promise<Food[]> {
  return api<Food[]>(`${BASE}/favorites`);
}

export function setFavorite(foodId: number, favorite: boolean): Promise<void> {
  return api<void>(`${BASE}/favorites/${foodId}`, { method: favorite ? 'PUT' : 'DELETE' });
}

// ─── Diary ────────────────────────────────────────────────────────────────────

export function fetchDay(date: string): Promise<FoodDay> {
  return api<FoodDay>(`${BASE}/log?date=${date}`);
}

export type LogInput =
  | { date: string; meal: Meal; grams: number; foodId: number }
  | {
      date: string;
      meal: Meal;
      grams: number;
      name: string;
      kcal: number;
      protein: number;
      fat: number;
      carbs: number;
      source?: 'manual' | 'llm';
    };

export function addLogEntry(data: LogInput): Promise<FoodLogEntry> {
  return api<FoodLogEntry>(`${BASE}/log`, json('POST', data));
}

export function updateLogEntry(id: number, data: { grams?: number; meal?: Meal }): Promise<FoodLogEntry> {
  return api<FoodLogEntry>(`${BASE}/log/${id}`, json('PATCH', data));
}

export function deleteLogEntry(id: number): Promise<void> {
  return api<void>(`${BASE}/log/${id}`, { method: 'DELETE' });
}

export function copyDay(fromDate: string, toDate: string, meal?: Meal): Promise<FoodLogEntry[]> {
  return api<FoodLogEntry[]>(`${BASE}/log/copy`, json('POST', { fromDate, toDate, meal }));
}

// ─── Meal templates («наборы») ────────────────────────────────────────────────

export function fetchMealTemplates(): Promise<MealTemplate[]> {
  return api<MealTemplate[]>(`${BASE}/meal-templates`);
}

export type MealTemplateInput =
  | { name: string; meal?: Meal | null; items: { foodId: number; grams: number }[] }
  | { name: string; fromDate: string; fromMeal: Meal };

export function createMealTemplate(data: MealTemplateInput): Promise<MealTemplate> {
  return api<MealTemplate>(`${BASE}/meal-templates`, json('POST', data));
}

export function deleteMealTemplate(id: number): Promise<void> {
  return api<void>(`${BASE}/meal-templates/${id}`, { method: 'DELETE' });
}

/** Logs every item of the template into (date, meal); returns the created entries. */
export function applyMealTemplate(id: number, date: string, meal: Meal): Promise<FoodLogEntry[]> {
  return api<FoodLogEntry[]>(`${BASE}/meal-templates/${id}/apply`, json('POST', { date, meal }));
}

// ─── "Добавить текстом" via the Hermes agent (developer only) ─────────────────

export interface TextLogItem {
  entryId: number;
  foodId: number;
  name: string;
  brand: string | null;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  status: 'existing' | 'new';
}

export interface TextLogJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'undone';
  result: {
    date: string;
    meal: Meal;
    items: TextLogItem[];
    totals: { kcal: number; protein: number; fat: number; carbs: number };
    skipped: string[];
  } | null;
  error: string | null;
}

/** Starts a background agent job; poll it with getTextLog. */
export function startTextLog(text: string, date: string, meal: Meal): Promise<TextLogJob> {
  return api<TextLogJob>(`${BASE}/text-log`, json('POST', { text, date, meal }));
}

export function getTextLog(id: string): Promise<TextLogJob> {
  return api<TextLogJob>(`${BASE}/text-log/${id}`);
}

export function undoTextLog(id: string): Promise<void> {
  return api<void>(`${BASE}/text-log/${id}/undo`, { method: 'POST' });
}

// ─── Stats, goal, weight ──────────────────────────────────────────────────────

export function fetchStats(from: string, to: string): Promise<NutritionStats> {
  return api<NutritionStats>(`${BASE}/stats?from=${from}&to=${to}`);
}

export function fetchPlan(date: string): Promise<Plan> {
  return api<Plan>(`${BASE}/plan?date=${date}`);
}

export function fetchGoal(): Promise<NutritionGoal | null> {
  return api<NutritionGoal | null>(`${BASE}/goal`);
}

export function saveGoal(goal: NutritionGoal): Promise<NutritionGoal> {
  return api<NutritionGoal>(`${BASE}/goal`, json('PUT', goal));
}

export function saveWeight(date: string, weightKg: number): Promise<WeightPoint> {
  return api<WeightPoint>(`${BASE}/weight`, json('PUT', { date, weightKg }));
}

export function deleteWeight(date: string): Promise<void> {
  return api<void>(`${BASE}/weight/${date}`, { method: 'DELETE' });
}
