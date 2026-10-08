import type { ReactNode } from 'react';
import { ChevronRight, Pause, Play, Undo2 } from 'lucide-react';
import { BottomSheet } from './nutrition/BottomSheet';
import { isSkippedOn } from '../utils/habits';
import { setHabitSkipped, setHabitValue } from '../utils/habitActions';
import type { Habit } from '../types';

interface Props {
  /** Habit whose tile was long-pressed; null = closed. */
  habit: Habit | null;
  date: string;
  onClose: () => void;
  onOpen: (id: number) => void;
}

/**
 * Long press on a Today tile: open the habit, take a pass for the day (ill / vacation —
 * the streak survives) or clear today's mark.
 */
export function HabitActionSheet({ habit, date, onClose, onOpen }: Props) {
  const skipped = habit ? isSkippedOn(habit, date) : false;
  const value = habit ? (habit.entries.find((e) => e.date === date)?.value ?? 0) : 0;

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <BottomSheet open={habit !== null} onClose={onClose} label={habit ? `«${habit.name}»: действия` : 'Действия'}>
      {habit && (
        <>
          <h2 className="text-lg font-semibold text-tg-text flex items-center gap-2 mb-4">
            <span className="text-2xl leading-none" aria-hidden>
              {habit.icon ?? '•'}
            </span>
            <span className="min-w-0 break-words">{habit.name}</span>
          </h2>
          <div className="flex flex-col gap-2">
            <Action icon={<ChevronRight size={20} aria-hidden />} onClick={() => run(() => onOpen(habit.id))}>
              Открыть привычку
            </Action>
            {skipped ? (
              <Action icon={<Play size={20} aria-hidden />} onClick={() => run(() => setHabitSkipped(habit, date, false))}>
                Отменить пропуск
              </Action>
            ) : (
              <Action
                icon={<Pause size={20} aria-hidden />}
                hint="Серия сохранится"
                onClick={() => run(() => setHabitSkipped(habit, date, true))}
              >
                Пропустить сегодня (болею / отпуск)
              </Action>
            )}
            {value > 0 && (
              <Action
                icon={<Undo2 size={20} aria-hidden />}
                destructive
                onClick={() => run(() => setHabitValue(habit, date, 0))}
              >
                Снять отметку
              </Action>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function Action({
  icon,
  hint,
  destructive,
  onClick,
  children,
}: {
  icon: ReactNode;
  hint?: string;
  destructive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-h-[52px] rounded-xl px-4 py-2 flex items-center gap-3 text-left bg-tg-section active:opacity-70 ${
        destructive ? 'text-tg-destructive' : 'text-tg-text'
      }`}
    >
      <span className={destructive ? undefined : 'text-tg-hint'}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-medium">{children}</span>
        {hint && <span className="block text-sm text-tg-hint">{hint}</span>}
      </span>
    </button>
  );
}
