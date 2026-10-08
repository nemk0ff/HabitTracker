/**
 * Habit entry writes + streak / week stats shared by the API, the evening check-in
 * and (later) a weekly summary. Dates are local 'YYYY-MM-DD' strings; HabitEntry
 * stores them as UTC midnight.
 */
import { prisma } from '../db.js';
import { pluralForm } from '../utils/plural.js';

const DAY_MS = 86_400_000;

// ─── Dates ────────────────────────────────────────────────────────────────────

export function dayDate(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return toDateString(new Date(dayDate(date).getTime() + n * DAY_MS));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (dayDate(date).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

// ─── Entry writes ─────────────────────────────────────────────────────────────

interface EntryHabit {
  id: number;
  measure: string | null;
}

/** Hours habits store minutes (0–24h); count habits store how many (0–999); level habits store 0–4. */
export function maxEntryValue(habit: Pick<EntryHabit, 'measure'>): number {
  if (habit.measure === 'hours') return 1440;
  if (habit.measure === 'count') return 999;
  return 4;
}

export function isValidEntryValue(habit: Pick<EntryHabit, 'measure'>, value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maxEntryValue(habit);
}

export interface DoneHabit {
  measure: string | null;
  dailyTarget: number | null;
}

/** Whether an entry value counts as "done" for the day. Count habits need value ≥ dailyTarget (min 1). */
export function isDone(habit: DoneHabit, value: number | null | undefined): boolean {
  if (!value || value <= 0) return false;
  if (habit.measure === 'count') return value >= Math.max(1, habit.dailyTarget ?? 1);
  return true;
}

/**
 * Upserts the entry for `date`, or deletes it when `value` is 0.
 * Caller validates ownership and the value range. Returns the entry, or null when deleted.
 */
export async function setHabitEntry(habit: EntryHabit, entryDate: Date, value: number) {
  if (value === 0) {
    await prisma.habitEntry.deleteMany({ where: { habitId: habit.id, date: entryDate } });
    return null;
  }
  return prisma.habitEntry.upsert({
    where: { habitId_date: { habitId: habit.id, date: entryDate } },
    update: { value },
    create: { habitId: habit.id, date: entryDate, value },
  });
}

// ─── Streaks ──────────────────────────────────────────────────────────────────

export interface Streak {
  count: number;
  unit: 'day' | 'week';
}

/** Days in a row ending today; an unmarked today doesn't break the streak yet. */
export function dailyStreak(dates: ReadonlySet<string>, today: string): number {
  let day = dates.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (dates.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** Monday weeks in a row with ≥ `target` marks; an unfinished current week doesn't break it. */
export function weeklyStreak(dates: ReadonlySet<string>, target: number, today: string): number {
  const perWeek = new Map<string, number>();
  for (const d of dates) {
    if (d > today) continue;
    const w = mondayOf(d);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const met = (w: string) => (perWeek.get(w) ?? 0) >= target;
  let week = mondayOf(today);
  if (!met(week)) week = addDays(week, -7);
  let count = 0;
  while (met(week)) {
    count++;
    week = addDays(week, -7);
  }
  return count;
}

export function habitStreak(habit: { weeklyTarget: number | null }, dates: ReadonlySet<string>, today: string): Streak {
  return habit.weeklyTarget
    ? { count: weeklyStreak(dates, habit.weeklyTarget, today), unit: 'week' }
    : { count: dailyStreak(dates, today), unit: 'day' };
}

/** "5 дней" / "3 недели". */
export function formatStreak(s: Streak): string {
  return s.unit === 'day'
    ? `${s.count} ${pluralForm(s.count, 'день', 'дня', 'дней')}`
    : `${s.count} ${pluralForm(s.count, 'неделя', 'недели', 'недель')}`;
}

// ─── Week stats ───────────────────────────────────────────────────────────────

export interface WeekHabitStat {
  habitId: number;
  name: string;
  done: number;
  target: number;
}

export interface WeekStats {
  done: number;
  target: number;
  best: WeekHabitStat | null;
  habits: WeekHabitStat[];
}

/**
 * Done days (see `datesByHabit`) in the Monday week containing `date` (up to `date`). Target per habit is its
 * weeklyTarget or 7; marks above the target don't count toward the total.
 */
export function weekStats(
  habits: { id: number; name: string; weeklyTarget: number | null }[],
  datesByHabit: ReadonlyMap<number, ReadonlySet<string>>,
  date: string,
): WeekStats {
  const from = mondayOf(date);
  const stats = habits.map((h) => {
    let done = 0;
    for (const d of datesByHabit.get(h.id) ?? []) if (d >= from && d <= date) done++;
    return { habitId: h.id, name: h.name, done, target: h.weeklyTarget ?? 7 };
  });
  const best = stats
    .filter((s) => s.done > 0)
    .sort((a, b) => b.done / b.target - a.done / a.target || b.done - a.done)[0] ?? null;
  return {
    done: stats.reduce((s, h) => s + Math.min(h.done, h.target), 0),
    target: stats.reduce((s, h) => s + h.target, 0),
    best,
    habits: stats,
  };
}

/** Groups done entries (per `isDone`) into habitId → set of 'YYYY-MM-DD'. Entries of habits not in `habits` are dropped. */
export function datesByHabit(
  entries: { habitId: number; date: Date; value: number }[],
  habits: ({ id: number } & DoneHabit)[],
): Map<number, Set<string>> {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const map = new Map<number, Set<string>>();
  for (const e of entries) {
    const habit = byId.get(e.habitId);
    if (!habit || !isDone(habit, e.value)) continue;
    let set = map.get(e.habitId);
    if (!set) map.set(e.habitId, (set = new Set()));
    set.add(toDateString(e.date));
  }
  return map;
}
