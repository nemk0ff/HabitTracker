import { saveMe } from '../api/me';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';

export const CHECKIN_PRESETS = ['20:00', '21:00', '22:00', '23:00'] as const;

export const MORNING_CHECKIN_PRESETS = ['07:00', '08:00', '09:00'] as const;

type CheckinField = 'checkinTime' | 'morningCheckinTime';

/** Saves a check-in time (local HH:MM, null = off) and mirrors it into the auth store. */
async function saveTime(field: CheckinField, time: string | null, name: string): Promise<boolean> {
  try {
    await saveMe({ [field]: time });
    useAuthStore.getState().patchUser({ [field]: time });
    haptic('success');
    toast(time ? `Сохранено · ${name} в ${time}` : `Сохранено · ${name} выключена`);
    return true;
  } catch {
    haptic('error');
    toast('Не удалось сохранить, попробуй ещё раз', { tone: 'error' });
    return false;
  }
}

/** Evening check-in in the bot. */
export function saveCheckinTime(time: string | null): Promise<boolean> {
  return saveTime('checkinTime', time, 'сводка');
}

/** Morning check-in with morning habits only. */
export function saveMorningCheckinTime(time: string | null): Promise<boolean> {
  return saveTime('morningCheckinTime', time, 'утренняя сводка');
}

const BANNER_KEY = 'checkinBannerDismissed';

export function isCheckinBannerDismissed(): boolean {
  try {
    return localStorage.getItem(BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissCheckinBanner() {
  try {
    localStorage.setItem(BANNER_KEY, '1');
  } catch {
    // Private mode / blocked storage: the banner just comes back next launch.
  }
}
