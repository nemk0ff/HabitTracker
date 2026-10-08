import { addDays, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { toDateString } from './dates';
import { habitStartDate } from './habitStats';
import type { Habit, HabitEntry, TimeOfDay } from '../types';

/** Hours habits store minutes in `value`. */
export function isHoursHabit(h: Pick<Habit, 'measure'>): boolean {
  return h.measure === 'hours';
}

/** Heatmap intensity for a night: <5 h → 1, 5–7 h → 2, 7+ h → 3. */
export function hoursLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 300) return 1;
  if (minutes < 420) return 2;
  return 3;
}

/** Count habits store how many were done in `value` and are done once it reaches `dailyTarget`. */
export function isCountHabit(h: Pick<Habit, 'measure'>): boolean {
  return h.measure === 'count';
}

/** Single source of truth for "this day counts as done" across every habit kind. */
export function isDoneValue(h: Pick<Habit, 'measure' | 'dailyTarget'>, value: number): boolean {
  if (value <= 0) return false;
  if (isCountHabit(h)) return value >= Math.max(1, h.dailyTarget ?? 1);
  return true;
}

/** Heatmap intensity 0–3 for any habit kind (count: share of the daily target). */
export function entryLevel(h: Pick<Habit, 'measure' | 'dailyTarget' | 'binary'>, value: number): number {
  if (value <= 0) return 0;
  if (isHoursHabit(h)) return hoursLevel(value);
  if (isCountHabit(h)) {
    const share = value / Math.max(1, h.dailyTarget ?? 1);
    return share >= 1 ? 3 : share >= 0.5 ? 2 : 1;
  }
  return h.binary ? 3 : Math.min(value, 3);
}

/** Entries as heatmap levels 0–3 (hours/count are bucketed, binary is always full). */
export function levelEntries(h: Habit): HabitEntry[] {
  return h.entries.map((e) => ({ ...e, value: entryLevel(h, e.value) }));
}

export const TIME_OF_DAY: { key: TimeOfDay | null; label: string }[] = [
  { key: 'morning', label: 'Утро' },
  { key: 'day', label: 'День' },
  { key: 'evening', label: 'Вечер' },
  { key: null, label: 'В любое время' },
];

/** Manual order first, then creation — the order of Today and Progress. Archived habits are excluded. */
export function sortHabits(habits: Habit[]): Habit[] {
  return habits
    .filter((h) => !h.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function formatHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
}

/** The Monday-based week containing `date`, as 7 YYYY-MM-DD strings. */
export function weekDates(date: string): string[] {
  const monday = startOfWeek(parseISO(date), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => toDateString(addDays(monday, i)));
}

export interface WeekProgress {
  days: { date: string; done: boolean; future: boolean }[];
  done: number;
  /** Times per week the habit aims for (7 for daily habits). */
  target: number;
}

/** Entries that count as a done day (count habits: value ≥ dailyTarget). */
export function doneEntries(h: Habit): HabitEntry[] {
  return h.entries.filter((e) => isDoneValue(h, e.value));
}

function markedDates(h: Habit): Set<string> {
  return new Set(doneEntries(h).map((e) => e.date));
}

/** This week's marks against the habit's frequency goal. */
export function weekProgress(h: Habit, today: string): WeekProgress {
  const marked = markedDates(h);
  const days = weekDates(today).map((date) => ({ date, done: marked.has(date), future: date > today }));
  return { days, done: days.filter((d) => d.done).length, target: h.weeklyTarget ?? 7 };
}

/** Habit has a mark (value > 0) on `date`. */
export function isMarkedOn(h: Habit, date: string): boolean {
  return markedDates(h).has(date);
}

/**
 * The day counts as closed when every habit that existed then is marked that day,
 * or (weekly-goal habits) its week's goal is already met.
 */
export function isDayClosed(habits: Habit[], date: string): boolean {
  const active = habits.filter((h) => habitStartDate(h) <= date);
  if (active.length === 0) return false;
  return active.every(
    (h) => isMarkedOn(h, date) || (h.weeklyTarget !== null && weekProgress(h, date).done >= h.weeklyTarget),
  );
}

/** Closed days in a row ending today (0 if today isn't closed). Looks back at most 18 weeks — what's loaded. */
export function closedDaysStreak(habits: Habit[], today: string): number {
  let streak = 0;
  let cursor = parseISO(today);
  for (let i = 0; i < 18 * 7; i++) {
    if (!isDayClosed(habits, toDateString(cursor))) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 1 день · 2 дня · 5 дней */
export function pluralDays(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/**
 * Weeks in a row that met the frequency goal. The current week counts once it's met,
 * otherwise the run is measured up to last week (an unfinished week doesn't break it).
 */
export function weeklyStreak(h: Habit, today: string): number {
  const target = h.weeklyTarget ?? 7;
  const marked = markedDates(h);
  const count = (d: string) => weekDates(d).filter((x) => marked.has(x)).length;
  let streak = 0;
  let cursor = today;
  if (count(cursor) >= target) streak++;
  // Entries are loaded for 18 weeks — don't look further back than that.
  for (let i = 0; i < 18; i++) {
    cursor = toDateString(subWeeks(parseISO(cursor), 1));
    if (count(cursor) < target) break;
    streak++;
  }
  return streak;
}
