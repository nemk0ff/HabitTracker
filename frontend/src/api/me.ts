import { api } from './client';

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
