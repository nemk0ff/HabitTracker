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
  createdAt: string;
  entries: HabitEntry[];
}

export interface User {
  id: number;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
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

export type Screen = 'home' | 'habit' | 'create' | 'edit';
