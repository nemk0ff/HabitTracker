import type { Habit, HabitEntry } from '../types';

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

/** Entries as heatmap levels (hours habits are bucketed, others pass through). */
export function levelEntries(h: Habit): HabitEntry[] {
  return isHoursHabit(h) ? h.entries.map((e) => ({ ...e, value: hoursLevel(e.value) })) : h.entries;
}

export function formatHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
}

/** Average of the hours entries within the last `days` days, or null. */
export function averageHours(entries: HabitEntry[], sinceDate: string): number | null {
  const xs = entries.filter((e) => e.date >= sinceDate && e.value > 0).map((e) => e.value);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
