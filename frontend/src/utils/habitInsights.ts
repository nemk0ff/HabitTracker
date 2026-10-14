import { addDays, differenceInCalendarDays, format, getDay, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { calculateStreak, shiftDate, toDateString } from './dates';
import { doneEntries, markedDates, neededForWeek, skippedDates, weekDates } from './habits';
import { habitStartDate, metWeekStarts, rateBetween } from './habitStats';
import type { Habit, HabitEntry } from '../types';

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

/* ───────────── Sleep: bed → wake (idea №10) ───────────── */

/** Bed / wake time of a night, local "HH:MM". The night belongs to the wake date. */
export interface SleepTimes {
  startTime: string;
  endTime: string;
}

const DAY_MIN = 24 * 60;

export function hhmmToMin(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

export function minToHHMM(min: number): string {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes from bed to wake across midnight («01:30» → «08:00» = 390). Same formula as the backend. */
export function sleepMinutes(bed: string, wake: string): number {
  const diff = hhmmToMin(wake) - hhmmToMin(bed);
  return diff > 0 ? diff : diff + DAY_MIN;
}

/** «6 ч 30 мин», «8 ч». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Bed time on an evening-anchored axis (minutes since 12:00), so 23:30 < 01:30. */
export function bedAxis(hhmm: string): number {
  return (hhmmToMin(hhmm) - 12 * 60 + DAY_MIN) % DAY_MIN;
}

export function hasTimes(e: HabitEntry | undefined): e is HabitEntry & SleepTimes {
  return !!e && !!e.startTime && !!e.endTime && e.value > 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const roundTo = (m: number, step: number) => Math.round(m / step) * step;

/** Nights with bed/wake times among the `days` nights ending on `today`. */
export function timedNights(entries: HabitEntry[], today: string, days = 14): (HabitEntry & SleepTimes)[] {
  const from = shiftDate(today, -days + 1);
  return entries.filter((e): e is HabitEntry & SleepTimes => hasTimes(e) && e.date >= from && e.date <= today);
}

/**
 * What to pre-fill the «Лёг / Встал» wheels with for the night of `date`: that night's own times,
 * else the previous night's, else the 14-day median, else 23:30 → 07:30. Rounded to `step` minutes.
 */
export function suggestSleepTimes(entries: HabitEntry[], date: string, step = 15): SleepTimes {
  const own = entries.find((e) => e.date === date);
  if (hasTimes(own)) return { startTime: own.startTime, endTime: own.endTime };
  const prev = entries.find((e) => e.date === shiftDate(date, -1));
  const pick = (bed: number, wake: number): SleepTimes => ({
    startTime: minToHHMM(roundTo(bed, step)),
    endTime: minToHHMM(roundTo(wake, step)),
  });
  if (hasTimes(prev)) return pick(hhmmToMin(prev.startTime), hhmmToMin(prev.endTime));
  const nights = timedNights(entries, shiftDate(date, -1));
  if (nights.length > 0) {
    return pick(median(nights.map((n) => bedAxis(n.startTime))) + 12 * 60, median(nights.map((n) => hhmmToMin(n.endTime))));
  }
  return { startTime: '23:30', endTime: '07:30' };
}

export type RegimeVerdict = 'even' | 'drifting' | 'off';

export interface SleepRegime {
  nights: number;
  /** Mean bed / wake time, "HH:MM". */
  avgBed: string;
  avgWake: string;
  /** Standard deviation of the bed time, minutes. */
  bedSpread: number;
  /** ≤ 45 min — ровный, > 90 — сбит, between — плавает. Null with < 3 nights. */
  verdict: RegimeVerdict | null;
  /** Dates whose bed time is late: after the target, or (no target) an hour+ after the mean. */
  lateDates: Set<string>;
}

/** Bed / wake regime over the last `days` nights (null when no night has times). */
export function sleepRegime(entries: HabitEntry[], today: string, target: string | null, days = 14): SleepRegime | null {
  const nights = timedNights(entries, today, days);
  if (nights.length === 0) return null;
  const beds = nights.map((n) => bedAxis(n.startTime));
  const wakes = nights.map((n) => hhmmToMin(n.endTime));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const bedMean = mean(beds);
  const bedSpread = Math.round(Math.sqrt(mean(beds.map((b) => (b - bedMean) ** 2))));
  const lateLimit = target ? bedAxis(target) : bedMean + 60;
  const lateDates = new Set(nights.filter((n) => bedAxis(n.startTime) > lateLimit).map((n) => n.date));
  return {
    nights: nights.length,
    avgBed: minToHHMM(roundTo(bedMean + 12 * 60, 5)),
    avgWake: minToHHMM(roundTo(mean(wakes), 5)),
    bedSpread,
    verdict: nights.length < 3 ? null : bedSpread <= 45 ? 'even' : bedSpread > 90 ? 'off' : 'drifting',
    lateDates,
  };
}

/* Optional bed-time target per habit, kept on this device. */
const targetKey = (habitId: number) => `sleepBedTarget:${habitId}`;

export function loadBedTarget(habitId: number): string | null {
  try {
    const v = localStorage.getItem(targetKey(habitId));
    return v && /^\d{2}:\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveBedTarget(habitId: number, value: string | null): void {
  try {
    if (value) localStorage.setItem(targetKey(habitId), value);
    else localStorage.removeItem(targetKey(habitId));
  } catch {
    /* storage unavailable — the target just won't stick */
  }
}
