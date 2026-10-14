/**
 * One-tap sleep / weight / training / "день полный" answers. The questions themselves are part of the
 * morning and evening briefings (`services/briefing.ts`); the separate 06:00 / 18:00 / 19:00 UTC prompt
 * crons were retired (iteration B, stage 3). Old prompt messages still in the chat keep working.
 *
 * Callback data (≤ 64 bytes): `sl:<date>:<minutes>` or `sl:<date>:<HHMM>-<HHMM>` (bed–wake, idea №10),
 * `wt:<date>:<kg>`, `tr:<date>:<0|1>`, `dc:<date>`. The date is baked in so a late tap still writes the
 * day the question was about. The briefing sends the same actions as `ci:<kind>:…` (see checkin.ts), so a
 * tap re-renders the whole briefing instead of replacing it with the confirmation text.
 */
import type { Context } from 'grammy';
import { prisma } from '../../db.js';
import { isOwnerTelegramId } from '../../utils/owner.js';
import { track } from '../analytics.js';
import { countTarget, isDone } from '../habitStats.js';
import { setSleepEntry } from '../sleep.js';
import { isValidWeight, setWeight } from './weight.js';

/** Moscow calendar date — diary days are local dates. */
function todayMsk(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

function dayDate(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

/** A late tap is fine, but only for the last few days (and never the future). */
const MAX_CALLBACK_AGE_DAYS = 3;

function isRecentDate(date: string): boolean {
  const d = dayDate(date).getTime();
  if (Number.isNaN(d)) return false;
  const today = dayDate(todayMsk()).getTime();
  return d <= today && d >= today - MAX_CALLBACK_AGE_DAYS * 86_400_000;
}

export function fmtKg(kg: number): string {
  return kg.toFixed(1).replace('.', ',');
}

/** `0130-0800` → { bed: '01:30', wake: '08:00' }. */
export function parseBedWake(v: string | undefined): { bed: string; wake: string } | null {
  const m = v?.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  return m ? { bed: `${m[1]}:${m[2]}`, wake: `${m[3]}:${m[4]}` } : null;
}

/** `01:30` → `0130` (callback form). */
export const compactHHMM = (hhmm: string) => hhmm.replace(':', '');

function fmtHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return String(h).replace('.', ',');
}

// ─── Callback handling ────────────────────────────────────────────────────────

/** `alert`: the tap was rejected — show a popup and leave the question message as is. */
export interface PromptCallbackResult {
  text: string;
  alert?: boolean;
}

const reject = (text: string): PromptCallbackResult => ({ text, alert: true });

export type PromptKind = 'sl' | 'wt' | 'tr' | 'dc';

/**
 * Applies one prompt answer for `userId` (the caller has checked ownership and the date's age).
 * Shared by the legacy `sl:|wt:|tr:|dc:` buttons and the briefing's `ci:<kind>:…` buttons.
 */
export async function applyPrompt(
  userId: number,
  kind: PromptKind,
  date: string,
  value: string | undefined,
): Promise<PromptCallbackResult> {
  const goal = await prisma.nutritionGoal.findUnique({ where: { userId } });
  const d = dayDate(date);

  if (kind === 'sl' && goal?.sleepHabitId) {
    const habit = await prisma.habit.findFirst({ where: { id: goal.sleepHabitId, userId }, select: { id: true } });
    if (!habit) return reject('Привычка сна не найдена');
    const bedWake = parseBedWake(value);
    if (bedWake) {
      const minutes = await setSleepEntry(habit.id, date, bedWake);
      if (minutes === null) return reject('Странное время сна');
      track({ userId, event: 'entry_checked', category: 'bot', label: date, metadata: { prompt: 'sleep', ...bedWake } });
      return { text: `😴 Записал сон: ${bedWake.bed}–${bedWake.wake} · ${fmtHours(minutes)} ч` };
    }
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return reject('Странное время сна');
    await prisma.habitEntry.upsert({
      where: { habitId_date: { habitId: habit.id, date: d } },
      update: { value: minutes, skipped: false, startTime: null, endTime: null },
      create: { habitId: habit.id, date: d, value: minutes },
    });
    track({ userId, event: 'entry_checked', category: 'bot', label: date, metadata: { prompt: 'sleep' } });
    return { text: `😴 Записал сон: ${fmtHours(minutes)} ч` };
  }
  if (kind === 'wt') {
    const kg = Math.round(Number(value) * 10) / 10;
    if (!isValidWeight(kg)) return reject('Странный вес');
    await setWeight(userId, date, kg);
    track({ userId, event: 'weight_logged', category: 'bot' });
    return { text: `⚖️ Записал вес: ${fmtKg(kg)} кг` };
  }
  if (kind === 'tr' && goal?.trainingHabitId) {
    if (value === '1') {
      const habit = await prisma.habit.findFirst({ where: { id: goal.trainingHabitId, userId } });
      if (!habit) return reject('Привычка не найдена');
      // «Да» means the training happened: a count habit gets its daily target, so it counts as done.
      const existing = await prisma.habitEntry.findUnique({ where: { habitId_date: { habitId: habit.id, date: d } } });
      const doneValue = habit.measure === 'count' ? countTarget(habit) : 1;
      const newValue = isDone(habit, existing?.value) ? existing!.value : doneValue;
      await prisma.habitEntry.upsert({
        where: { habitId_date: { habitId: habit.id, date: d } },
        update: { value: newValue, skipped: false },
        create: { habitId: habit.id, date: d, value: newValue },
      });
      track({ userId, event: 'entry_checked', category: 'bot', label: date, metadata: { prompt: 'training' } });
      return { text: '💪 Отметил тренировку' };
    }
    return { text: 'Ок, день отдыха' };
  }
  if (kind === 'dc') {
    await prisma.dayMark.upsert({
      where: { userId_date: { userId, date: d } },
      update: { complete: true },
      create: { userId, date: d, complete: true },
    });
    track({ userId, event: 'day_marked_complete', category: 'bot', label: date });
    return { text: '✅ День отмечен как полный' };
  }
  return reject('Привычка не привязана — выбери её в «Цель и вес»');
}

/** Handles `sl:` / `wt:` / `tr:` / `dc:` buttons; returns the confirmation (or rejection) or null if not ours. */
export async function handlePromptCallback(ctx: Context, data: string): Promise<PromptCallbackResult | null> {
  const m = data.match(/^(sl|wt|tr|dc):(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{4}|[\d.]+))?$/);
  if (!m) return null;
  const [, kind, date, value] = m;
  if (!isRecentDate(date!)) return reject('Этот вопрос устарел — отметь в трекере');
  if (!ctx.from || !isOwnerTelegramId(ctx.from.id)) return reject('Недоступно');
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (!user) return reject('Недоступно');
  return applyPrompt(user.id, kind as PromptKind, date!, value);
}
