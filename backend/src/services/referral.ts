/**
 * «Пригласить друга»: invite links `t.me/<bot>?start=ref_<userId>` and attributing new users to the inviter.
 * The link opens the bot chat; pressing Start sends `/start ref_<id>` (bot.ts), which registers the referral and
 * opens the bot's write channel. A `startapp=ref_<id>` `start_param` in initData (routes/auth.ts) is still honoured.
 */
import { prisma } from '../db.js';
import { bot } from './bot.js';

const REF_RE = /^ref_(\d{1,9})$/;

/** `ref_<userId>` → userId, anything else → null. */
export function parseRefParam(param: unknown): number | null {
  if (typeof param !== 'string') return null;
  const m = param.trim().match(REF_RE);
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The inviter to store for a user registering now: an existing user other than `selfId` (null = unknown yet,
 * the user is being created). Returns null when the ref is invalid.
 */
export async function resolveReferrer(param: unknown, selfId: number | null): Promise<number | null> {
  const referrerId = parseRefParam(param);
  if (referrerId === null || referrerId === selfId) return null;
  const exists = await prisma.user.findUnique({ where: { id: referrerId }, select: { id: true } });
  return exists ? referrerId : null;
}

let cachedUsername: string | null = null;

/** The bot's @username: botInfo after start, else env BOT_USERNAME, else a cached getMe(). */
export async function botUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername;
  try {
    cachedUsername = bot.botInfo.username; // throws before bot.init()
    return cachedUsername;
  } catch {
    // not initialized yet
  }
  if (process.env.BOT_USERNAME) {
    cachedUsername = process.env.BOT_USERNAME.replace(/^@/, '');
    return cachedUsername;
  }
  const me = await bot.api.getMe();
  cachedUsername = me.username;
  return cachedUsername;
}

export async function inviteLink(userId: number): Promise<string> {
  return `https://t.me/${await botUsername()}?start=ref_${userId}`;
}
