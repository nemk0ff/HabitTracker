import { Bot } from 'grammy';
import { prisma } from '../db.js';
import { track } from './analytics.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';

export const bot = new Bot(BOT_TOKEN);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveUserId(telegramId: number | undefined): Promise<number | null> {
  if (!telegramId) return null;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  return user?.id ?? null;
}

function openTrackerOptions() {
  if (!WEBAPP_URL) return {};
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '📱 Открыть трекер', web_app: { url: WEBAPP_URL } }]],
    },
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
  track({ userId, event: 'command_start', category: 'bot' });

  const name = ctx.from?.first_name ?? 'друг';
  const text = `Привет, ${name}! 👋\n\nЯ помогу тебе отслеживать привычки.\nОткрой трекер, чтобы начать.`;
  await ctx.reply(text, { parse_mode: 'HTML', ...openTrackerOptions() });
});

bot.command('help', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
  track({ userId, event: 'command_help', category: 'bot' });

  await ctx.reply(
    'Я присылаю напоминания о привычках.\n\n' +
      'Настрой напоминания прямо в трекере — выбери привычку и нажми на колокольчик 🔔',
  );
});

bot.command('stats', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const { sendQuickStats } = await import('./alerts.js');
  await sendQuickStats(DEVELOPER_CHAT_ID);
});

bot.on('message', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
  track({
    userId,
    event: 'message_received',
    category: 'bot',
    label: (ctx.message as any)?.text?.slice(0, 80) ?? undefined,
  });

  await ctx.reply('Открой трекер, чтобы управлять привычками 👇', openTrackerOptions());
});

// ─── Start / Stop ─────────────────────────────────────────────────────────────

export function startBot(): void {
  if (!BOT_TOKEN) {
    console.warn('[bot] BOT_TOKEN not set — bot polling skipped');
    return;
  }
  bot
    .start({
      onStart: (info) => console.log(`[bot] Polling started as @${info.username}`),
    })
    .catch((err) => console.error('[bot] Fatal polling error:', err));
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  webAppUrl?: string,
): Promise<void> {
  const options: any = { parse_mode: 'HTML' as const };
  if (webAppUrl) {
    options.reply_markup = {
      inline_keyboard: [[{ text: '📱 Открыть трекер', web_app: { url: webAppUrl } }]],
    };
  }
  try {
    await bot.api.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Failed to send message to ${chatId}:`, err);
  }
}
