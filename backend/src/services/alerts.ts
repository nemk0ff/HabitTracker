import cron from 'node-cron';
import { prisma } from '../db.js';
import { bot } from './bot.js';
import {
  getDau,
  getNewUsersCount,
  getTopEvents,
  getWau,
  getUserOverview,
  getRecentActivity,
  getUserDetail,
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

/** "5 мин / 3 ч / 2 дн назад" или "никогда". */
function relativeTime(date: Date | null): string {
  if (!date) return 'никогда';
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      prisma.habitEntry.count({ where: { createdAt: { gte: yesterday.from, lt: yesterday.to } } }),
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
      prisma.habitEntry.count(),
      prisma.habitEntry.count({ where: { createdAt: { gte: today.from, lt: today.to } } }),
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
    ``,
    `Команды: /users /activity /user &lt;id&gt;`,
  ].join('\n');

  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export async function sendUsersList(chatId: string): Promise<void> {
  const users = await getUserOverview();
  if (users.length === 0) {
    await bot.api.sendMessage(chatId, 'Пользователей пока нет.');
    return;
  }

  const lines = users.slice(0, 50).map((u) => {
    const handle = u.username ? ` @${u.username}` : '';
    return (
      `👤 <b>${escapeHtml(u.name)}</b>${escapeHtml(handle)} <code>#${u.id}</code>\n` +
      `   📋 ${u.habitCount} прив. · 🕑 ${relativeTime(u.lastSeenAt)}`
    );
  });

  const text = [`👥 <b>Пользователи (${users.length})</b>`, ``, ...lines].join('\n');
  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export async function sendRecentActivity(chatId: string): Promise<void> {
  const rows = await getRecentActivity(25);
  if (rows.length === 0) {
    await bot.api.sendMessage(chatId, 'Событий пока нет.');
    return;
  }

  const lines = rows.map((r) => {
    const label = r.label ? ` — ${escapeHtml(r.label)}` : '';
    return `🕑 ${relativeTime(r.at)} · <b>${escapeHtml(r.userName)}</b> · <code>${r.event}</code>${label}`;
  });

  const text = [`🖱 <b>Последние действия</b>`, ``, ...lines].join('\n');
  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export async function sendUserDetail(chatId: string, userId: number): Promise<void> {
  const u = await getUserDetail(userId);
  if (!u) {
    await bot.api.sendMessage(chatId, `Пользователь #${userId} не найден.`);
    return;
  }

  const handle = u.username ? ` @${u.username}` : '';
  const topEvents =
    u.topEvents.length > 0
      ? u.topEvents.map((e) => `  • <code>${e.event}</code>: ${e.count}`).join('\n')
      : '  (нет событий)';

  const text = [
    `👤 <b>${escapeHtml(u.name)}</b>${escapeHtml(handle)}`,
    `🆔 DB id: <code>${u.id}</code> · TG id: <code>${u.telegramId}</code>`,
    `📅 Регистрация: ${u.createdAt.toISOString().split('T')[0]}`,
    ``,
    `📋 Привычек: <b>${u.habitCount}</b>`,
    `📝 Отметок: <b>${u.entryCount}</b>`,
    `🕑 Последнее действие: ${relativeTime(u.lastSeenAt)}` +
      (u.lastEvent ? ` (<code>${u.lastEvent}</code>)` : ''),
    ``,
    `🖱 Топ действий:`,
    topEvents,
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
