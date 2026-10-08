import { Bot, GrammyError, HttpError } from 'grammy';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { prisma } from '../db.js';
import { track } from './analytics.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';
const SOCKS_PROXY = process.env.SOCKS_PROXY || '';

const botOptions: ConstructorParameters<typeof Bot>[1] = {};
if (SOCKS_PROXY) {
  const agent = new SocksProxyAgent(SOCKS_PROXY);
  botOptions.client = { baseFetchConfig: { agent, compress: true } };
  console.log(`[bot] Using SOCKS proxy: ${SOCKS_PROXY}`);
}

export const bot = new Bot(BOT_TOKEN, botOptions);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveUserId(telegramId: number | undefined): Promise<number | null> {
  if (!telegramId) return null;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  return user?.id ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  const name = escapeHtml(ctx.from?.first_name ?? 'друг');
  const text =
    `Привет, ${name}! 👋\n\n` +
    `✅ Отмечай привычки в один тап\n` +
    `🔔 Вечером напомню сам — отметить можно прямо здесь, в чате\n` +
    `📈 Серии и прогресс по неделям всегда перед глазами\n\n` +
    `Открой трекер и добавь первую привычку 👇`;
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

bot.command('claude_session', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const { registerSessionStart } = await import('./claudeSessions.js');
  await registerSessionStart({ force: true });
});

bot.command('users', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const { sendUsersList } = await import('./alerts.js');
  await sendUsersList(DEVELOPER_CHAT_ID);
});

bot.command('activity', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const { sendRecentActivity } = await import('./alerts.js');
  await sendRecentActivity(DEVELOPER_CHAT_ID);
});

bot.command('user', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const id = Number(ctx.match?.toString().trim());
  if (!Number.isInteger(id) || id <= 0) {
    await ctx.reply('Использование: /user <DB id> — например /user 3\nСписок id: /users');
    return;
  }
  const { sendUserDetail } = await import('./alerts.js');
  await sendUserDetail(DEVELOPER_CHAT_ID, id);
});

/** Weekly nutrition summary on demand (nutrition-module users only). */
bot.command('week', async (ctx) => {
  const { hasNutritionAccess } = await import('../utils/features.js');
  if (!ctx.from || !hasNutritionAccess(ctx.from.id)) return;
  const userId = await resolveUserId(ctx.from.id);
  if (!userId) return;
  await ctx.replyWithChatAction('typing');
  const { weeklySummaryText } = await import('./nutrition/weeklySummary.js');
  await ctx.reply(await weeklySummaryText(userId));
});

/** One-tap answers to the daily prompts (sleep / weight / training / day complete). */
bot.callbackQuery(/^(sl|wt|tr|dc):/, async (ctx) => {
  try {
    const { handlePromptCallback } = await import('./nutrition/prompts.js');
    const result = await handlePromptCallback(ctx, ctx.callbackQuery.data ?? '');
    if (!result) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (result.alert) {
      // Invalid / outdated button: say so, but leave the question in the chat.
      await ctx.answerCallbackQuery({ text: result.text, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery(result.text);
    await ctx.editMessageText(result.text).catch(() => {});
  } catch (e) {
    console.error(`[bot] prompt callback failed (from ${ctx.from.id}, data ${ctx.callbackQuery.data}):`, e);
    await ctx.answerCallbackQuery({ text: 'Не получилось записать, попробуй ещё раз', show_alert: true }).catch(() => {});
  }
});

/** "↩️ Отменить" under a text-log result: removes the entries (and products) it created. */
bot.callbackQuery(/^tlu:(.+)$/, async (ctx) => {
  try {
    const userId = await resolveUserId(ctx.from.id);
    const { undoJob } = await import('./nutrition/textLog.js');
    const ok = userId !== null && (await undoJob(userId, ctx.match[1]!));
    await ctx.answerCallbackQuery(ok ? 'Отменено' : 'Нечего отменять');
    if (ok) {
      const text = ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
      await ctx.editMessageText(`${text}

↩️ Отменено — записи удалены`).catch(() => {});
    }
  } catch (e) {
    console.error(`[bot] text-log undo failed (from ${ctx.from.id}):`, e);
    await ctx.answerCallbackQuery({ text: 'Не получилось отменить, попробуй ещё раз', show_alert: true }).catch(() => {});
  }
});

bot.on('message', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
  const text = ctx.message.text;
  track({
    userId,
    event: 'message_received',
    category: 'bot',
    label: text?.slice(0, 80) ?? undefined,
  });

  // Developer's plain text = "что я съел" → Hermes agent → diary.
  const { hasAgentLogAccess } = await import('../utils/features.js');
  if (text && !text.startsWith('/') && userId !== null && ctx.from && hasAgentLogAccess(ctx.from.id)) {
    const status = await ctx.reply('⏳ Передал агенту — обычно это 2–5 минут…');
    // Not awaited: the agent can take minutes and grammY handles updates sequentially,
    // so waiting here would stall every other user's updates.
    void logFoodFromChat(ctx.chat.id, status.message_id, userId, text);
    return;
  }

  await ctx.reply('Открой трекер, чтобы управлять привычками 👇', openTrackerOptions());
});

async function logFoodFromChat(chatId: number, messageId: number, userId: number, text: string) {
  try {
    const { startTextLog, waitForJob, formatResult } = await import('./nutrition/textLog.js');
    const job = await waitForJob(startTextLog(userId, text));
    if (job.status === 'done' && job.result) {
      await bot.api.editMessageText(chatId, messageId, formatResult(job.result), {
        reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `tlu:${job.id}` }]] },
      });
    } else {
      await bot.api.editMessageText(chatId, messageId, `❌ ${job.error ?? 'Не получилось записать'}`);
    }
  } catch (e) {
    console.error(`[bot] food log failed (user ${userId}):`, e);
    // Never leave the "⏳" status hanging: replace it, or send a fresh message if editing fails.
    const errorText = '❌ Не получилось записать — попробуй ещё раз или добавь в трекере';
    try {
      await bot.api.editMessageText(chatId, messageId, errorText);
    } catch {
      await bot.api.sendMessage(chatId, errorText).catch((err) => console.error('[bot] food log error notice failed:', err));
    }
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Without this, one throwing handler stops long polling while pm2 still shows "online". */
bot.catch(async (err) => {
  const ctx = err.ctx;
  const e = err.error;
  const where = `update ${ctx.update.update_id} from ${ctx.from?.id ?? '?'}`;
  if (e instanceof GrammyError) {
    console.error(`[bot] Telegram API error in ${where}: ${e.description}`);
  } else if (e instanceof HttpError) {
    console.error(`[bot] Network error in ${where}:`, e.error);
  } else {
    console.error(`[bot] Handler error in ${where}:`, e);
  }
  // Stop the spinner on a tapped button; the user just sees a short notice.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: 'Что-то пошло не так, попробуй ещё раз' }).catch(() => {});
  }
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
): Promise<boolean> {
  const options: any = { parse_mode: 'HTML' as const };
  if (webAppUrl) {
    options.reply_markup = {
      inline_keyboard: [[{ text: '📱 Открыть трекер', web_app: { url: webAppUrl } }]],
    };
  }
  try {
    await bot.api.sendMessage(chatId, text, options);
    return true;
  } catch (err) {
    console.error(`Failed to send message to ${chatId}:`, err);
    return false;
  }
}
