import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatHours } from '../utils/habits';
import { dailySeries } from '../utils/habitInsights';
import type { DayPoint } from '../utils/habitInsights';
import type { HabitEntry } from '../types';

const DAYS = 14;
const HEIGHT = 120;
const MAX_MIN = 10 * 60;
const GOAL_MIN = 7 * 60;

interface BarsProps {
  title: string;
  subtitle: string;
  points: DayPoint[];
  color: string;
  /** Top of the scale. */
  max: number;
  /** Dashed target line; bars under it are drawn faded. */
  goal: number;
  goalLabel: string;
  /** Bar value in words for the screen reader, e.g. «7,5 ч» or «5 из 8». */
  describe: (value: number) => string;
  onSelect: (date: string) => void;
}

/** Bars per day against a dashed target line (sleep hours, glasses of water...). */
export function DailyBarsChart({ title, subtitle, points, color, max, goal, goalLabel, describe, onSelect }: BarsProps) {
  const goalBottom = (Math.min(goal, max) / max) * HEIGHT;
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-tg-text">{title}</h2>
        <span className="block text-sm text-tg-hint mt-0.5">{subtitle}</span>
      </div>

      <div className="relative" style={{ height: HEIGHT }}>
        <div
          className="absolute left-0 right-0 border-t border-dashed pointer-events-none"
          style={{ bottom: goalBottom, borderColor: 'var(--tg-theme-hint-color)', opacity: 0.6 }}
        />
        <span className="absolute right-0 text-xs text-tg-hint pointer-events-none" style={{ bottom: goalBottom + 2 }}>
          {goalLabel}
        </span>

        <div className="absolute inset-0 flex items-end gap-[3px]">
          {points.map((p) => {
            const h = Math.min(p.value, max) / max;
            const label = p.value ? describe(p.value) : p.skipped ? 'пропуск' : 'не записано';
            return (
              <button
                key={p.date}
                onClick={() => onSelect(p.date)}
                aria-label={`${format(parseISO(p.date), 'd MMMM', { locale: ru })}: ${label}`}
                className="flex-1 h-full flex items-end"
              >
                <span
                  className="w-full rounded-t-[4px]"
                  style={
                    p.value
                      ? { height: `${Math.max(h * 100, 4)}%`, backgroundColor: color, opacity: p.value < goal ? 0.5 : 1 }
                      : p.skipped
                        ? {
                            height: 8,
                            backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
                            opacity: 0.6,
                          }
                        : { height: 3, backgroundColor: 'var(--tg-theme-hint-color)', opacity: 0.25 }
                  }
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between text-xs text-tg-hint mt-1.5">
        <span>{points[0] ? format(parseISO(points[0].date), 'd MMM', { locale: ru }) : ''}</span>
        <span>сегодня</span>
      </div>
    </div>
  );
}

interface SleepProps {
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
export function SleepChart({ entries, color, today, onSelect }: SleepProps) {
  const points = dailySeries({ entries }, today, DAYS);
  const logged = points.filter((n) => n.value > 0);
  const avg = logged.length ? logged.reduce((s, n) => s + n.value, 0) / logged.length : null;
  const short = logged.filter((n) => n.value < GOAL_MIN).length;
  const subtitle =
    (avg !== null ? `в среднем ${formatHours(avg)}` : 'нет записей') +
    (short > 0 ? ` · ${short} ${short === 1 ? 'ночь' : short < 5 ? 'ночи' : 'ночей'} меньше 7 ч` : '');

  return (
    <DailyBarsChart
      title="Сон за 2 недели"
      subtitle={subtitle}
      points={points}
      color={color}
      max={MAX_MIN}
      goal={GOAL_MIN}
      goalLabel="7 ч"
      describe={formatHours}
      onSelect={onSelect}
    />
  );
}
