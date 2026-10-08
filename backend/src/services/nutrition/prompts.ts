/**
 * Daily one-tap prompts in the bot, so sleep / weight / training / "день полный"
 * get logged without opening the Mini App. Sent only to nutrition users with a
 * goal; each prompt is skipped when today's value is already recorded.
 *
 * Callback data (≤ 64 bytes): `sl:<date>:<minutes>`, `wt:<date>:<kg>`,
 * `tr:<date>:<0|1>`, `dc:<date>`. The date is baked in so a late tap still
 * writes the day the question was about.
 */
import cron from 'node-cron';
import type { Context } from 'grammy';
import { prisma } from '../../db.js';
import { bot } from '../bot.js';
import { hasNutritionAccess } from '../../utils/features.js';
import { forEachSafe } from '../../utils/safe.js';
import { track } from '../analytics.js';
import { computePlan } from './model.js';
import { countTarget, isDone } from '../habitStats.js';

const WEBAPP_URL = process.env.WEBAPP_URL || '';
const SLEEP_HOURS = [5, 6, 7, 8, 9];

type Button = { text: string; callback_data?: string; web_app?: { url: string } };

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

/** Runs `fn` for every recipient; one user's failure never stops the rest. */
async function forEachRecipient(
  label: string,
  fn: (g: Awaited<ReturnType<typeof recipients>>[number]) => Promise<void>,
): Promise<void> {
  await forEachSafe(await recipients(), `[prompts] ${label}`, (g) => `user ${g.userId}`, fn);
}

function fmtKg(kg: number): string {
  return kg.toFixed(1).replace('.', ',');
}

async function recipients() {
  const goals = await prisma.nutritionGoal.findMany({ include: { user: true } });
  return goals.filter((g) => hasNutritionAccess(g.user.telegramId));
}

async function send(chatId: bigint, text: string, keyboard: Button[][]) {
  try {
    await bot.api.sendMessage(String(chatId), text, {
      reply_markup: { inline_keyboard: keyboard.filter((row) => row.length > 0) as any },
    });
  } catch (e) {
    console.error(`[prompts] send to ${chatId} failed:`, e);
  }
}

const openDiaryRow = (): Button[] => (WEBAPP_URL ? [{ text: '📱 Открыть дневник', web_app: { url: WEBAPP_URL } }] : []);

// ─── Prompts ──────────────────────────────────────────────────────────────────

/** 09:00 MSK: hours slept + this morning's weight (±0.5 kg from the last weigh-in — a mechanical scale). */
export async function sendMorningPrompts(): Promise<void> {
  const date = todayMsk();
  await forEachRecipient('morning', async (g) => {
    const sleepHabit = g.sleepHabitId
      ? await prisma.habit.findFirst({ where: { id: g.sleepHabitId, userId: g.userId, archived: false }, select: { id: true } })
      : null;
    if (sleepHabit) {
      const slept = await prisma.habitEntry.findFirst({ where: { habitId: sleepHabit.id, date: dayDate(date) } });
      if (!slept) {
        await send(g.user.telegramId, '😴 Сколько спал этой ночью?', [
          SLEEP_HOURS.map((h) => ({ text: `${h} ч`, callback_data: `sl:${date}:${h * 60}` })),
        ]);
      }
    }
    const today = await prisma.weightEntry.findUnique({ where: { userId_date: { userId: g.userId, date: dayDate(date) } } });
    const last = await prisma.weightEntry.findFirst({ where: { userId: g.userId }, orderBy: { date: 'desc' } });
    if (!today && last) {
      const kg = last.weightKg;
      await send(g.user.telegramId, `⚖️ Вес утром? В прошлый раз было ${fmtKg(kg)} кг`, [
        [kg - 0.5, kg, kg + 0.5].map((v) => ({
          text: v === kg ? `${fmtKg(v)} — так же` : fmtKg(v),
          callback_data: `wt:${date}:${v}`,
        })),
        WEBAPP_URL ? [{ text: 'Другой вес', web_app: { url: WEBAPP_URL } }] : [],
      ]);
    }
  });
}

/** 21:00 MSK: was there a workout today (skipped if already marked). */
export async function sendTrainingPrompt(): Promise<void> {
  const date = todayMsk();
  await forEachRecipient('training', async (g) => {
    // The evening check-in already asks about every habit, training included.
    if (!g.trainingHabitId || g.user.checkinTime) return;
    const habit = await prisma.habit.findFirst({ where: { id: g.trainingHabitId, userId: g.userId, archived: false } });
    if (!habit) return; // archived (or gone) — don't ask about a habit the user put away
    const entry = await prisma.habitEntry.findFirst({ where: { habitId: habit.id, date: dayDate(date) } });
    // A pass (ill / vacation) — don't ask about a workout today.
    if (entry?.skipped || isDone(habit, entry?.value)) return;
    await send(g.user.telegramId, '💪 Была сегодня тренировка?', [
      [
        { text: 'Да', callback_data: `tr:${date}:1` },
        { text: 'Нет', callback_data: `tr:${date}:0` },
      ],
    ]);
  });
}

