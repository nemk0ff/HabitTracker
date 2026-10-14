import cron from 'node-cron';
import { prisma } from '../db.js';
import { bot } from './bot.js';
import {
  getDau,
  getNewUsersCount,
  getTopEvents,
  getWau,
} from './analytics.js';

const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';

function dayBounds(offsetDays = 0): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays),
  );
  const to = new Date(from.getTime() + 86_400_000);
  return { from, to };
}

/** "🥗 Питание: 2840 / 3000 ккал · Б 150 г" for the developer's own diary day, or null if nothing logged. */
async function developerNutritionLine(day: Date): Promise<string | null> {
  const dev = await prisma.user.findUnique({ where: { telegramId: BigInt(DEVELOPER_CHAT_ID) } });
  if (!dev) return null;
  const [sum, goal] = await Promise.all([
    prisma.foodLogEntry.aggregate({
      where: { userId: dev.id, date: day },
      _sum: { kcal: true, protein: true },
      _count: true,
    }),
    prisma.nutritionGoal.findUnique({ where: { userId: dev.id } }),
  ]);
  if (sum._count === 0) return null;
  const kcal = Math.round(sum._sum.kcal ?? 0);
  const protein = Math.round(sum._sum.protein ?? 0);
  return `🥗 Питание: <b>${kcal}</b>${goal ? ` / ${goal.kcal}` : ''} ккал · Б ${protein}${goal?.protein ? ` / ${goal.protein}` : ''} г`;
}

export async function sendDailyReport(): Promise<void> {
  if (!DEVELOPER_CHAT_ID) return;

  const yesterday = dayBounds(1);
  const week = {
    from: new Date(dayBounds(7).from),
    to: new Date(dayBounds(0).from),
  };

  const [newUsers, totalUsers, dau, wau, topEvents, habitsCreated, entriesLogged, nutritionLine] =
    await Promise.all([
      getNewUsersCount(yesterday.from, yesterday.to),
      prisma.user.count(),
      getDau(yesterday.from, yesterday.to),
      getWau(week.from, week.to),
      getTopEvents(yesterday.from, yesterday.to),
      prisma.habit.count({ where: { createdAt: { gte: yesterday.from, lt: yesterday.to } } }),
      prisma.habitEntry.count({ where: { skipped: false, createdAt: { gte: yesterday.from, lt: yesterday.to } } }),
      // Diary days are stored as UTC midnight of the local date, so this is "yesterday" in Moscow too.
      developerNutritionLine(yesterday.from).catch((err) => {
        console.error('[alerts] Nutrition line failed:', err);
        return null;
      }),
    ]);

  const date = yesterday.from.toISOString().split('T')[0];
  const eventsText =
    topEvents.length > 0
      ? topEvents.map((e) => `  • <code>${e.event}</code>: ${e.count}`).join('\n')
      : '  (нет событий)';

  const report = [
    `📊 <b>Отчёт за ${date}</b>`,
    ``,
    `👥 Всего пользователей: <b>${totalUsers}</b>`,
    // Only mention new users when there were any.
    ...(newUsers > 0 ? [`🆕 Новых вчера: <b>${newUsers}</b>`] : []),
    `🔥 DAU: <b>${dau}</b>`,
    `📅 WAU: <b>${wau}</b>`,
    ``,
    `✅ Привычек создано: <b>${habitsCreated}</b>`,
    `📝 Отметок сделано: <b>${entriesLogged}</b>`,
    ...(nutritionLine ? [nutritionLine] : []),
    ``,
    `🖱 Топ действий:`,
    eventsText,
  ].join('\n');

  await bot.api.sendMessage(DEVELOPER_CHAT_ID, report, { parse_mode: 'HTML' });
}

export async function sendQuickStats(chatId: string): Promise<void> {
  const today = dayBounds(0);
  const yesterday = dayBounds(1);
  const week = { from: new Date(dayBounds(7).from), to: new Date(dayBounds(0).from) };

  const [totalUsers, newToday, dauToday, dauYesterday, wau, activeHabits, totalEntries, entriesToday] =
    await Promise.all([
      prisma.user.count(),
      getNewUsersCount(today.from, today.to),
      getDau(today.from, today.to),
      getDau(yesterday.from, yesterday.to),
      getWau(week.from, week.to),
      prisma.habit.count({ where: { archived: false } }),
      prisma.habitEntry.count({ where: { skipped: false } }),
      prisma.habitEntry.count({ where: { skipped: false, createdAt: { gte: today.from, lt: today.to } } }),
    ]);

  const text = [
    `📊 <b>Статистика прямо сейчас</b>`,
    ``,
    `👥 Всего пользователей: <b>${totalUsers}</b>`,
    `🆕 Новых сегодня: <b>${newToday}</b>`,
    `🔥 DAU сегодня: <b>${dauToday}</b> / вчера: <b>${dauYesterday}</b>`,
    `📅 WAU (7д): <b>${wau}</b>`,
    `📋 Активных привычек: <b>${activeHabits}</b>`,
    `📝 Отметок всего: <b>${totalEntries}</b> (сегодня: <b>${entriesToday}</b>)`,
  ].join('\n');

  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export function startAlerts(): void {
  if (!DEVELOPER_CHAT_ID) {
    console.warn('[alerts] DEVELOPER_CHAT_ID not set — daily reports disabled');
    return;
  }
  // Ежедневный отчёт в 09:00 МСК (06:00 UTC). The VPS clock is Europe/Moscow; the timezone is pinned so it doesn't depend on it.
  cron.schedule(
    '0 6 * * *',
    () => {
      sendDailyReport().catch((err) => console.error('[alerts] Report error:', err));
    },
    { timezone: 'UTC' },
  );
  console.log('[alerts] Daily report scheduled at 06:00 UTC (09:00 MSK)');
}
