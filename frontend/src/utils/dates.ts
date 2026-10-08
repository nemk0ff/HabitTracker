import {
  format,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  eachDayOfInterval,
  getDay,
  subDays,
  subWeeks,
  isToday,
  differenceInCalendarDays,
  parseISO,
} from 'date-fns';
import { ru } from 'date-fns/locale';

export function formatMonthYear(date: Date): string {
  return format(date, 'LLLL yyyy', { locale: ru });
}

export function toDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Shifts a YYYY-MM-DD date by `days` (negative = back). */
export function shiftDate(date: string, days: number): string {
  return toDateString(addDays(parseISO(date), days));
}

/** "среда, 7 октября" → "Среда, 7 октября" (CSS `capitalize` would also capitalize the month). */
export function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getMonthGrid(year: number, month: number): (Date | null)[][] {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });

  const firstDayOfWeek = getDay(start);
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Monday-based

  const grid: (Date | null)[][] = [];
  let week: (Date | null)[] = new Array(offset).fill(null);

  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    grid.push(week);
  }

  return grid;
}

export interface WeeksGrid {
  weeks: (Date | null)[][];
  monthLabels: { label: string; colIndex: number }[];
}

export function getWeeksGrid(weeksCount: number): WeeksGrid {
  const today = new Date();
  const todayDow = getDay(today);
  const todayMondayOffset = todayDow === 0 ? 6 : todayDow - 1;

  const currentWeekStart = subDays(today, todayMondayOffset);
  const gridStart = subWeeks(currentWeekStart, weeksCount - 1);

  const weeks: (Date | null)[][] = [];
  const monthLabels: { label: string; colIndex: number }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeksCount; w++) {
    const weekStart = addWeeks(gridStart, w);
    const week: (Date | null)[] = [];

    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d);
      if (day > today) {
        week.push(null);
      } else {
        week.push(day);
      }
    }

    weeks.push(week);

    const firstDayOfWeek = addDays(weekStart, 0);
    if (firstDayOfWeek.getMonth() !== lastMonth && firstDayOfWeek <= today) {
      lastMonth = firstDayOfWeek.getMonth();
      monthLabels.push({
        label: format(firstDayOfWeek, 'LLL', { locale: ru }),
        colIndex: w,
      });
    }
  }

  return { weeks, monthLabels };
}

export function getRecentDays(count: number): Date[] {
  const today = new Date();
  const days: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    days.push(subDays(today, i));
  }
  return days;
}

/**
 * Current and best run of consecutive marked days. Callers pass only the entries that count
 * as done (`isDoneValue`) — e.g. a count habit's 3/8 day must be filtered out beforehand, since
 * here any `value > 0` is a mark. Today not marked yet doesn't break the current run.
 */
export function calculateStreak(
  entries: { date: string; value: number }[],
  /** Skipped days (ill / vacation): transparent — they neither break nor extend a run. */
  skipped: Iterable<string> = [],
): { current: number; best: number } {
  const dateSet = new Set(
    entries.filter((e) => e.value > 0).map((e) => e.date),
  );
  if (dateSet.size === 0) return { current: 0, best: 0 };
  const skipSet = new Set(Array.from(skipped).filter((d) => !dateSet.has(d)));

  const today = new Date();
  const todayStr = toDateString(today);

  // Walk back from today: done days count, skipped days are stepped over, anything else ends
  // the run — except today, which may simply not be marked yet.
  let current = 0;
  let d = dateSet.has(todayStr) || skipSet.has(todayStr) ? today : subDays(today, 1);
  for (;;) {
    const s = toDateString(d);
    if (dateSet.has(s)) current++;
    else if (!skipSet.has(s)) break;
    d = subDays(d, 1);
  }

  const sortedDates = Array.from(new Set([...dateSet, ...skipSet])).sort();
  let best = 0;
  let streak = 0;

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i]!;
    if (i > 0) {
      // parseISO = local midnight (new Date('YYYY-MM-DD') is UTC and can shift across DST).
      const prev = parseISO(sortedDates[i - 1]!);
      const curr = parseISO(date);
      if (differenceInCalendarDays(curr, prev) !== 1) streak = 0;
    }
    if (dateSet.has(date)) streak++;
    best = Math.max(best, streak);
  }

  return { current, best };
}

export function getMonthCompletionRate(
  entries: { date: string; value: number }[],
  year: number,
  month: number,
): number {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(start);
  const today = new Date();
  const effectiveEnd = end > today ? today : end;
  const totalDays = differenceInCalendarDays(effectiveEnd, start) + 1;
  if (totalDays <= 0) return 0;

  const monthPrefix = format(start, 'yyyy-MM');
  const completedDays = entries.filter(
    (e) => e.value > 0 && e.date.startsWith(monthPrefix),
  ).length;

  return Math.round((completedDays / totalDays) * 100);
}

export { isToday };
export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
