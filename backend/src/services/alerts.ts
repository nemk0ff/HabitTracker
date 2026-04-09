import cron from 'node-cron';
import { prisma } from '../db.js';
import { bot } from './bot.js';
import { getDau, getNewUsersCount, getTopEvents, getWau } from './analytics.js';

const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';

function dayBounds(offsetDays = 0): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays),
  );
  const to = new Date(from.getTime() + 86_400_000);
  return { from, to };
}

export async function sendDailyReport(): Promise<void> {
  if (!DEVELOPER_CHAT_ID) return;

  const yesterday = dayBounds(1);
  const week = {
    from: new Date(dayBounds(7).from),
    to: new Date(dayBounds(0).from),
  };

  const [newUsers, totalUsers, dau, wau, topEvents, habitsCreated, entriesLogged] =
    await Promise.all([
      getNewUsersCount(yesterday.from, yesterday.to),
      prisma.user.count(),
      getDau(yesterday.from, yesterday.to),
      getWau(week.from, week.to),
      getTopEvents(yesterday.from, yesterday.to),
      prisma.habit.count({ where: { createdAt: { gte: yesterday.from, lt: yesterday.to } } }),
      prisma.habitEntry.count({ where: { createdAt: { gte: yesterday.from, lt: yesterday.to } } }),
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
    `🆕 Новых вчера: <b>${newUsers}</b>`,
    `🔥 DAU: <b>${dau}</b>`,
    `📅 WAU: <b>${wau}</b>`,
    ``,
    `✅ Привычек создано: <b>${habitsCreated}</b>`,
    `📝 Отметок сделано: <b>${entriesLogged}</b>`,
    ``,
    `🖱 Топ действий:`,
    eventsText,
  ].join('\n');

  await bot.api.sendMessage(DEVELOPER_CHAT_ID, report, { parse_mode: 'HTML' });

  // Алерт: 0 новых пользователей 2 дня подряд
  if (newUsers === 0) {
    const dayBefore = dayBounds(2);
    const prevNewUsers = await getNewUsersCount(dayBefore.from, dayBefore.to);
    if (prevNewUsers === 0) {
      await bot.api.sendMessage(
        DEVELOPER_CHAT_ID,
        '⚠️ <b>Алерт</b>: 0 новых пользователей 2 дня подряд.',
        { parse_mode: 'HTML' },
      );
    }
  }
}

export async function sendQuickStats(chatId: string): Promise<void> {
  const today = dayBounds(0);
  const yesterday = dayBounds(1);
  const week = { from: new Date(dayBounds(7).from), to: new Date(dayBounds(0).from) };

  const [totalUsers, newToday, dauToday, dauYesterday, wau, activeHabits] = await Promise.all([
    prisma.user.count(),
    getNewUsersCount(today.from, today.to),
    getDau(today.from, today.to),
    getDau(yesterday.from, yesterday.to),
    getWau(week.from, week.to),
    prisma.habit.count({ where: { archived: false } }),
  ]);

  const text = [
    `📊 <b>Статистика прямо сейчас</b>`,
    ``,
    `👥 Всего пользователей: <b>${totalUsers}</b>`,
    `🆕 Новых сегодня: <b>${newToday}</b>`,
    `🔥 DAU сегодня: <b>${dauToday}</b> / вчера: <b>${dauYesterday}</b>`,
    `📅 WAU (7д): <b>${wau}</b>`,
    `📋 Активных привычек: <b>${activeHabits}</b>`,
  ].join('\n');

  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export function startAlerts(): void {
  if (!DEVELOPER_CHAT_ID) {
    console.warn('[alerts] DEVELOPER_CHAT_ID not set — daily reports disabled');
    return;
  }
  // Ежедневный отчёт в 09:00 UTC
  cron.schedule('0 9 * * *', () => {
    sendDailyReport().catch((err) => console.error('[alerts] Report error:', err));
  });
  console.log('[alerts] Daily report scheduled at 09:00 UTC');
}
