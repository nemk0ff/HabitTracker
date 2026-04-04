import { api } from './client';
import type { Habit, HabitEntry, Reminder } from '../types';

export function fetchHabits(): Promise<Habit[]> {
  return api<Habit[]>('/api/habits');
}

export function createHabit(data: {
  name: string;
  color?: string;
  icon?: string;
  binary?: boolean;
}): Promise<Habit> {
  return api<Habit>('/api/habits', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateHabit(
  id: number,
  data: { name?: string; color?: string; icon?: string; binary?: boolean },
): Promise<Habit> {
  return api<Habit>(`/api/habits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
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
