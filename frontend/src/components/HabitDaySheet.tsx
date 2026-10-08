import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BottomSheet } from './nutrition/BottomSheet';
import { INTENSITY_LABELS } from '../utils/habitActions';
import { readableOn } from '../utils/colors';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
  /** Day being edited, null = closed. */
  date: string | null;
  onClose: () => void;
  onSave: (value: number) => void;
}

/**
 * Explicit choice for one day of a habit — replaces the old 0→1→2→3→0 tap cycle in the
 * calendar, which silently rewrote history and hid the intensity levels.
 */
export function HabitDaySheet({ habit, date, onClose, onSave }: Props) {
  const current = date ? (habit.entries.find((e) => e.date === date)?.value ?? 0) : 0;
  const options: { value: number; label: string }[] = habit.binary
    ? [{ value: 1, label: 'Выполнено' }]
    : INTENSITY_LABELS.map((label, i) => ({ value: i + 1, label }));

  const pick = (value: number) => {
    onSave(value);
    onClose();
  };

  return (
    <BottomSheet open={date !== null} onClose={onClose} label={`«${habit.name}»: отметка за день`}>
      {date && (
        <>
          <h2 className="text-lg font-semibold text-tg-text">{format(parseISO(date), 'd MMMM, EEEE', { locale: ru })}</h2>
          <p className="text-sm text-hint-strong mb-4">{habit.name}</p>
          <div className="flex gap-2">
            {options.map((o) => {
              const active = current === o.value || (habit.binary && current > 0);
              return (
                <button
                  key={o.value}
                  onClick={() => pick(o.value)}
                  aria-pressed={active}
                  className="flex-1 min-h-[52px] rounded-xl text-base font-semibold transition-colors"
                  style={
                    active
                      ? { backgroundColor: habit.color, color: readableOn(habit.color) }
                      : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {current > 0 && (
            <button
              onClick={() => pick(0)}
              className="w-full mt-3 min-h-[48px] rounded-xl text-base font-medium text-tg-destructive active:opacity-70"
            >
              Убрать отметку
            </button>
          )}
        </>
      )}
    </BottomSheet>
  );
}
