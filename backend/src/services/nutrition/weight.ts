/**
 * Weigh-in writes shared by the API (PUT /nutrition/weight) and the assistant (Hermes text / offline regex).
 * Dates are local 'YYYY-MM-DD' stored as UTC midnight.
 */
import { prisma } from '../../db.js';
import { round1 } from './nutritionMath.js';

export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 400;

export function isValidWeight(kg: unknown): kg is number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= MIN_WEIGHT_KG && kg <= MAX_WEIGHT_KG;
}

function dayDate(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

/** The stored weight for the day, or null. */
export async function getWeight(userId: number, date: string): Promise<number | null> {
  const w = await prisma.weightEntry.findUnique({ where: { userId_date: { userId, date: dayDate(date) } } });
  return w?.weightKg ?? null;
}

/** Upserts the day's weigh-in (rounded to 0.1 kg). Caller validates the range. */
export async function setWeight(userId: number, date: string, weightKg: number) {
  const kg = round1(weightKg);
  const w = await prisma.weightEntry.upsert({
    where: { userId_date: { userId, date: dayDate(date) } },
    update: { weightKg: kg },
    create: { userId, date: dayDate(date), weightKg: kg },
  });
  return { date: w.date.toISOString().slice(0, 10), weightKg: w.weightKg };
}

export async function deleteWeight(userId: number, date: string): Promise<void> {
  await prisma.weightEntry.deleteMany({ where: { userId, date: dayDate(date) } });
}
