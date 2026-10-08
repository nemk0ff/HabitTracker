import { saveMe } from '../api/me';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';

export const CHECKIN_PRESETS = ['20:00', '21:00', '22:00', '23:00'] as const;

/** Saves the evening check-in time (local HH:MM, null = off) and mirrors it into the auth store. */
export async function saveCheckinTime(time: string | null): Promise<boolean> {
  try {
    await saveMe({ checkinTime: time });
    useAuthStore.getState().patchUser({ checkinTime: time });
    haptic('success');
    toast(time ? `Сохранено · сводка в ${time}` : 'Сохранено · сводка выключена');
    return true;
  } catch {
    haptic('error');
    toast('Не удалось сохранить, попробуй ещё раз', { tone: 'error' });
    return false;
  }
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
