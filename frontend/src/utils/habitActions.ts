import { useHabitsStore } from '../stores/habitsStore';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import { formatHours, isHoursHabit } from './habits';
import type { Habit } from '../types';

/**
 * Sets a habit's value for a date and shows "Отмечено · Отменить"
 * (an accidental tap is undone in one tap instead of silently changing history).
 */
export function setHabitValue(habit: Habit, date: string, value: number) {
  const { toggleEntry } = useHabitsStore.getState();
  const prev = habit.entries.find((e) => e.date === date)?.value ?? 0;
  if (prev === value) return;
  toggleEntry(habit.id, date, value);
  haptic(value > 0 ? 'light' : 'select');

  const what =
    value === 0
      ? `«${habit.name}»: отметка снята`
      : isHoursHabit(habit)
        ? `«${habit.name}»: ${formatHours(value)}`
        : `«${habit.name}»: отмечено`;
  toast(what, { actions: [{ label: 'Отменить', onClick: () => toggleEntry(habit.id, date, prev) }] });
}

/** One-tap check / uncheck for the day (hours habits need a value — use the hours sheet instead). */
export function toggleHabitDay(habit: Habit, date: string) {
  const done = habit.entries.some((e) => e.date === date && e.value > 0);
  setHabitValue(habit, date, done ? 0 : 1);
}
