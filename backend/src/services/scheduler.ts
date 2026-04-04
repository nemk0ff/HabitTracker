import cron from 'node-cron';
import { prisma } from '../db.js';
import { bot } from './bot.js';

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SNOOZE_INTERVAL_MS = 5 * 60 * 1000;
const SNOOZE_WINDOW_MIN = 60;

function utcNow() {
  const now = new Date();
  return {
    hhmm: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`,
    day: DAY_MAP[now.getUTCDay()],
    todayStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    timestamp: now,
  };
}

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

async function trySend(chatId: string, text: string): Promise<number | null> {
  try {
    const msg = await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return msg.message_id;
  } catch (err) {
    console.error(`[scheduler] Failed to send to ${chatId}:`, err);
    return null;
  }
}

async function tryDelete(chatId: string, messageId: number) {
  try {
    await bot.api.deleteMessage(chatId, messageId);
  } catch {
    // already deleted or too old
  }
}

async function checkAndSendReminders() {
  const { hhmm, day, todayStart, timestamp } = utcNow();

  const reminders = await prisma.reminder.findMany({
    where: { enabled: true },
    include: {
      habit: {
        include: {
          user: true,
          entries: { where: { date: { gte: todayStart } } },
        },
      },
    },
  });

  if (reminders.length === 0) return;

  // --- 1. Initial notifications (exact time + correct day + not checked) ---
  const dueReminders = reminders.filter((r) => {
    const days: string[] = JSON.parse(r.days);
    return days.includes(day) && r.time === hhmm && r.habit.entries.length === 0;
  });

  if (dueReminders.length > 0) {
    // Group by user for compact messages
    const grouped = new Map<string, string[]>();
    for (const r of dueReminders) {
      const chatId = r.habit.user.telegramId.toString();
      if (!grouped.has(chatId)) grouped.set(chatId, []);
      grouped.get(chatId)!.push(r.habit.icon ? `${r.habit.icon} ${r.habit.name}` : r.habit.name);
    }

    for (const [chatId, habits] of grouped) {
      let text: string;
      if (habits.length === 1) {
        text = `⏰ Не забудь: <b>${habits[0]}</b>`;
      } else {
        const list = habits.map((n) => `  • ${n}`).join('\n');
        text = `⏰ У тебя <b>${habits.length}</b> непрочеканных привычек:\n${list}`;
      }
      await trySend(chatId, text);
    }

    // Mark lastSentAt for snooze tracking
    for (const r of dueReminders) {
      await prisma.reminder.update({
        where: { id: r.id },
        data: { lastSentAt: timestamp, lastMessageId: null },
      });
    }

    console.log(`[scheduler] Sent initial reminders for ${dueReminders.length} habits at ${hhmm} UTC`);
  }

  // --- 2. Snooze follow-ups ---
  for (const r of reminders) {
    if (!r.snooze || !r.lastSentAt) continue;

    const chatId = r.habit.user.telegramId.toString();

    // Habit was checked → clean up snooze state and delete old message
    if (r.habit.entries.length > 0) {
      if (r.lastMessageId) {
        await tryDelete(chatId, r.lastMessageId);
      }
      await prisma.reminder.update({
        where: { id: r.id },
        data: { lastMessageId: null, lastSentAt: null },
      });
      continue;
    }

    // Check snooze window (max 1 hour after scheduled time)
    const nowMin = timeToMinutes(hhmm);
    const scheduledMin = timeToMinutes(r.time);
    const elapsed = ((nowMin - scheduledMin) + 1440) % 1440;
    if (elapsed === 0 || elapsed > SNOOZE_WINDOW_MIN) continue;

    // Check 5-minute interval since last send
    const msSinceLast = timestamp.getTime() - r.lastSentAt.getTime();
    if (msSinceLast < SNOOZE_INTERVAL_MS) continue;

    // Delete old message, send new one
    if (r.lastMessageId) {
      await tryDelete(chatId, r.lastMessageId);
    }

    const habitName = r.habit.icon ? `${r.habit.icon} ${r.habit.name}` : r.habit.name;
    const text = `🔔 Напоминание: <b>${habitName}</b>\n<i>Повтор каждые 5 мин</i>`;
    const msgId = await trySend(chatId, text);

    await prisma.reminder.update({
      where: { id: r.id },
      data: { lastSentAt: timestamp, lastMessageId: msgId },
    });

    console.log(`[scheduler] Snooze: "${r.habit.name}" → ${chatId}`);
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', () => {
    checkAndSendReminders().catch((err) => {
      console.error('[scheduler] Error:', err);
    });
  });
  console.log('[scheduler] Reminder scheduler started (runs every minute)');
}
