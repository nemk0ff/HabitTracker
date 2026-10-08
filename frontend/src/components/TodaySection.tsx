import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { HabitTile } from './HabitTile';
import { haptic } from '../hooks/useTelegramButtons';
import { isClosedOn, isHoursHabit } from '../utils/habits';
import { markAll } from '../utils/habitActions';
import type { Habit } from '../types';

interface Props {
  label: string;
  habits: Habit[];
  date: string;
  /** False when every habit sits in one section — then it looks like a plain grid. */
  showHeader: boolean;
  onTap: (habit: Habit) => void;
  onOpen: (id: number) => void;
  /** Long press on a tile: the actions sheet (open / skip / unmark). */
  onMenu?: (habit: Habit) => void;
  /** Extra tile at the end of the grid (the «Добавить» tile in the last section). */
  trailing?: ReactNode;
}

/** One time-of-day block of the Today screen: «Утро 2/4 · Отметить всё», collapses once all done. */
export function TodaySection({ label, habits, date, showHeader, onTap, onOpen, onMenu, trailing }: Props) {
  // A skipped habit (ill / vacation) is closed for the day, like a done one.
  const done = habits.filter((h) => isClosedOn(h, date)).length;
  const allDone = done === habits.length;
  // Hours habits need a value, so «Отметить всё» only covers the rest — and only pays off for 2+.
  const markable = habits.filter((h) => !isHoursHabit(h) && !isClosedOn(h, date)).length >= 2;
  const [expanded, setExpanded] = useState(false);

  // A section that is no longer complete (undo) starts collapsed again next time it closes.
  useEffect(() => {
    if (!allDone) setExpanded(false);
  }, [allDone]);

  const collapsed = showHeader && allDone && !expanded;
  const grid = (children: ReactNode) => <div className="grid grid-cols-3 gap-2">{children}</div>;

  if (collapsed) {
    return (
      <section className="mb-4" aria-label={label}>
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            haptic('select');
          }}
          aria-expanded={false}
          className="w-full min-h-[48px] rounded-2xl px-4 flex items-center justify-between bg-tg-section active:opacity-70"
        >
          <span className="text-base font-semibold" style={{ color: 'var(--accent)' }}>
            {label} ✓ <span className="tabular-nums">{done}/{habits.length}</span>
          </span>
          <ChevronDown size={18} className="text-tg-hint" aria-hidden />
        </button>
        {trailing && <div className="mt-2">{grid(trailing)}</div>}
      </section>
    );
  }

  return (
    <section className={showHeader ? 'mb-4' : undefined} aria-label={showHeader ? label : undefined}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <button
            type="button"
            disabled={!allDone}
            onClick={() => {
              setExpanded(false);
              haptic('select');
            }}
            aria-expanded={allDone ? true : undefined}
            className="flex items-baseline gap-2 min-h-[40px] text-left"
          >
            <h3 className="text-sm font-semibold text-tg-text">{label}</h3>
            <span
              className="text-sm tabular-nums"
              style={{ color: allDone ? 'var(--accent)' : 'var(--tg-theme-hint-color)' }}
            >
              {done}/{habits.length}
            </span>
            {allDone && <ChevronUp size={16} className="text-tg-hint self-center" aria-hidden />}
          </button>
          {markable && (
            <button
              type="button"
              onClick={() => markAll(habits, date, label)}
              className="text-sm font-medium min-h-[40px] px-1 active:opacity-60"
              style={{ color: 'var(--accent)' }}
            >
              Отметить всё
            </button>
          )}
        </div>
      )}
      {grid(
        <>
          {habits.map((h) => (
            <HabitTile key={h.id} habit={h} date={date} onTap={onTap} onOpen={onOpen} onMenu={onMenu} />
          ))}
          {trailing}
        </>,
      )}
    </section>
  );
}
