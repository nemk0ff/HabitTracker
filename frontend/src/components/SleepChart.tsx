import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatHours } from '../utils/habits';
import { dailySeries, hasTimes, hhmmToMin, sleepRegime } from '../utils/habitInsights';
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
  /** Optional bed-time target "HH:MM": a dashed line, nights after it are marked late. */
  target?: string | null;
  /** Tap on a night opens the sleep sheet for it. */
  onSelect: (date: string) => void;
}

/**
 * Sleep for the last two weeks. With bed / wake times — a bar per night from bed to wake on a
 * 20:00 → 12:00 axis; otherwise hours per night against a 7 h line (the 3-shade heatmap hides
 * the difference between 7 and 9 hours — bars don't).
 */
export function SleepChart({ entries, color, today, target = null, onSelect }: SleepProps) {
  const points = dailySeries({ entries }, today, DAYS);
  const logged = points.filter((n) => n.value > 0);
  const avg = logged.length ? logged.reduce((s, n) => s + n.value, 0) / logged.length : null;
  const short = logged.filter((n) => n.value < GOAL_MIN).length;
  const subtitle =
    (avg !== null ? `в среднем ${formatHours(avg)}` : 'нет записей') +
    (short > 0 ? ` · ${short} ${short === 1 ? 'ночь' : short < 5 ? 'ночи' : 'ночей'} меньше 7 ч` : '');

  const byDate = new Map(entries.map((e) => [e.date, e]));
  if (points.some((p) => hasTimes(byDate.get(p.date)))) {
    const regime = sleepRegime(entries, today, target, DAYS);
    return (
      <NightBars
        points={points}
        byDate={byDate}
        color={color}
        subtitle={subtitle}
        target={target}
        lateDates={regime?.lateDates ?? new Set()}
        typicalWake={regime ? regime.avgWake : '08:00'}
        onSelect={onSelect}
      />
    );
  }

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

/* Axis 20:00 → 12:00 of the next day, in minutes from 20:00. */
const AXIS_START = 20 * 60;
const AXIS_LEN = 16 * 60;
const TICKS = ['20', '22', '00', '02', '04', '06', '08', '10', '12'];
const ROW = 22;

const axisPos = (hhmm: string) => (hhmmToMin(hhmm) - AXIS_START + 24 * 60) % (24 * 60);
const pct = (min: number) => `${(Math.max(0, Math.min(AXIS_LEN, min)) / AXIS_LEN) * 100}%`;

function NightBars({
  points,
  byDate,
  color,
  subtitle,
  target,
  lateDates,
  typicalWake,
  onSelect,
}: {
  points: DayPoint[];
  byDate: Map<string, HabitEntry>;
  color: string;
  subtitle: string;
  target: string | null;
  lateDates: Set<string>;
  typicalWake: string;
  onSelect: (date: string) => void;
}) {
  const late = 'var(--tg-theme-destructive-text-color, #e5484d)';
  const lateCount = points.filter((p) => lateDates.has(p.date)).length;
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-tg-text">Сон за 2 недели</h2>
        <span className="block text-sm text-tg-hint mt-0.5">
          {subtitle}
          {lateCount > 0 && (
            <>
              {' · '}
              <span style={{ color: late }}>поздний отбой: {lateCount}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex text-[10px] text-tg-hint tabular-nums pl-10 pr-11 mb-1" aria-hidden>
        <div className="relative flex-1 h-3">
          {TICKS.map((t, i) => (
            <span key={t + i} className="absolute -translate-x-1/2" style={{ left: `${(i / (TICKS.length - 1)) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        {[...points].reverse().map((p) => {
          const e = byDate.get(p.date);
          const d = parseISO(p.date);
          const day = format(d, 'EEEEEE d', { locale: ru });
          let bar: { left: number; width: number; timed: boolean } | null = null;
          if (hasTimes(e)) {
            const left = axisPos(e.startTime);
            bar = { left, width: e.value, timed: true };
          } else if (p.value > 0) {
            // Hours only: the length is right, the position is a guess (ending at the usual wake).
            const end = axisPos(typicalWake);
            bar = { left: end - p.value, width: p.value, timed: false };
          }
          const isLate = lateDates.has(p.date);
          const label = hasTimes(e)
            ? `${e.startTime}–${e.endTime}, ${formatHours(e.value)}${isLate ? ', поздний отбой' : ''}`
            : p.value
              ? formatHours(p.value)
              : p.skipped
                ? 'пропуск'
                : 'не записано';
          return (
            <button
              key={p.date}
              onClick={() => onSelect(p.date)}
              aria-label={`${format(d, 'd MMMM', { locale: ru })}: ${label}`}
              className="flex items-center gap-0 text-left active:opacity-70"
              style={{ height: ROW }}
            >
              <span className="w-10 shrink-0 text-xs text-tg-hint tabular-nums">{day}</span>
              <span className="relative flex-1 h-full">
                {/* Grid: midnight + target line */}
                <span
                  className="absolute top-0 bottom-0 border-l pointer-events-none"
                  style={{ left: pct(4 * 60), borderColor: 'var(--tg-theme-hint-color)', opacity: 0.2 }}
                />
                {target && (
                  <span
                    className="absolute top-0 bottom-0 border-l border-dashed pointer-events-none"
                    style={{ left: pct(axisPos(target)), borderColor: 'var(--tg-theme-hint-color)', opacity: 0.7 }}
                  />
                )}
                {bar ? (
                  <span
                    className="absolute top-[5px] bottom-[5px] rounded-full"
                    style={{
                      left: pct(bar.left),
                      width: `calc(${pct(bar.left + bar.width)} - ${pct(bar.left)})`,
                      backgroundColor: bar.timed ? color : 'transparent',
                      backgroundImage: bar.timed ? undefined : `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
                      opacity: bar.timed ? (p.value < GOAL_MIN ? 0.55 : 1) : 0.6,
                      boxShadow: isLate ? `inset 3px 0 0 ${late}` : undefined,
                    }}
                  />
                ) : (
                  <span
                    className="absolute left-0 right-0 top-1/2 h-px"
                    style={{ backgroundColor: 'var(--tg-theme-hint-color)', opacity: p.skipped ? 0.5 : 0.15 }}
                  />
                )}
              </span>
              <span className="w-11 shrink-0 text-right text-xs tabular-nums" style={{ color: p.value ? 'var(--tg-theme-text-color)' : 'var(--tg-theme-hint-color)' }}>
                {p.value ? formatHours(p.value) : p.skipped ? 'пропуск' : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
