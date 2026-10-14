/**
 * The app is a personal tool of one owner: the Telegram user whose id equals DEVELOPER_CHAT_ID.
 * Every access check (API, bot) and every bot-initiated send goes through these helpers.
 * Env is read on each call so scripts can set DEVELOPER_CHAT_ID at runtime.
 */
import type { Prisma } from '@prisma/client';

/** The user `initData: 'dev-mode'` logs in as (routes/auth.ts). */
export const DEV_TELEGRAM_ID = 999999;

/**
 * Local-only test login. Deliberately NOT derived from NODE_ENV: prod runs without NODE_ENV=production,
 * so the old check left `initData: 'dev-mode'` open in production. Set DEV_LOGIN=1 only on a dev machine.
 */
export const devLoginEnabled = () => process.env.DEV_LOGIN === '1';
const isDev = devLoginEnabled;

/** DEVELOPER_CHAT_ID, or '' when unset. */
export function ownerTelegramId(): string {
  return (process.env.DEVELOPER_CHAT_ID || '').trim();
}

/** True for the owner. In dev the dev-mode test user is let in too, so local UI work keeps working. */
export function isOwnerTelegramId(telegramId: number | bigint | string | null | undefined): boolean {
  if (telegramId === null || telegramId === undefined) return false;
  const id = String(telegramId);
  const owner = ownerTelegramId();
  if (owner !== '' && id === owner) return true;
  return isDev() && id === String(DEV_TELEGRAM_ID);
}

/**
 * `where` for bot-initiated sends: the owner only (in dev without DEVELOPER_CHAT_ID — the dev-mode user).
 * Matches nobody when no owner is configured in production.
 */
export function ownerWhere(): Prisma.UserWhereInput {
  const owner = ownerTelegramId();
  if (owner !== '' && /^\d+$/.test(owner)) return { telegramId: BigInt(owner) };
  if (isDev()) return { telegramId: BigInt(DEV_TELEGRAM_ID) };
  return { id: -1 };
}
