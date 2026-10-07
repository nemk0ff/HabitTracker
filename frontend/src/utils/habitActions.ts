import { useHabitsStore } from '../stores/habitsStore';
import { toast, type ToastAction } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import { formatHours, isHoursHabit } from './habits';
import type { Habit } from '../types';

export const INTENSITY_LABELS = ['Легко', 'Средне', 'Тяжело'] as const;

/** Habits whose marks carry an intensity (not done/not-done, not hours). */
export function hasIntensity(h: Habit): boolean {
  return !h.binary && !isHoursHabit(h);
}

function describe(habit: Habit, value: number): string {
  if (value === 0) return `«${habit.name}»: отметка снята`;
  if (isHoursHabit(habit)) return `«${habit.name}»: ${formatHours(value)}`;
  if (hasIntensity(habit)) return `«${habit.name}»: ${INTENSITY_LABELS[Math.min(value, 3) - 1]!.toLowerCase()}`;
  return `«${habit.name}»: отмечено`;
}

/**
 * Sets a habit's value for a date and shows a toast with "Отменить"
 * (an accidental tap is undone in one tap instead of silently changing history).
 * A fresh mark of an intensity habit also offers Легко / Средне / Тяжело right in the toast.
 */
export function setHabitValue(habit: Habit, date: string, value: number, { askIntensity = true } = {}) {
  const { toggleEntry } = useHabitsStore.getState();
  const prev = habit.entries.find((e) => e.date === date)?.value ?? 0;
  if (prev === value) return;
  toggleEntry(habit.id, date, value);
  haptic(value > 0 ? 'light' : 'select');

  const undo: ToastAction = { label: 'Отменить', onClick: () => toggleEntry(habit.id, date, prev) };
  const offerIntensity = askIntensity && hasIntensity(habit) && prev === 0 && value > 0;
  const actions = offerIntensity
    ? [
        ...INTENSITY_LABELS.map((label, i) => ({
          label,
          onClick: () => {
            toggleEntry(habit.id, date, i + 1);
            haptic('select');
          },
        })),
        undo,
      ]
    : [undo];
  const text = offerIntensity ? `«${habit.name}» отмечено. Как прошло?` : describe(habit, value);
  toast(text, { actions, ms: offerIntensity ? 6000 : 4000 });
}

/** One-tap check / uncheck for the day (hours habits need a value — use the hours sheet instead). */
export function toggleHabitDay(habit: Habit, date: string) {
  const done = habit.entries.some((e) => e.date === date && e.value > 0);
  setHabitValue(habit, date, done ? 0 : 1);
}
