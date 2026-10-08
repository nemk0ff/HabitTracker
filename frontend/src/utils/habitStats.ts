import { parseISO, startOfWeek } from 'date-fns';
import { calculateStreak, shiftDate, toDateString } from './dates';
import { doneEntries } from './habits';
import type { Habit } from '../types';

/** Pure per-habit numbers for the Progress card. `today` is a local YYYY-MM-DD. */

/** Local YYYY-MM-DD of the day the habit was created. */
export function createdDate(h: Pick<Habit, 'createdAt'>): string {
  return toDateString(new Date(h.createdAt));
}

/**
 * First day the habit "exists" for stats and the heatmap: the creation day, or the earliest
 * entry if the user backfilled days before that. Single source for every created-date clip.
 */
export function habitStartDate(h: Pick<Habit, 'createdAt' | 'entries'>): string {
  let start = createdDate(h);
  for (const e of h.entries) if (e.date < start) start = e.date;
  return start;
}

/** Current and best daily streaks over done days only. */
export function streaks(h: Habit): { current: number; best: number } {
  return calculateStreak(doneEntries(h));
}

export function bestStreak(h: Habit): number {
  return streaks(h).best;
}

/**
 * Share of done days (0–100) within the last `days` days, never counting days before the
 * habit's start (`habitStartDate`). Null when the window is empty.
 */
export function completionRate(h: Habit, days: number, today: string): number | null {
  const created = habitStartDate(h);
  const windowStart = shiftDate(today, -(days - 1));
  const from = created > windowStart ? created : windowStart;
  if (from > today) return null;
  const total = Math.round((parseISO(today).getTime() - parseISO(from).getTime()) / 86_400_000) + 1;
  if (total <= 0) return null;
  const done = new Set(doneEntries(h).filter((e) => e.date >= from && e.date <= today).map((e) => e.date)).size;
  return Math.round((done / total) * 100);
}

/** Mean `value` over the logged days (value > 0) within the last `days` days, or null. */
export function averageValue(h: Habit, days: number, today: string): number | null {
  const from = shiftDate(today, -(days - 1));
  const xs = h.entries.filter((e) => e.value > 0 && e.date >= from && e.date <= today).map((e) => e.value);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Today's raw value (0 when nothing logged). */
export function valueOn(h: Habit, date: string): number {
  return h.entries.find((e) => e.date === date)?.value ?? 0;
}

/** Monday (YYYY-MM-DD) of every week whose frequency goal was met. Empty for daily habits. */
export function metWeekStarts(h: Habit): Set<string> {
  const met = new Set<string>();
  if (!h.weeklyTarget) return met;
  const perWeek = new Map<string, number>();
  for (const e of doneEntries(h)) {
    const monday = toDateString(startOfWeek(parseISO(e.date), { weekStartsOn: 1 }));
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  for (const [monday, n] of perWeek) if (n >= h.weeklyTarget) met.add(monday);
  return met;
}

/** 7 → «7», 7.5 → «7,5» (one decimal at most, Russian comma). */
export function formatNumber(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}
