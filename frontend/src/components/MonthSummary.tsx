import { useMemo, type ReactNode } from 'react';
import { CalendarHeart, Flame, PauseCircle } from 'lucide-react';
import { bestWeekday, monthSummary } from '../utils/habitInsights';
import { pluralDays } from '../utils/habits';
import { legibleColor, useIsDark } from '../utils/colors';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
  today: string;
}

/** «Этот месяц»: done days (or met weeks), the month's best run, best weekday, passes. */
export function MonthSummary({ habit, today }: Props) {
  const isDark = useIsDark();
  const s = useMemo(() => monthSummary(habit, today), [habit, today]);
  const weekday = useMemo(() => bestWeekday(habit, today), [habit, today]);
  const accent = legibleColor(habit.color, isDark);

  const weekly = s.weeks && s.weeks.total > 0 ? s.weeks : null;
  const done = weekly ? weekly.met : s.doneDays;
  const total = weekly ? weekly.total : s.totalDays - s.skipped;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const caption = weekly ? 'недель с выполненной целью' : 'дней выполнено';

  return (
    <section className="bg-tg-section rounded-2xl p-4 mb-5" aria-label={`Этот месяц, ${s.monthLabel}`}>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-tg-text">Этот месяц</h2>
        <span className="text-sm text-tg-hint">{s.monthLabel}</span>
      </div>

      {total === 0 && !weekly ? (
        <p className="text-sm text-hint-strong">В этом месяце ещё нет дней — начни сегодня</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] leading-none font-semibold tabular-nums" style={{ color: accent }}>
              {done}
              <span className="text-tg-hint font-medium text-lg">/{total}</span>
            </span>
            <span className="text-sm text-hint-strong">{caption}</span>
            {!weekly && s.rate !== null && (
              <span className="ml-auto text-sm font-semibold tabular-nums text-tg-text">{s.rate}%</span>
            )}
          </div>

          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${habit.color}26` }}>
            <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: habit.color }} />
          </div>

          <ul className="mt-4 flex flex-col gap-2.5 text-sm text-tg-text">
            {s.bestStreak > 0 && (
              <Line icon={<Flame size={16} fill="currentColor" strokeWidth={1.5} style={{ color: accent }} aria-hidden />}>
                Лучшая серия — {pluralDays(s.bestStreak)}
              </Line>
            )}
            {weekday && (
              <Line icon={<CalendarHeart size={16} strokeWidth={1.75} style={{ color: accent }} aria-hidden />}>
                Лучше всего получается по {weekday.label}
              </Line>
            )}
            {s.skipped > 0 && (
              <Line icon={<PauseCircle size={16} strokeWidth={1.75} className="text-tg-hint" aria-hidden />}>
                <span className="text-hint-strong">
                  Пропусков: {s.skipped} — серию не ломают
                </span>
              </Line>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="w-5 flex justify-center shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
