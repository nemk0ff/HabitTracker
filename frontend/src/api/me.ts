import { api } from './client';

/** Saves the user's own settings: evening / morning check-in times (local HH:MM, null = off). */
export function saveMe(data: {
  checkinTime?: string | null;
  morningCheckinTime?: string | null;
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
