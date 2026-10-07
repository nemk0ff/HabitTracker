import { addDays, format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toDateString } from '../utils/dates';
import { formatHours } from '../utils/habits';
import type { HabitEntry } from '../types';

const NIGHTS = 14;
const MAX_MIN = 10 * 60;
const GOAL_MIN = 7 * 60;
const HEIGHT = 120;

interface Props {
  entries: HabitEntry[];
  color: string;
  today: string;
  /** Tap on a night opens the hours picker for it. */
  onSelect: (date: string) => void;
}

/**
 * Hours per night for the last two weeks. The 3-shade heatmap hides the
 * difference between 7 and 9 hours — bars against a 7 h line don't.
 */
export function SleepChart({ entries, color, today, onSelect }: Props) {
  const byDate = new Map(entries.map((e) => [e.date, e.value]));
  const nights = Array.from({ length: NIGHTS }, (_, i) => {
    const date = toDateString(addDays(parseISO(today), i - NIGHTS + 1));
    return { date, minutes: byDate.get(date) ?? 0 };
  });
  const logged = nights.filter((n) => n.minutes > 0);
  const avg = logged.length ? logged.reduce((s, n) => s + n.minutes, 0) / logged.length : null;
  const short = logged.filter((n) => n.minutes < GOAL_MIN).length;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-tg-text">Сон за 2 недели</h2>
        <span className="block text-sm text-tg-hint mt-0.5">
          {avg !== null ? `в среднем ${formatHours(avg)}` : 'нет записей'}
          {short > 0 && ` · ${short} ${short === 1 ? 'ночь' : short < 5 ? 'ночи' : 'ночей'} меньше 7 ч`}
        </span>
      </div>

      <div className="relative" style={{ height: HEIGHT }}>
        {/* 7-hour goal line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed pointer-events-none"
          style={{ bottom: (GOAL_MIN / MAX_MIN) * HEIGHT, borderColor: 'var(--tg-theme-hint-color)', opacity: 0.6 }}
        />
        <span
          className="absolute right-0 text-xs text-tg-hint pointer-events-none"
          style={{ bottom: (GOAL_MIN / MAX_MIN) * HEIGHT + 2 }}
        >
          7 ч
        </span>

        <div className="absolute inset-0 flex items-end gap-[3px]">
          {nights.map((n) => {
            const h = Math.min(n.minutes, MAX_MIN) / MAX_MIN;
            return (
              <button
                key={n.date}
                onClick={() => onSelect(n.date)}
                aria-label={`${format(parseISO(n.date), 'd MMMM', { locale: ru })}: ${n.minutes ? formatHours(n.minutes) : 'не записано'}`}
                className="flex-1 h-full flex items-end"
              >
                <span
                  className="w-full rounded-t-[4px]"
                  style={{
                    height: n.minutes ? `${Math.max(h * 100, 4)}%` : 3,
                    backgroundColor: n.minutes ? color : 'var(--tg-theme-hint-color)',
                    opacity: n.minutes ? (n.minutes < GOAL_MIN ? 0.5 : 1) : 0.25,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between text-xs text-tg-hint mt-1.5">
        <span>{format(parseISO(nights[0]!.date), 'd MMM', { locale: ru })}</span>
        <span>сегодня</span>
      </div>
    </div>
  );
}
