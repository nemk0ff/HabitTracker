import { Bot, GrammyError, HttpError } from 'grammy';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { prisma } from '../db.js';
import { track } from './analytics.js';
import { isOwnerTelegramId } from '../utils/owner.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
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

// ─── Owner gate ───────────────────────────────────────────────────────────────

const NOT_OWNER_TEXT = 'Это личный бот 🙂';

/**
 * A personal bot: anyone but the owner gets one short phrase per message (a popup for a button) —
 * no app button, no tracking, no user row. Other update kinds from them are dropped silently.
 */
bot.use(async (ctx, next) => {
  if (isOwnerTelegramId(ctx.from?.id)) return next();
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: NOT_OWNER_TEXT }).catch(() => {});
  } else if (ctx.message && ctx.chat?.type === 'private') {
    await ctx.reply(NOT_OWNER_TEXT).catch(() => {});
  }
});

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
  track({ userId, event: 'command_start', category: 'bot' });
  // The user wrote to the bot, so it can write back (reopens a channel closed by an earlier 403).
  if (userId !== null) {
    await prisma.user.update({ where: { id: userId }, data: { canMessage: true } }).catch((e) => console.error('[bot] canMessage on /start:', e));
  }

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
  const { sendQuickStats } = await import('./alerts.js');
  // Always to the owner's private chat — never into a group the command was typed in.
  const { ownerTelegramId } = await import('../utils/owner.js');
  await sendQuickStats(ownerTelegramId());
});

bot.command('claude_session', async () => {
  const { registerSessionStart } = await import('./claudeSessions.js');
  await registerSessionStart({ force: true });
});

/** Weekly nutrition summary on demand. */
bot.command('week', async (ctx) => {
  const userId = await resolveUserId(ctx.from?.id);
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

/** Evening check-in: `ci:` toggles a habit for the day, `cd:` («Готово») turns the message into a summary. */
bot.callbackQuery(/^(ci|cd):/, async (ctx) => {
  try {
    const { handleCheckinCallback } = await import('./checkin.js');
    const result = await handleCheckinCallback(ctx.from.id, ctx.callbackQuery.data ?? '');
    if (result.alert) {
      await ctx.answerCallbackQuery({ text: result.answer, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery(result.answer ? { text: result.answer } : undefined);
    if (result.message) {
      await ctx
        .editMessageText(result.message.text, { reply_markup: { inline_keyboard: result.message.keyboard as any } })
        .catch(() => {}); // "message is not modified" on a double tap
    }
  } catch (e) {
    console.error(`[bot] check-in callback failed (from ${ctx.from.id}, data ${ctx.callbackQuery.data}):`, e);
    await ctx.answerCallbackQuery({ text: 'Не получилось записать, попробуй ещё раз', show_alert: true }).catch(() => {});
  }
});

/** "↩️ Отменить" under an assistant reply: restores everything that message wrote (food, weight, sleep, habits). */
bot.callbackQuery(/^tlu:(.+)$/, async (ctx) => {
  try {
    const userId = await resolveUserId(ctx.from.id);
    const { undoJob } = await import('./assistant.js');
    const ok = userId !== null && (await undoJob(userId, ctx.match[1]!));
    await ctx.answerCallbackQuery(ok ? 'Отменено' : 'Нечего отменять');
    if (ok) {
      const text = ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
      await ctx.editMessageText(`${text}

↩️ Отменено — всё вернул как было`).catch(() => {});
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

  // The owner's plain text → the assistant (food / weight / sleep / habits / a question).
  if (text && !text.startsWith('/') && userId !== null) {
    // Not awaited: the agent can take minutes and grammY handles updates sequentially,
    // so waiting here would stall every other update.
    void assistantFromChat(ctx.chat.id, userId, text);
    return;
  }

  await ctx.reply('Открой трекер, чтобы управлять привычками 👇', openTrackerOptions());
});

/** Offline-parsed messages finish at once; only a real agent call gets the "⏳" status message. */
const QUICK_MS = 1500;

async function assistantFromChat(chatId: number, userId: number, text: string) {
  let statusId: number | null = null;
  const show = async (body: string, extra: Parameters<typeof bot.api.sendMessage>[2] = {}) => {
    if (statusId !== null) {
      try {
        await bot.api.editMessageText(chatId, statusId, body, extra as Parameters<typeof bot.api.editMessageText>[3]);
        return;
      } catch {
        // fall through to a fresh message
      }
    }
    await bot.api.sendMessage(chatId, body, extra);
  };
  try {
    const { startAssistant, waitForJob, formatAssistantResult, jobView } = await import('./assistant.js');
    const job = startAssistant(userId, text);
    await waitForJob(job, QUICK_MS);
    if (job.status === 'running') {
      statusId = (await bot.api.sendMessage(chatId, '⏳ Передал агенту — обычно это 2–5 минут…')).message_id;
      await waitForJob(job);
    }
    if (job.status === 'done' && job.result) {
      await show(
        formatAssistantResult(job.result),
        jobView(job).canUndo ? { reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `tlu:${job.id}` }]] } } : {},
      );
    } else {
      await show(`❌ ${job.error ?? 'Не получилось записать'}`);
    }
  } catch (e) {
    console.error(`[bot] assistant failed (user ${userId}):`, e);
    // Never leave the "⏳" status hanging: replace it, or send a fresh message if editing fails.
    await show('❌ Не получилось записать — попробуй ещё раз или добавь в трекере').catch((err) =>
      console.error('[bot] assistant error notice failed:', err),
    );
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
