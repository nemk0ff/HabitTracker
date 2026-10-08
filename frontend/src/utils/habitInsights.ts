import { addDays, differenceInCalendarDays, format, getDay, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { calculateStreak, shiftDate, toDateString } from './dates';
import { doneEntries, markedDates, neededForWeek, skippedDates, weekDates } from './habits';
import { habitStartDate, metWeekStarts, rateBetween } from './habitStats';
import type { Habit } from '../types';

/** Pure "insight" numbers for the habit page. `today` is a local YYYY-MM-DD. */

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = parseISO(from); toDateString(d) <= to; d = addDays(d, 1)) out.push(toDateString(d));
  return out;
}

export interface MonthSummary {
  /** «Октябрь» */
  monthLabel: string;
  /** Days of this month the habit existed, up to today. */
  totalDays: number;
  doneDays: number;
  /** Done share of the non-skipped days, 0–100; null when there are none. */
  rate: number | null;
  /** Longest run of done days this month; skipped days don't break it. */
  bestStreak: number;
  skipped: number;
  /** Weekly-goal habits: weeks starting this month (current one only once met) and how many met the goal. */
  weeks: { met: number; total: number } | null;
}

export function monthSummary(h: Habit, today: string): MonthSummary {
  const monthStart = toDateString(startOfMonth(parseISO(today)));
  const start = habitStartDate(h);
  const from = start > monthStart ? start : monthStart;
  const doneInMonth = doneEntries(h).filter((e) => e.date >= from && e.date <= today);
  const doneSet = new Set(doneInMonth.map((e) => e.date));
  const skippedInMonth = [...skippedDates(h)].filter((d) => d >= from && d <= today && !doneSet.has(d));
  const totalDays = from <= today ? differenceInCalendarDays(parseISO(today), parseISO(from)) + 1 : 0;
  // The month's own best run: same rules as the habit-wide streak, so passes stay transparent.
  const bestStreak = calculateStreak(doneInMonth, skippedInMonth).best;

  let weeks: MonthSummary['weeks'] = null;
  if (h.weeklyTarget) {
    const met = metWeekStarts(h);
    const marked = markedDates(h);
    const skips = skippedDates(h);
    const thisMonday = toDateString(startOfWeek(parseISO(today), { weekStartsOn: 1 }));
    const startMonday = toDateString(startOfWeek(parseISO(start), { weekStartsOn: 1 }));
    let total = 0;
    let metCount = 0;
    for (let d = parseISO(monthStart); toDateString(d) <= today; d = addDays(d, 1)) {
      const date = toDateString(d);
      if (getDay(d) !== 1 || date < startMonday) continue;
      const isMet = met.has(date);
      if (date === thisMonday && !isMet) continue; // unfinished week isn't a miss yet
      // A fully skipped week (nothing needed, nothing done) is transparent, as in weeklyStreak.
      const days = weekDates(date);
      const done = days.filter((x) => marked.has(x)).length;
      const skippedDays = days.filter((x) => !marked.has(x) && skips.has(x)).length;
      if (done === 0 && neededForWeek(h.weeklyTarget, skippedDays) === 0) continue;
      total++;
      if (isMet) metCount++;
    }
    weeks = { met: metCount, total };
  }

  const label = format(parseISO(today), 'LLLL', { locale: ru });
  return {
    monthLabel: label.charAt(0).toUpperCase() + label.slice(1),
    totalDays,
    doneDays: doneSet.size,
    rate: rateBetween(h, monthStart, today),
    bestStreak,
    skipped: skippedInMonth.length,
    weeks,
  };
}

/** Dative plural for «по …»; index 0 = Monday. */
const WEEKDAY_DATIVE = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];

const INSIGHT_WEEKS = 8;
const MIN_DONE_DAYS = 8;

/**
 * Weekday with the highest done-rate over the last 8 weeks (skipped days excluded from the
 * denominator). Null with fewer than 8 done days, or when no weekday stands out.
 */
export function bestWeekday(h: Habit, today: string): { index: number; label: string; rate: number } | null {
  const windowStart = shiftDate(today, -(INSIGHT_WEEKS * 7 - 1));
  const start = habitStartDate(h);
  const from = start > windowStart ? start : windowStart;
  if (from > today) return null;
  const done = markedDates(h);
  const skip = skippedDates(h);

  const doneBy = new Array(7).fill(0) as number[];
  const totalBy = new Array(7).fill(0) as number[];
  let doneTotal = 0;
  for (const d of datesBetween(from, today)) {
    if (skip.has(d)) continue;
    const isDone = done.has(d);
    if (d === today && !isDone) continue; // today is still open
    const i = (getDay(parseISO(d)) + 6) % 7;
    totalBy[i]!++;
    if (isDone) {
      doneBy[i]!++;
      doneTotal++;
    }
  }
  if (doneTotal < MIN_DONE_DAYS) return null;

  const rates = totalBy.map((t, i) => (t >= 2 ? doneBy[i]! / t : -1));
  const best = Math.max(...rates);
  const valid = rates.filter((r) => r >= 0);
  if (best <= 0 || valid.every((r) => r === best)) return null;
  const index = rates.indexOf(best);
  return { index, label: WEEKDAY_DATIVE[index]!, rate: Math.round(best * 100) };
}

export interface DayPoint {
  date: string;
  value: number;
  skipped: boolean;
}

/** Raw value per day for the last `days` days, oldest first. */
export function dailySeries(h: Pick<Habit, 'entries'>, today: string, days: number): DayPoint[] {
  const byDate = new Map(h.entries.map((e) => [e.date, e]));
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDate(today, i - days + 1);
    const e = byDate.get(date);
    return { date, value: e?.value ?? 0, skipped: !!e?.skipped };
  });
}
