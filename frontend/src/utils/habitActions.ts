import { useHabitsStore } from '../stores/habitsStore';
import { useAuthStore } from '../stores/authStore';
import { toast, type ToastAction } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import { formatHours, isClosedOn, isCountHabit, isDoneValue, isHoursHabit, isMarkedOn, isSkippedOn } from './habits';
import type { EntryTimes } from '../api/habits';
import type { Habit } from '../types';

export const INTENSITY_LABELS = ['Легко', 'Средне', 'Тяжело'] as const;

/** Count entries are capped server-side. */
export const MAX_COUNT = 999;

/** Habits whose marks carry an intensity (not done/not-done, not hours, not count). */
export function hasIntensity(h: Habit): boolean {
  return !h.binary && !isHoursHabit(h) && !isCountHabit(h);
}

/** Daily target of a count habit (at least 1). */
export function countTarget(h: Pick<Habit, 'dailyTarget'>): number {
  return Math.max(1, h.dailyTarget ?? 1);
}

function valueOn(habit: Habit, date: string): number {
  return habit.entries.find((e) => e.date === date)?.value ?? 0;
}

function describe(habit: Habit, value: number, times?: EntryTimes | null): string {
  if (value === 0) return `«${habit.name}»: отметка снята`;
  if (isHoursHabit(habit) && times) return `«${habit.name}»: ${times.startTime}–${times.endTime} · ${formatHours(value)}`;
  if (isHoursHabit(habit)) return `«${habit.name}»: ${formatHours(value)}`;
  if (isCountHabit(habit)) return `${habit.name}: ${value} из ${countTarget(habit)}`;
  if (hasIntensity(habit)) return `«${habit.name}»: ${INTENSITY_LABELS[Math.min(value, 3) - 1]!.toLowerCase()}`;
  return `«${habit.name}»: отмечено`;
}

/** No habit has a single done day yet (checked before the optimistic update). */
function noMarksYet(habits: Habit[]): boolean {
  return habits.every((h) => !h.entries.some((e) => isDoneValue(h, e.value)));
}

/**
 * Sets a habit's value for a date and shows a toast with "Отменить"
 * (an accidental tap is undone in one tap instead of silently changing history).
 * A fresh mark of an intensity habit also offers Легко / Средне / Тяжело right in the toast.
 */
export function setHabitValue(
  habit: Habit,
  date: string,
  value: number,
  { askIntensity = true, times = null }: { askIntensity?: boolean; times?: EntryTimes | null } = {},
) {
  const { toggleEntry, habits } = useHabitsStore.getState();
  const prevEntry = habit.entries.find((e) => e.date === date);
  const prev = prevEntry?.value ?? 0;
  const prevSkipped = isSkippedOn(habit, date);
  const prevTimes: EntryTimes | null =
    prevEntry?.startTime && prevEntry.endTime ? { startTime: prevEntry.startTime, endTime: prevEntry.endTime } : null;
  const sameTimes = (prevTimes?.startTime ?? null) === (times?.startTime ?? null) && (prevTimes?.endTime ?? null) === (times?.endTime ?? null);
  if (prev === value && !prevSkipped && (value === 0 || sameTimes)) return;
  const firstEver = isDoneValue(habit, value) && noMarksYet(habits);
  const undo: ToastAction = {
    label: 'Отменить',
    onClick: () => void toggleEntry(habit.id, date, prev, prevSkipped, prevSkipped ? null : prevTimes),
  };
  const offerIntensity = askIntensity && hasIntensity(habit) && prev === 0 && value > 0;
  const actions = offerIntensity
    ? [
        ...INTENSITY_LABELS.map((label, i) => ({
          label,
          onClick: () => {
            void toggleEntry(habit.id, date, i + 1);
            haptic('select');
          },
        })),
        undo,
      ]
    : [undo];

  void toggleEntry(habit.id, date, value, false, value > 0 ? times : null);
  haptic(value > 0 ? 'light' : 'select');

  if (firstEver) {
    haptic('success');
    const hasCheckin = !!useAuthStore.getState().user?.checkinTime;
    toast(hasCheckin ? 'Первая отметка! Вечером напомню в боте 🔔' : 'Первая отметка! Так и продолжай 🎉', {
      actions,
      ms: 6000,
    });
    return;
  }
  const text = offerIntensity ? `«${habit.name}» отмечено. Как прошло?` : describe(habit, value, times);
  toast(text, { actions, ms: offerIntensity ? 6000 : 4000 });
}

/**
 * Marks a day as a pass (ill / vacation) or takes the pass back. A skip overrides a mark, keeps
 * the streak and lowers the week's goal; the toast offers "Отменить" back to the previous state.
 */
export function setHabitSkipped(habit: Habit, date: string, skipped: boolean) {
  const { toggleEntry } = useHabitsStore.getState();
  const prev = valueOn(habit, date);
  const prevSkipped = isSkippedOn(habit, date);
  if (prevSkipped === skipped) return;
  const e = habit.entries.find((x) => x.date === date);
  const prevTimes = e?.startTime && e.endTime ? { startTime: e.startTime, endTime: e.endTime } : null;
  void toggleEntry(habit.id, date, 0, skipped);
  haptic('select');
  const undo: ToastAction = {
    label: 'Отменить',
    onClick: () => void toggleEntry(habit.id, date, prev, prevSkipped, prevSkipped ? null : prevTimes),
  };
  toast(skipped ? 'Пропуск — серия сохранится' : `«${habit.name}»: пропуск отменён`, { actions: [undo], ms: 5000 });
}

/** One-tap check / uncheck for the day (hours habits need a value — use the hours sheet instead). */
export function toggleHabitDay(habit: Habit, date: string) {
  if (isCountHabit(habit)) {
    setHabitValue(habit, date, isMarkedOn(habit, date) ? 0 : countTarget(habit));
    return;
  }
  setHabitValue(habit, date, isMarkedOn(habit, date) ? 0 : 1);
}

/** Count habits: one more (a glass of water, a pill) — toast «Вода: 3 из 8» with "Отменить". */
export function incrementCount(habit: Habit, date: string) {
  const prev = valueOn(habit, date);
  if (prev >= MAX_COUNT) return;
  setHabitValue(habit, date, prev + 1);
}

/**
 * Marks every not-done habit of a group at once (binary/levels → 1, count → its target;
 * hours habits are skipped — they need a value). One toast undoes the whole batch.
 */
export function markAll(habits: Habit[], date: string, label: string) {
  const { toggleEntry } = useHabitsStore.getState();
  const batch = habits
    .filter((h) => !isHoursHabit(h) && !isClosedOn(h, date))
    .map((h) => ({ id: h.id, prev: valueOn(h, date), next: isCountHabit(h) ? countTarget(h) : 1 }));
  if (batch.length === 0) return;
  const actions: ToastAction[] = [
    {
      label: 'Отменить',
      onClick: () => {
        for (const b of batch) void toggleEntry(b.id, date, b.prev);
        haptic('select');
      },
    },
  ];
  for (const b of batch) void toggleEntry(b.id, date, b.next);
  haptic('light');
  toast(`${label}: отмечено ${batch.length}`, { actions, ms: 5000 });
}