/** 22:00 MSK: confirm the diary is complete, so the model can trust the day. */
export async function sendDayCompletePrompt(): Promise<void> {
  const date = todayMsk();
  await forEachRecipient('day complete', async (g) => {
    const mark = await prisma.dayMark.findUnique({ where: { userId_date: { userId: g.userId, date: dayDate(date) } } });
    if (mark) return;
    const sum = await prisma.foodLogEntry.aggregate({
      where: { userId: g.userId, date: dayDate(date) },
      _sum: { kcal: true },
      _count: true,
    });
    if (sum._count === 0) {
      await send(g.user.telegramId, '🍽 Сегодня в дневнике пусто. Запишешь, что ел?', [openDiaryRow()]);
      return;
    }
    const plan = await computePlan(g.userId, date);
    const target = plan.todayKcal ?? g.kcal;
    const kcal = Math.round(sum._sum.kcal ?? 0);
    await send(g.user.telegramId, `🍽 Сегодня ${kcal} из ${target} ккал. Всё записал?`, [
      [{ text: '✅ Да, день полный', callback_data: `dc:${date}` }],
      openDiaryRow(),
    ]);
  });
}

export function startDailyPrompts(): void {
  const utc = { timezone: 'UTC' };
  cron.schedule('0 6 * * *', () => void sendMorningPrompts().catch((e) => console.error('[prompts] morning:', e)), utc);
  cron.schedule('0 18 * * *', () => void sendTrainingPrompt().catch((e) => console.error('[prompts] training:', e)), utc);
  cron.schedule('0 19 * * *', () => void sendDayCompletePrompt().catch((e) => console.error('[prompts] day:', e)), utc);
}

// ─── Callback handling ────────────────────────────────────────────────────────

async function resolveGoal(ctx: Context) {
  if (!ctx.from || !hasNutritionAccess(ctx.from.id)) return null;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (!user) return null;
  return { user, goal: await prisma.nutritionGoal.findUnique({ where: { userId: user.id } }) };
}

/** `alert`: the tap was rejected — show a popup and leave the question message as is. */
export interface PromptCallbackResult {
  text: string;
  alert?: boolean;
}

const reject = (text: string): PromptCallbackResult => ({ text, alert: true });

/** Handles `sl:` / `wt:` / `tr:` / `dc:` buttons; returns the confirmation (or rejection) or null if not ours. */
export async function handlePromptCallback(ctx: Context, data: string): Promise<PromptCallbackResult | null> {
  const m = data.match(/^(sl|wt|tr|dc):(\d{4}-\d{2}-\d{2})(?::([\d.]+))?$/);
  if (!m) return null;
  const [, kind, date, value] = m;
  if (!isRecentDate(date!)) return reject('Этот вопрос устарел — отметь в трекере');
  const who = await resolveGoal(ctx);
  if (!who) return reject('Недоступно');
  const { user, goal } = who;
  const d = dayDate(date!);

  if (kind === 'sl' && goal?.sleepHabitId) {
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return reject('Странное время сна');
    await prisma.habitEntry.upsert({
      where: { habitId_date: { habitId: goal.sleepHabitId, date: d } },
      update: { value: minutes, skipped: false },
      create: { habitId: goal.sleepHabitId, date: d, value: minutes },
    });
    track({ userId: user.id, event: 'entry_checked', category: 'bot', label: date, metadata: { prompt: 'sleep' } });
    return { text: `😴 Записал сон: ${minutes / 60} ч` };
  }
  if (kind === 'wt') {
    const kg = Math.round(Number(value) * 10) / 10;
    if (!(kg >= 20 && kg <= 400)) return reject('Странный вес');
    await prisma.weightEntry.upsert({
      where: { userId_date: { userId: user.id, date: d } },
      update: { weightKg: kg },
      create: { userId: user.id, date: d, weightKg: kg },
    });
    track({ userId: user.id, event: 'weight_logged', category: 'bot' });
    return { text: `⚖️ Записал вес: ${fmtKg(kg)} кг` };
  }
  if (kind === 'tr' && goal?.trainingHabitId) {
    if (value === '1') {
      const habit = await prisma.habit.findFirst({ where: { id: goal.trainingHabitId, userId: user.id } });
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
      track({ userId: user.id, event: 'entry_checked', category: 'bot', label: date, metadata: { prompt: 'training' } });
      return { text: '💪 Отметил тренировку' };
    }
    return { text: 'Ок, день отдыха' };
  }
  if (kind === 'dc') {
    await prisma.dayMark.upsert({
      where: { userId_date: { userId: user.id, date: d } },
      update: { complete: true },
      create: { userId: user.id, date: d, complete: true },
    });
    track({ userId: user.id, event: 'day_marked_complete', category: 'bot', label: date });
    return { text: '✅ День отмечен как полный' };
  }
  return reject('Привычка не привязана — выбери её в «Цель и вес»');
}
