import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Minus, Plus } from 'lucide-react';
import { BottomSheet } from './nutrition/BottomSheet';
import { INTENSITY_LABELS, MAX_COUNT, countTarget } from '../utils/habitActions';
import { readableOn } from '../utils/colors';
import { isCountHabit } from '../utils/habits';
import { haptic } from '../hooks/useTelegramButtons';
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
  const count = isCountHabit(habit);
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
          {count ? (
            <CountStepper key={date} habit={habit} initial={current} onSave={pick} />
          ) : (
            <>
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
        </>
      )}
    </BottomSheet>
  );
}

/** − value + with quick «0» / «Цель N» for count habits, saved explicitly. */
function CountStepper({ habit, initial, onSave }: { habit: Habit; initial: number; onSave: (value: number) => void }) {
  const target = countTarget(habit);
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);

  const set = (v: number) => {
    setValue(Math.max(0, Math.min(MAX_COUNT, v)));
    haptic('select');
  };
  const stepBtn = 'w-14 h-14 rounded-2xl bg-tg-section text-tg-text flex items-center justify-center active:opacity-70 disabled:opacity-40';
  const quickBtn = (active: boolean) =>
    active
      ? { backgroundColor: habit.color, color: readableOn(habit.color) }
      : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= 0} aria-label="Меньше" className={stepBtn}>
          <Minus size={24} aria-hidden />
        </button>
        <div className="text-center" aria-live="polite">
          <div className="font-display text-[40px] leading-none tabular-nums text-tg-text">{value}</div>
          <div className="text-sm text-tg-hint mt-1">из {target}</div>
        </div>
        <button type="button" onClick={() => set(value + 1)} disabled={value >= MAX_COUNT} aria-label="Больше" className={stepBtn}>
          <Plus size={24} aria-hidden />
        </button>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => set(0)}
          aria-pressed={value === 0}
          className="flex-1 min-h-[44px] rounded-xl text-base font-medium transition-colors"
          style={quickBtn(value === 0)}
        >
          0
        </button>
        <button
          type="button"
          onClick={() => set(target)}
          aria-pressed={value === target}
          className="flex-1 min-h-[44px] rounded-xl text-base font-medium transition-colors"
          style={quickBtn(value === target)}
        >
          Цель {target}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSave(value)}
        className="w-full mt-3 min-h-[52px] rounded-xl text-base font-semibold active:opacity-80"
        style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
      >
        Сохранить
      </button>
    </>
  );
}
