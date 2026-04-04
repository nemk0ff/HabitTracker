import { Bot } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN || '';

export const bot = new Bot(BOT_TOKEN);

export async function sendMessage(chatId: number | string, text: string, webAppUrl?: string) {
  const options: any = { parse_mode: 'HTML' as const };

  if (webAppUrl) {
    options.reply_markup = {
      inline_keyboard: [
        [{ text: '📱 Открыть трекер', web_app: { url: webAppUrl } }],
      ],
    };
  }

  try {
    await bot.api.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Failed to send message to ${chatId}:`, err);
  }
}
