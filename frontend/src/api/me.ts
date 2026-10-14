import { api } from './client';
import type { InviteInfo } from '../types';

/**
 * Saves the user's own settings: evening / morning check-in times (local HH:MM, null = off)
 * and the onboarding flag.
 */
export function saveMe(data: {
  checkinTime?: string | null;
  morningCheckinTime?: string | null;
  onboarded?: boolean;
  tzOffset?: number;
}): Promise<{ ok: true }> {
  return api<{ ok: true }>('/api/me', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** After Telegram granted write access: the backend sends a confirmation and reports whether it got through. */
export function requestWriteAccessApi(): Promise<{ canMessage: boolean }> {
  return api<{ canMessage: boolean }>('/api/me/write-access', { method: 'POST' });
}

/** The user's invite link (t.me deep link with ref_<id>) and how many people joined through it. */
export function fetchInvite(): Promise<InviteInfo> {
  return api<InviteInfo>('/api/me/invite');
}

/** Records an earned achievement (analytics `achievement_unlocked`); idempotent server-side. */
export function postAchievement(key: string): Promise<unknown> {
  return api('/api/me/achievement', { method: 'POST', body: JSON.stringify({ key }) });
}

/**
 * Sends a rendered progress card (PNG data URL) to the user's chat with the bot, captioned with
 * the invite link. `reason: 'unreachable'` = the bot can't message the user yet.
 */
export function shareCardApi(image: string, caption?: string): Promise<{ ok: boolean; reason?: string }> {
  return api<{ ok: boolean; reason?: string }>('/api/share/card', {
    method: 'POST',
    body: JSON.stringify({ image, caption }),
  });
}
