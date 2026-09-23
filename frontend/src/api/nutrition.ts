import { api } from './client';
import type {
  Food,
  FoodDay,
  FoodLogEntry,
  Meal,
  NutritionGoal,
  NutritionStats,
  ParsedItem,
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

/** LLM text parsing — the backend answers 501 until stage 2 ships. */
export function parseText(text: string): Promise<{ items: ParsedItem[] }> {
  return api<{ items: ParsedItem[] }>(`${BASE}/parse`, json('POST', { text }));
}

// ─── Stats, goal, weight ──────────────────────────────────────────────────────

export function fetchStats(from: string, to: string): Promise<NutritionStats> {
  return api<NutritionStats>(`${BASE}/stats?from=${from}&to=${to}`);
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
