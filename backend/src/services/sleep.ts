/**
 * Sleep as bed → wake time (idea №10). The single write path for sleep used by the assistant
 * (Hermes text), the morning briefing buttons and the Mini App: it stores the bed/wake times on
 * the hours-habit entry of the wake date and derives `value` (minutes) from them.
 */
import { prisma } from '../db.js';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && HHMM.test(s);
}

const MAX_SLEEP_MIN = 16 * 60;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes from bed to wake, across midnight («01:30» → «08:00» = 390; «23:00» → «07:00» = 480). */
export function sleepMinutes(bed: string, wake: string): number {
  const diff = toMin(wake) - toMin(bed);
  return diff > 0 ? diff : diff + 24 * 60;
}

export interface SleepInput {
  bed?: string;
  wake?: string;
  /** Used when bed/wake are unknown («спал 7 часов»). */
  hours?: number;
}

/**
 * Upserts the night ending on `wakeDate` (local YYYY-MM-DD) for the given hours habit.
 * Returns the stored minutes, or null when the input can't produce a duration.
 */
export async function setSleepEntry(habitId: number, wakeDate: string, input: SleepInput) {
  const date = new Date(`${wakeDate}T00:00:00.000Z`);
  let minutes: number | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (isHHMM(input.bed) && isHHMM(input.wake)) {
    minutes = input.bed === input.wake ? 0 : sleepMinutes(input.bed, input.wake);
    startTime = input.bed;
    endTime = input.wake;
  } else if (typeof input.hours === 'number' && input.hours > 0 && input.hours <= 24) {
    minutes = Math.round(input.hours * 60);
  }
  // bed == wake (0 h) or a span over 16 h is a typo, not a night.
  if (minutes === null || minutes <= 0 || minutes > MAX_SLEEP_MIN) return null;

  await prisma.habitEntry.upsert({
    where: { habitId_date: { habitId, date } },
    update: { value: minutes, skipped: false, startTime, endTime },
    create: { habitId, date, value: minutes, startTime, endTime },
  });
  return minutes;
}
