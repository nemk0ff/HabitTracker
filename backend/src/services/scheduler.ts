import cron from 'node-cron';
import { prisma } from '../db.js';
import { bot } from './bot.js';
import { sendToUser, type Recipient } from './messaging.js';

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SNOOZE_INTERVAL_MS = 5 * 60 * 1000;
const SNOOZE_WINDOW_MIN = 60;
const DAY_MS = 86_400_000;
/** Snooze state older than this is dropped without touching the message. */
const STALE_SNOOZE_MS = DAY_MS;

let isRunning = false;

function utcNow() {
  const now = new Date();
  return {
    hhmm: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`,
    todayStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    timestamp: now,
  };
}

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Minutes from the 'HH:MM' `time` to `nowMin`, wrapping past midnight. */
function minutesSince(time: string, nowMin: number): number {
  return (nowMin - timeToMinutes(time) + 1440) % 1440;
}

/**
 * The user's calendar date at `at`, as the UTC-midnight Date that HabitEntry uses.
 * `tzOffset` follows JS getTimezoneOffset() (UTC − local, Moscow = −180); without it
 * we assume Moscow (−180), the bulk of users — the same default as `localWeekday` and the check-in.
 */
function localDay(at: Date, tzOffset: number | null): number {
  const shifted = new Date(at.getTime() - (tzOffset ?? -180) * 60_000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * The user's local weekday ('mon'…'sun') at `at`. `days` are picked in local terms while
 * `time` is stored in UTC, so a 01:00 MSK Monday reminder fires at 22:00 UTC on Sunday.
 * Without an offset we assume Moscow (−180), the bulk of users.
 */
function localWeekday(at: Date, tzOffset: number | null): string {
  const shifted = new Date(at.getTime() - (tzOffset ?? -180) * 60_000);
  return DAY_MAP[shifted.getUTCDay()]!;
}

/** When the reminder that `sentAt` belongs to was scheduled (sends are ≤ SNOOZE_WINDOW_MIN after `time`). */
function originalSendInstant(sentAt: Date, time: string): Date {
  const elapsed = minutesSince(time, utcMinutes(sentAt));
  return new Date(sentAt.getTime() - elapsed * 60_000);
}

function parseDays(raw: string, reminderId: number): string[] {
  try {
    const days = JSON.parse(raw);
    return Array.isArray(days) ? days : [];
  } catch {
    console.error(`[scheduler] Reminder ${reminderId}: bad days JSON ${JSON.stringify(raw)} — skipped`);
    return [];
  }
}

/** Message id, or null when not delivered (closed channel, 403 → canMessage=false, or any other error). */
async function trySend(user: Recipient, text: string, purpose: string): Promise<number | null> {
  try {
    const msg = await sendToUser(user, text, { parse_mode: 'HTML' }, { purpose });
    return msg?.message_id ?? null;
  } catch (err) {
    console.error(`[scheduler] Failed to send to ${user.telegramId}:`, err);
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
  const { hhmm, todayStart, timestamp } = utcNow();

  const reminders = await prisma.reminder.findMany({
    where: { enabled: true, habit: { archived: false } },
    include: {
      habit: {
        include: {
          user: true,
          // Local dates span UTC yesterday..tomorrow; snooze may look one more day back.
          entries: { where: { date: { gte: new Date(todayStart.getTime() - 2 * DAY_MS) } }, select: { date: true } },
        },
      },
    },
  });

  if (reminders.length === 0) return;

  const hasEntry = (r: (typeof reminders)[number], dayMs: number) =>
    r.habit.entries.some((e) => e.date.getTime() === dayMs);

  // --- 1. Initial notifications (exact time + correct day + not checked on the user's local today) ---
  const dueReminders = reminders.filter((r) => {
    try {
      return (
        r.time === hhmm &&
        r.habit.user.canMessage !== false &&
        parseDays(r.days, r.id).includes(localWeekday(timestamp, r.habit.user.tzOffset)) &&
        !hasEntry(r, localDay(timestamp, r.habit.user.tzOffset))
      );
    } catch (err) {
      console.error(`[scheduler] Reminder ${r.id} check failed:`, err);
      return false;
    }
  });

  if (dueReminders.length > 0) {
    // Group by user for compact messages
    const grouped = new Map<string, typeof dueReminders>();
    for (const r of dueReminders) {
      const chatId = r.habit.user.telegramId.toString();
      if (!grouped.has(chatId)) grouped.set(chatId, []);
      grouped.get(chatId)!.push(r);
    }

    let sent = 0;
    for (const [chatId, group] of grouped) {
      try {
        const habits = group.map((r) => (r.habit.icon ? `${r.habit.icon} ${r.habit.name}` : r.habit.name));
        let text: string;
        if (habits.length === 1) {
          text = `⏰ Не забудь: <b>${habits[0]}</b>`;
        } else {
          const list = habits.map((n) => `  • ${n}`).join('\n');
          text = `⏰ У тебя <b>${habits.length}</b> непрочеканных привычек:\n${list}`;
        }
        if ((await trySend(group[0]!.habit.user, text, 'reminder')) === null) continue;

        // Snooze tracking starts only once the user actually got the message.
        for (const r of group) {
          await prisma.reminder.update({
            where: { id: r.id },
            data: { lastSentAt: timestamp, lastMessageId: null },
          });
        }
        sent += group.length;
      } catch (err) {
        console.error(`[scheduler] Initial reminder for ${chatId} failed:`, err);
      }
    }

    console.log(`[scheduler] Sent initial reminders for ${sent}/${dueReminders.length} habits at ${hhmm} UTC`);
  }

  // --- 2. Snooze follow-ups ---
  for (const r of reminders) {
    if (!r.snooze || !r.lastSentAt || r.habit.user.canMessage === false) continue;

    const chatId = r.habit.user.telegramId.toString();
    try {
      // The day the reminder was about — not "today", which may have rolled over since.
      const original = originalSendInstant(r.lastSentAt, r.time);
      const reminderDay = localDay(original, r.habit.user.tzOffset);

      // Habit was checked → clean up snooze state and delete old message
      if (hasEntry(r, reminderDay)) {
        if (r.lastMessageId) {
          await tryDelete(chatId, r.lastMessageId);
        }
        await prisma.reminder.update({
          where: { id: r.id },
          data: { lastMessageId: null, lastSentAt: null },
        });
        continue;
      }

      if (timestamp.getTime() - original.getTime() > STALE_SNOOZE_MS) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: { lastMessageId: null, lastSentAt: null },
        });
        continue;
      }

      // Check snooze window (max 1 hour after scheduled time)
      const elapsed = minutesSince(r.time, timeToMinutes(hhmm));
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
      const msgId = await trySend(r.habit.user, text, 'reminder_snooze');

      await prisma.reminder.update({
        where: { id: r.id },
        // On failure keep lastSentAt so the next tick retries; the old message is gone either way.
        data: msgId !== null ? { lastSentAt: timestamp, lastMessageId: msgId } : { lastMessageId: null },
      });

      if (msgId !== null) console.log(`[scheduler] Snooze: "${r.habit.name}" → ${chatId}`);
    } catch (err) {
      console.error(`[scheduler] Snooze for reminder ${r.id} (${chatId}) failed:`, err);
    }
  }
}

export function startScheduler() {
  cron.schedule(
    '* * * * *',
    async () => {
      // A slow tick (Telegram/DB latency) must not overlap the next one and double-send.
      if (isRunning) {
        console.warn('[scheduler] Previous run still in progress — tick skipped');
        return;
      }
      isRunning = true;
      try {
        await checkAndSendReminders();
      } catch (err) {
        console.error('[scheduler] Error:', err);
      } finally {
        isRunning = false;
      }
    },
    { timezone: 'UTC' },
  );
  console.log('[scheduler] Reminder scheduler started (runs every minute)');
}
