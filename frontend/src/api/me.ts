import { api } from './client';

/** Saves the user's own settings: evening check-in time (local HH:MM, null = off) and the onboarding flag. */
export function saveMe(data: { checkinTime?: string | null; onboarded?: boolean; tzOffset?: number }): Promise<{ ok: true }> {
  return api<{ ok: true }>('/api/me', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
