import { differenceInCalendarDays, parseISO, startOfWeek } from 'date-fns';
import { calculateStreak, shiftDate, toDateString } from './dates';
import { doneEntries, isDoneValue, neededForWeek, skippedDates } from './habits';
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

/** Current and best daily streaks over done days; skipped days are transparent (no break, no +1). */
export function streaks(h: Habit): { current: number; best: number } {
  return calculateStreak(doneEntries(h), skippedDates(h));
}

export function bestStreak(h: Habit): number {
  return streaks(h).best;
}

/**
 * Share of done days (0–100) from `from` through `to`, never counting days before the habit's
 * start (`habitStartDate`). Skipped days are left out of the window (a pass is neither done nor
 * missed). Null when the window is empty. Count habits: "done" means the daily target was met.
 */
export function rateBetween(h: Habit, from: string, to: string): number | null {
  const start = habitStartDate(h);
  const first = start > from ? start : from;
  if (first > to) return null;
  const done = new Set(doneEntries(h).filter((e) => e.date >= first && e.date <= to).map((e) => e.date));
  const skipped = [...skippedDates(h)].filter((d) => d >= first && d <= to && !done.has(d)).length;
  const total = differenceInCalendarDays(parseISO(to), parseISO(first)) + 1 - skipped;
  if (total <= 0) return null;
  return Math.round((done.size / total) * 100);
}

/** `rateBetween` over the last `days` days ending `today`. */
export function completionRate(h: Habit, days: number, today: string): number | null {
  return rateBetween(h, shiftDate(today, -(days - 1)), today);
}

/** Mean `value` over the logged days (value > 0) within the last `days` days, or null. */
export function averageValue(h: Habit, days: number, today: string): number | null {
  const from = shiftDate(today, -(days - 1));
  const xs = h.entries.filter((e) => e.value > 0 && e.date >= from && e.date <= today).map((e) => e.value);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Today's raw value (0 when nothing logged or the day is skipped). */
export function valueOn(h: Habit, date: string): number {
  return h.entries.find((e) => e.date === date)?.value ?? 0;
}

/**
 * Monday (YYYY-MM-DD) of every week whose frequency goal was met: a week needs
 * max(0, target − skipped days) done days, and at least one. Empty for daily habits.
 */
export function metWeekStarts(h: Habit): Set<string> {
  const met = new Set<string>();
  if (!h.weeklyTarget) return met;
  const mondayOf = (date: string) => toDateString(startOfWeek(parseISO(date), { weekStartsOn: 1 }));
  const perWeek = new Map<string, number>();
  const doneDates = new Set<string>();
  for (const e of doneEntries(h)) {
    doneDates.add(e.date);
    const monday = mondayOf(e.date);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  const skippedPerWeek = new Map<string, number>();
  for (const d of skippedDates(h)) {
    if (doneDates.has(d)) continue;
    const monday = mondayOf(d);
    skippedPerWeek.set(monday, (skippedPerWeek.get(monday) ?? 0) + 1);
  }
  for (const [monday, n] of perWeek) {
    if (n >= neededForWeek(h.weeklyTarget, skippedPerWeek.get(monday) ?? 0)) met.add(monday);
  }
  return met;
}

/** 7 → «7», 7.5 → «7,5» (one decimal at most, Russian comma). */
export function formatNumber(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

export interface ChallengeProgress {
  /** Done days since the start (skips don't count). Capped at `total`. */
  done: number;
  total: number;
  /** Day of the challenge, 1-based («День 14 из 30»); skipped days don't advance it. Capped at `total`. */
  dayIndex: number;
  /** Last day the challenge can still be completed: start + total − 1, pushed back by each skipped day. */
  deadline: string;
  /** Succeeded, or the deadline has passed. */
  finished: boolean;
  succeeded: boolean;
}

/**
 * Progress of a challenge habit (null for a plain habit). A challenge is `challengeDays` done
 * days counted from `challengeStart`; a pass (ill / vacation) is not a done day but moves the
 * deadline by a day, so a sick day doesn't sink a 30-day challenge.
 */
export function challengeProgress(
  h: Pick<Habit, 'challengeDays' | 'challengeStart' | 'entries' | 'measure' | 'dailyTarget'>,
  today: string,
): ChallengeProgress | null {
  if (!h.challengeDays || !h.challengeStart) return null;
  const start = h.challengeStart;
  const total = h.challengeDays;
  let skipped = 0;
  let done = 0;
  for (const e of h.entries) {
    if (e.date < start || e.date > today) continue; // same window as the backend's challengeProgress
    if (e.skipped) skipped++;
    else if (isDoneValue(h, e.value)) done++;
  }
  const deadline = shiftDate(start, total - 1 + skipped);
  const succeeded = done >= total;
  const elapsed = differenceInCalendarDays(parseISO(today), parseISO(start)) + 1;
  return {
    done: Math.min(done, total),
    total,
    dayIndex: Math.max(1, Math.min(elapsed - skipped, total)),
    deadline,
    finished: succeeded || today > deadline,
    succeeded,
  };
}
