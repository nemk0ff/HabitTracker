import { addDays, differenceInCalendarDays, parseISO, startOfWeek, subWeeks } from 'date-fns';
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

/** Entries as heatmap levels 0–3 (hours/count are bucketed, binary is always full). `skipped` is kept. */
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
  days: { date: string; done: boolean; future: boolean; skipped: boolean }[];
  done: number;
  /** Times per week the habit aims for (7 for daily habits). */
  target: number;
  /** Skipped days this week (ill / vacation). */
  skipped: number;
  /** Done days this week's goal actually needs: max(0, target − skipped). */
  needed: number;
}

/** Entries that count as a done day (count habits: value ≥ dailyTarget). A skip never does. */
export function doneEntries(h: Habit): HabitEntry[] {
  return h.entries.filter((e) => !e.skipped && isDoneValue(h, e.value));
}

/** Dates with a done mark (a skip is not one). */
export function markedDates(h: Habit): Set<string> {
  return new Set(doneEntries(h).map((e) => e.date));
}

/** Days marked as a deliberate pass (ill / vacation). */
export function skippedDates(h: Pick<Habit, 'entries'>): Set<string> {
  return new Set(h.entries.filter((e) => e.skipped).map((e) => e.date));
}

/** The habit is skipped (a pass that keeps the streak) on `date`. */
export function isSkippedOn(h: Pick<Habit, 'entries'>, date: string): boolean {
  return h.entries.some((e) => e.date === date && e.skipped);
}

/** Done days a week needs when `skipped` of its days are passes: max(0, target − skipped). */
export function neededForWeek(target: number, skipped: number): number {
  return Math.max(0, target - skipped);
}

/** This week's marks against the habit's frequency goal (skipped days lower the goal). */
export function weekProgress(h: Habit, today: string): WeekProgress {
  const marked = markedDates(h);
  const skips = skippedDates(h);
  const days = weekDates(today).map((date) => ({
    date,
    done: marked.has(date),
    future: date > today,
    skipped: !marked.has(date) && skips.has(date),
  }));
  const target = h.weeklyTarget ?? 7;
  const skipped = days.filter((d) => d.skipped).length;
  return { days, done: days.filter((d) => d.done).length, target, skipped, needed: neededForWeek(target, skipped) };
}

/** Habit has a done mark on `date` (a skip is not a mark). */
export function isMarkedOn(h: Habit, date: string): boolean {
  return markedDates(h).has(date);
}

/** Nothing left to do for the habit on `date`: done or deliberately skipped. */
export function isClosedOn(h: Habit, date: string): boolean {
  return isMarkedOn(h, date) || isSkippedOn(h, date);
}

/**
 * The day counts as closed when every habit that existed then is marked or skipped that day,
 * or (weekly-goal habits) its week's goal, lowered by skipped days, is already met.
 */
export function isDayClosed(habits: Habit[], date: string): boolean {
  const active = habits.filter((h) => habitStartDate(h) <= date);
  if (active.length === 0) return false;
  return active.every((h) => {
    if (isClosedOn(h, date)) return true;
    if (h.weeklyTarget === null) return false;
    const w = weekProgress(h, date);
    return w.done >= w.needed;
  });
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

/**
 * Latest activity on any habit strictly before `before` (YYYY-MM-DD) — a done mark or a skip
 * (a deliberate pass is activity too) — or null if there is none.
 */
export function lastMarkDate(habits: Habit[], before: string): string | null {
  let last: string | null = null;
  for (const h of habits) {
    for (const e of h.entries) {
      if (!e.skipped && !isDoneValue(h, e.value)) continue;
      if (e.date < before && (last === null || e.date > last)) last = e.date;
    }
  }
  return last;
}

/** Days without any mark or skip after which the user counts as returning. */
export const RETURN_BREAK_DAYS = 3;

/**
 * The user has marks, but the last mark or skip before today is ≥3 days old: Today greets them
 * softly and hides zero streaks. A vacation run of skips is not a break. Stable for the whole
 * day — today's own marks don't flip it.
 */
export function isReturningUser(habits: Habit[], today: string): boolean {
  const last = lastMarkDate(habits, today);
  if (last === null) return false;
  return differenceInCalendarDays(parseISO(today), parseISO(last)) >= RETURN_BREAK_DAYS;
}

/**
 * Diagonal hatch of a skipped heatmap cell in the habit colour at low alpha.
 * Use as `backgroundImage` over the empty-cell `backgroundColor`.
 */
export function skipHatch(color: string, line = 2, gap = 4): string {
  const ink = `color-mix(in srgb, ${color} 55%, transparent)`;
  return `repeating-linear-gradient(135deg, ${ink} 0 ${line}px, transparent ${line}px ${line + gap}px)`;
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
 * Weeks in a row that met the frequency goal (a week needs max(0, target − skipped days)).
 * The current week counts once it's met, otherwise the run is measured up to last week (an
 * unfinished week doesn't break it). A fully skipped week — nothing needed, nothing done —
 * is transparent: it neither breaks nor extends the run.
 */
export function weeklyStreak(h: Habit, today: string): number {
  const target = h.weeklyTarget ?? 7;
  const marked = markedDates(h);
  const skips = skippedDates(h);
  const week = (d: string) => {
    const days = weekDates(d);
    const done = days.filter((x) => marked.has(x)).length;
    const skipped = days.filter((x) => !marked.has(x) && skips.has(x)).length;
    return { done, needed: neededForWeek(target, skipped) };
  };
  let streak = 0;
  let cursor = today;
  const cur = week(cursor);
  if (cur.done > 0 && cur.done >= cur.needed) streak++;
  // Entries are loaded for 18 weeks — don't look further back than that.
  for (let i = 0; i < 18; i++) {
    cursor = toDateString(subWeeks(parseISO(cursor), 1));
    const w = week(cursor);
    if (w.done === 0 && w.needed === 0) continue;
    if (w.done < w.needed) break;
    streak++;
  }
  return streak;
}
