import { saveMe } from '../api/me';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import { ensureWriteAccess } from './writeAccess';

export const CHECKIN_PRESETS = ['20:00', '21:00', '22:00', '23:00'] as const;

export const MORNING_CHECKIN_PRESETS = ['07:00', '08:00', '09:00'] as const;

/** The morning briefing is on by default (null = 09:00); this stored value turns it off. */
export const MORNING_OFF = 'off';
export const DEFAULT_MORNING_TIME = '09:00';

type CheckinField = 'checkinTime' | 'morningCheckinTime';

/**
 * Saves a check-in time (local HH:MM; null / 'off' = off) and mirrors it into the auth store; a set time
 * then asks for Telegram write access (without it the bot can't send the check-in).
 */
async function saveTime(field: CheckinField, time: string | null, name: string): Promise<boolean> {
  const on = time !== null && time !== MORNING_OFF;
  try {
    await saveMe({ [field]: time });
    useAuthStore.getState().patchUser({ [field]: time });
    haptic('success');
    toast(on ? `Сохранено · ${name} в ${time}` : `Сохранено · ${name} выключена`);
    // The time stays saved either way; without write access the bot just can't deliver it.
    if (on) void ensureWriteAccess();
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

/** Morning briefing: HH:MM or MORNING_OFF. */
export function saveMorningCheckinTime(time: string | null): Promise<boolean> {
  return saveTime('morningCheckinTime', time, 'утренняя сводка');
}
