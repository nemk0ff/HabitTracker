import { api } from './client';
import type { DashboardData, QuarterGoal, QuarterGoalMetric } from '../types';

export type DashboardWeeks = 4 | 12;

export function fetchDashboard(weeks: DashboardWeeks): Promise<DashboardData> {
  return api<DashboardData>(`/api/dashboard?weeks=${weeks}`);
}

// ─── Quarter goals ────────────────────────────────────────────────────────────

export interface GoalInput {
  title: string;
  metric: QuarterGoalMetric;
  target: number;
  /** sleep_share: hours threshold; habit_count: habitId. */
  param?: number | null;
  /** Local YYYY-MM-DD. */
  deadline: string;
}

export interface GoalPatch {
  title?: string;
  target?: number;
  deadline?: string;
  archived?: boolean;
}

export function fetchGoals(): Promise<QuarterGoal[]> {
  return api<QuarterGoal[]>('/api/goals');
}

export function createGoal(data: GoalInput): Promise<QuarterGoal> {
  return api<QuarterGoal>('/api/goals', { method: 'POST', body: JSON.stringify(data) });
}

export function updateGoal(id: number, data: GoalPatch): Promise<QuarterGoal> {
  return api<QuarterGoal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteGoal(id: number): Promise<void> {
  return api<void>(`/api/goals/${id}`, { method: 'DELETE' });
}
