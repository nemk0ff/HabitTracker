import { api } from './client';
import type { Habit, HabitEntry, Reminder, TimeOfDay } from '../types';

/** All habits, archived included (filter with sortHabits for the active list). */
export function fetchHabits(): Promise<Habit[]> {
  return api<Habit[]>('/api/habits');
}

export interface CreateHabitData {
  name: string;
  color?: string;
  icon?: string;
  binary?: boolean;
  /** Set on creation only — entries aren't converted later. */
  measure?: 'hours' | 'count' | null;
  weeklyTarget?: number | null;
  timeOfDay?: TimeOfDay | null;
  /** Count habits only, 1–99. */
  dailyTarget?: number | null;
}

export interface UpdateHabitData {
  name?: string;
  color?: string;
  icon?: string;
  binary?: boolean;
  weeklyTarget?: number | null;
  timeOfDay?: TimeOfDay | null;
  dailyTarget?: number | null;
  archived?: boolean;
}

export function createHabit(data: CreateHabitData): Promise<Habit> {
  return api<Habit>('/api/habits', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateHabit(id: number, data: UpdateHabitData): Promise<Habit> {
  return api<Habit>(`/api/habits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Saves the manual order: `ids` top to bottom. */
export function reorderHabits(ids: number[]): Promise<unknown> {
  return api(`/api/habits/order`, {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}

export function deleteHabit(id: number): Promise<void> {
  return api(`/api/habits/${id}`, { method: 'DELETE' });
}

export function toggleEntry(
  habitId: number,
  date: string,
  value: number,
): Promise<HabitEntry | { deleted: boolean; date: string }> {
  return api(`/api/habits/${habitId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ date, value }),
  });
}

export function fetchReminder(habitId: number): Promise<Reminder | null> {
  return api<Reminder | null>(`/api/habits/${habitId}/reminder`);
}

export function saveReminder(
  habitId: number,
  data: { enabled: boolean; days: string[]; time: string; snooze: boolean },
): Promise<Reminder> {
  return api<Reminder>(`/api/habits/${habitId}/reminder`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteReminder(habitId: number): Promise<void> {
  return api(`/api/habits/${habitId}/reminder`, { method: 'DELETE' });
}
