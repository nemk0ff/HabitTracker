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

/** Daily target of a count habit (at least 1). */
export function countTarget(habit: Pick<DoneHabit, 'dailyTarget'>): number {
  return Math.max(1, habit.dailyTarget ?? 1);
}

/** Whether an entry value counts as "done" for the day. Count habits need value ≥ dailyTarget (min 1). A skipped day is never done. */
export function isDone(habit: DoneHabit, value: number | null | undefined, skipped = false): boolean {
  if (skipped || !value || value <= 0) return false;
  if (habit.measure === 'count') return value >= countTarget(habit);
  return true;
}

/**
 * Upserts the entry for `date`, or deletes it when `value` is 0. `skipped` stores a day off
 * (value 0 + skipped, overriding any mark); a value > 0 clears a skip.
 * Caller validates ownership and the value range. Returns the entry, or null when deleted.
 */
export async function setHabitEntry(habit: EntryHabit, entryDate: Date, value: number, skipped = false) {
  if (skipped) {
    return prisma.habitEntry.upsert({
      where: { habitId_date: { habitId: habit.id, date: entryDate } },
      update: { value: 0, skipped: true },
      create: { habitId: habit.id, date: entryDate, value: 0, skipped: true },
    });
  }
  if (value === 0) {
    await prisma.habitEntry.deleteMany({ where: { habitId: habit.id, date: entryDate } });
    return null;
  }
  return prisma.habitEntry.upsert({
    where: { habitId_date: { habitId: habit.id, date: entryDate } },
    update: { value, skipped: false },
    create: { habitId: habit.id, date: entryDate, value },
  });
}

// ─── Streaks ──────────────────────────────────────────────────────────────────

export interface Streak {
  count: number;
  unit: 'day' | 'week';
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Done days in a row ending today; an unmarked today doesn't break the streak yet. Skipped days are
 * transparent: they neither break nor extend it.
 */
export function dailyStreak(dates: ReadonlySet<string>, today: string, skipped: ReadonlySet<string> = NONE): number {
  const seen = (d: string) => dates.has(d) || skipped.has(d);
  let day = seen(today) ? today : addDays(today, -1);
  let count = 0;
  while (seen(day)) {
    if (dates.has(day)) count++;
    day = addDays(day, -1);
  }
  return count;
}

/** Done days a week needs for a weekly `target` when `skippedDays` of it are skipped. */
export function weekRequirement(target: number, skippedDays: number): number {
  return Math.max(0, target - skippedDays);
}

/**
 * Monday weeks in a row with ≥ `target` − (the week's skipped days) marks; an unfinished current week
 * doesn't break it. A week skipped down to a 0 requirement with nothing done is transparent.
 */
export function weeklyStreak(
  dates: ReadonlySet<string>,
  target: number,
  today: string,
  skipped: ReadonlySet<string> = NONE,
): number {
  const tally = (set: ReadonlySet<string>) => {
    const perWeek = new Map<string, number>();
    for (const d of set) {
      if (d > today) continue;
      const w = mondayOf(d);
      perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    }
    return perWeek;
  };
  const done = tally(dates);
  const skips = tally(skipped);
  const required = (w: string) => weekRequirement(target, skips.get(w) ?? 0);
  const transparent = (w: string) => required(w) === 0 && !done.has(w);
  const met = (w: string) => !transparent(w) && (done.get(w) ?? 0) >= required(w);

  let week = mondayOf(today);
  if (!met(week) && !transparent(week)) week = addDays(week, -7);
  let count = 0;
  while (met(week) || transparent(week)) {
    if (met(week)) count++;
    week = addDays(week, -7);
  }
  return count;
}

export function habitStreak(
  habit: { weeklyTarget: number | null },
  dates: ReadonlySet<string>,
  today: string,
  skipped: ReadonlySet<string> = NONE,
): Streak {
  return habit.weeklyTarget
    ? { count: weeklyStreak(dates, habit.weeklyTarget, today, skipped), unit: 'week' }
    : { count: dailyStreak(dates, today, skipped), unit: 'day' };
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
 * weeklyTarget or 7, minus the week's skipped days (`skippedByHabit`); marks above the target don't count toward the total.
 */
export function weekStats(
  habits: { id: number; name: string; weeklyTarget: number | null }[],
  datesByHabit: ReadonlyMap<number, ReadonlySet<string>>,
  date: string,
  skippedByHabit: ReadonlyMap<number, ReadonlySet<string>> = new Map(),
): WeekStats {
  const from = mondayOf(date);
  const to = addDays(from, 6);
  const stats = habits.map((h) => {
    let done = 0;
    for (const d of datesByHabit.get(h.id) ?? []) if (d >= from && d <= date) done++;
    let skips = 0;
    for (const d of skippedByHabit.get(h.id) ?? []) if (d >= from && d <= to) skips++;
    return { habitId: h.id, name: h.name, done, target: weekRequirement(h.weeklyTarget ?? 7, skips) };
  });
  const best = stats
    .filter((s) => s.done > 0 && s.target > 0)
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
  entries: { habitId: number; date: Date; value: number; skipped?: boolean }[],
  habits: ({ id: number } & DoneHabit)[],
): Map<number, Set<string>> {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const map = new Map<number, Set<string>>();
  for (const e of entries) {
    const habit = byId.get(e.habitId);
    if (!habit || !isDone(habit, e.value, e.skipped)) continue;
    let set = map.get(e.habitId);
    if (!set) map.set(e.habitId, (set = new Set()));
    set.add(toDateString(e.date));
  }
  return map;
}

/** Groups skipped entries into habitId → set of 'YYYY-MM-DD'. */
export function skippedByHabit(entries: { habitId: number; date: Date; skipped?: boolean }[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const e of entries) {
    if (!e.skipped) continue;
    let set = map.get(e.habitId);
    if (!set) map.set(e.habitId, (set = new Set()));
    set.add(toDateString(e.date));
  }
  return map;
}

/**
 * Challenge progress as of `date`: done days (`isDone`; skipped days don't count) from `challengeStart`
 * through `date`, capped at `challengeDays`. Same count as the client's `challengeProgress`
 * (frontend/src/utils/habitStats.ts). Null for a habit without a challenge.
 */
export function challengeProgress(
  h: DoneHabit & { id: number; challengeDays?: number | null; challengeStart?: string | null },
  entries: { habitId: number; date: Date; value: number; skipped?: boolean }[],
  date: string,
): { done: number; total: number } | null {
  if (!h.challengeDays || !h.challengeStart) return null;
  const from = dayDate(h.challengeStart).getTime();
  const to = dayDate(date).getTime();
  let done = 0;
  for (const e of entries) {
    const t = e.date.getTime();
    if (e.habitId === h.id && t >= from && t <= to && isDone(h, e.value, e.skipped)) done++;
  }
  return { done: Math.min(done, h.challengeDays), total: h.challengeDays };
}
