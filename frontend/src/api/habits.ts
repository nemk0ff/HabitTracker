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
  /** Challenge length in done days (3–365); null = a plain habit. */
  challengeDays?: number | null;
  /** Local YYYY-MM-DD the challenge starts (today when created). */
  challengeStart?: string | null;
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
  /** null ends the challenge and keeps the habit going. */
  challengeDays?: number | null;
  challengeStart?: string | null;
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

/**
 * Upserts a day: `value > 0` marks (and clears a skip), `value 0` deletes,
 * `skipped: true` (with value 0) stores a pass that keeps the streak (overrides a mark).
 */
export function toggleEntry(
  habitId: number,
  date: string,
  value: number,
  skipped = false,
): Promise<HabitEntry | { deleted: boolean; date: string }> {
  return api(`/api/habits/${habitId}/entries`, {
    method: 'POST',
    body: JSON.stringify(skipped ? { date, value: 0, skipped: true } : { date, value }),
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
