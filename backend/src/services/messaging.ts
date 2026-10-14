/**
 * The one path for bot-initiated messages to users (check-ins, reminders, nutrition prompts, weekly summary).
 *
 * Keeps `User.canMessage` honest: a 403 means the bot can't write to this person — they never pressed
 * /start (opened the Mini App directly) or blocked the bot. That is NOT "turned the check-in off", so
 * their settings stay; we just mark the channel closed and skip sends until it reopens (/start, initData
 * `allows_write_to_pm`, or `POST /api/me/write-access`).
 */
import { InputFile } from 'grammy';
import type { Message } from 'grammy/types';
import { prisma } from '../db.js';
import { bot } from './bot.js';
import { track } from './analytics.js';

export interface Recipient {
  id: number;
  telegramId: bigint;
  canMessage: boolean | null;
}

type SendExtra = Parameters<typeof bot.api.sendMessage>[2];

interface SendOptions {
  /** What was being sent — goes into the `bot_unreachable` event label. */
  purpose?: string;
  /** Try even when the channel is known to be closed (the user just granted access). */
  force?: boolean;
}

export const isForbidden = (e: unknown): boolean => (e as { error_code?: number } | null)?.error_code === 403;

/**
 * Sends `text` to `user`. Returns the message, or null when skipped (channel closed) or Telegram answered
 * 403 (then `canMessage` becomes false). Other errors are thrown — callers keep their own handling.
 * Mutates `user.canMessage` so further sends in the same run see the new state.
 */
export async function sendToUser(
  user: Recipient,
  text: string,
  extra?: SendExtra,
  opts: SendOptions = {},
): Promise<Message.TextMessage | null> {
  return deliver(user, opts, () => bot.api.sendMessage(String(user.telegramId), text, extra));
}

type PhotoExtra = Parameters<typeof bot.api.sendPhoto>[2];

/** Same as `sendToUser`, for a photo from memory (e.g. a PNG the Mini App rendered). */
export async function sendPhotoToUser(
  user: Recipient,
  photo: Buffer,
  extra?: PhotoExtra,
  opts: SendOptions = {},
): Promise<Message.PhotoMessage | null> {
  return deliver(user, opts, () => bot.api.sendPhoto(String(user.telegramId), new InputFile(photo, 'card.png'), extra));
}

/** Runs `send` unless the channel is known closed; keeps `canMessage` in sync with the outcome (403 → false). */
async function deliver<M>(user: Recipient, opts: SendOptions, send: () => Promise<M>): Promise<M | null> {
  if (user.canMessage === false && !opts.force) return null;
  let msg: M;
  try {
    msg = await send();
  } catch (e) {
    if (!isForbidden(e)) throw e;
    if (user.canMessage !== false) {
      user.canMessage = false;
      await prisma.user.update({ where: { id: user.id }, data: { canMessage: false } });
    }
    track({ userId: user.id, event: 'bot_unreachable', category: 'bot', label: opts.purpose });
    return null;
  }
  if (user.canMessage !== true) {
    user.canMessage = true;
    await prisma.user.update({ where: { id: user.id }, data: { canMessage: true } });
  }
  return msg;
}
