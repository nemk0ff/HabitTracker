import { memo, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Flame } from 'lucide-react';
import { MiniHeatmap } from './MiniHeatmap';
import { toDateString } from '../utils/dates';
import { countTarget } from '../utils/habitActions';
import { useNavStore } from '../stores/navStore';
import { formatHours, isCountHabit, isDoneValue, isHoursHabit, levelEntries, weekProgress, weeklyStreak } from '../utils/habits';
import { averageValue, completionRate, formatNumber, habitStartDate, metWeekStarts, streaks, valueOn } from '../utils/habitStats';
import { readableOn, legibleColor, useIsDark } from '../utils/colors';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
  readOnly?: boolean;
}

const WINDOW_DAYS = 30;

interface CardStats {
  /** Today's state chip text, e.g. «3/8», «7,5 ч», «сегодня», «не отмечено». */
  chip: string;
  done: boolean;
  /** Plain done/not-done habit: the chip gets a ✓ when done and a muted outline when not. */
  mark: boolean;
  /** Headline number of the stats column: «80%», «2/3», «3/8», «7,2 ч». */
  big: string;
  /** What the headline means: «за 30 дней», «на неделе»... */
  caption: string;
  /** Current run with the flame icon («5» or «3 нед.»); null hides it. */
  flame: string | null;
  /** One small extra line, e.g. «рекорд 12». */
  extra: string | null;
}

function computeStats(h: Habit, today: string): CardStats {
  const value = valueOn(h, today);
  const done = isDoneValue(h, value);
  const { current, best } = streaks(h);
  const flame = current > 0 ? String(current) : null;
  const record = best > current ? `рекорд ${best}` : null;

  if (isCountHabit(h)) {
    const avg = averageValue(h, WINDOW_DAYS, today);
    const rate = completionRate(h, WINDOW_DAYS, today);
    return {
      // Today's progress lives in the chip; the big number is the 30-day hit rate.
      chip: `${value}/${countTarget(h)}`,
      done,
      mark: false,
      big: rate !== null ? `${rate}%` : '—',
      caption: 'дней с целью',
      flame,
      extra: avg !== null ? `в среднем ${formatNumber(avg)}` : record,
    };
  }

  if (isHoursHabit(h)) {
    const avg = averageValue(h, WINDOW_DAYS, today);
    return {
      chip: value > 0 ? formatHours(value) : '—',
      done,
      mark: false,
      big: avg !== null ? formatHours(avg) : '—',
      caption: 'в среднем',
      flame: null,
      extra: avg !== null ? `за ${WINDOW_DAYS} дней` : null,
    };
  }

  if (h.weeklyTarget) {
    const week = weekProgress(h, today);
    const run = weeklyStreak(h, today);
    const rate = completionRate(h, WINDOW_DAYS, today);
    return {
      chip: done ? 'сегодня' : 'не отмечено',
      done,
      mark: true,
      big: `${week.done}/${week.needed}`,
      caption: 'на неделе',
      flame: run > 0 ? `${run} нед.` : null,
      extra: run === 0 && rate ? `${rate}% за ${WINDOW_DAYS} дн.` : null,
    };
  }

  const rate = completionRate(h, WINDOW_DAYS, today);
  return {
    chip: done ? 'сегодня' : 'не отмечено',
    done,
    mark: true,
    big: rate !== null ? `${rate}%` : '—',
    caption: `за ${WINDOW_DAYS} дней`,
    flame,
    extra: record ?? (h.entries.length === 0 ? 'начни сегодня' : null),
  };
}

export const HabitCard = memo(function HabitCard({ habit, readOnly = false }: Props) {
  const navigate = useNavStore((s) => s.navigate);
  const isDark = useIsDark();
  const todayStr = toDateString(new Date());

  // Recomputed only when this habit (or the day) changes, not on every parent render.
  const stats = useMemo(() => computeStats(habit, todayStr), [habit, todayStr]);
  const heatEntries = useMemo(() => levelEntries(habit), [habit]);
  const metWeeks = useMemo(() => (habit.weeklyTarget ? metWeekStarts(habit) : undefined), [habit]);
  const startDate = useMemo(() => habitStartDate(habit), [habit]);

  const accentText = legibleColor(habit.color, isDark);
  const onColor = readableOn(habit.color);

  const statsText = [
    `${stats.big} ${stats.caption}`,
    stats.flame !== null ? `серия ${stats.flame}` : null,
    stats.extra,
  ]
    .filter(Boolean)
    .join(', ');
  const stateText = stats.done ? 'сегодня выполнено' : 'сегодня не выполнено';

  const open = () => navigate('habit', { selectedHabitId: habit.id });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileTap={readOnly ? undefined : { scale: 0.98 }}
      onClick={readOnly ? undefined : open}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      aria-label={readOnly ? undefined : `${habit.name}: ${stateText}${statsText ? `. ${statsText}` : ''}. Открыть`}
      onKeyDown={
        readOnly
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }
      }
      className={`bg-tg-section rounded-2xl p-4 ${readOnly ? '' : 'cursor-pointer focus-ring'}`}
    >
      {/* Header: icon · name · today's state */}
      <div className="flex items-center gap-3">
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ backgroundColor: `${habit.color}22` }}
          aria-hidden
        >
          {habit.icon || '•'}
        </span>
        <span className="flex-1 min-w-0 font-semibold text-tg-text text-base leading-snug truncate">
          {habit.name}
        </span>
        <TodayChip
          done={stats.done}
          muted={stats.mark && !stats.done}
          color={habit.color}
          onColor={onColor}
          accentText={accentText}
          label={stateText}
        >
          {stats.done && stats.mark ? <Check size={14} strokeWidth={2.75} aria-hidden /> : null}
          {stats.chip}
        </TodayChip>
        {!readOnly && <ChevronRight size={18} className="text-tg-hint -mr-1 shrink-0" aria-hidden />}
      </div>

      {/* Body: stats on the left, history fills the rest */}
      <div className="mt-3 flex items-start gap-3">
        <div className="w-[76px] shrink-0 flex flex-col" aria-hidden>
          <span
            className="text-[22px] leading-none font-semibold tabular-nums tracking-tight whitespace-nowrap"
            style={{ color: stats.big === '—' ? 'var(--hint-strong)' : accentText }}
          >
            {stats.big}
          </span>
          <span className="mt-1 text-xs leading-tight text-tg-hint">{stats.caption}</span>
          {stats.flame !== null && (
            <span
              className="mt-2.5 inline-flex items-center gap-1 text-[13px] leading-none font-semibold whitespace-nowrap"
              style={{ color: accentText }}
            >
              <Flame size={13} fill="currentColor" strokeWidth={1.5} aria-hidden />
              {stats.flame}
            </span>
          )}
          {stats.extra && (
            <span className={`${stats.flame !== null ? 'mt-1.5' : 'mt-2.5'} text-xs leading-tight text-hint-strong`}>
              {stats.extra}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <MiniHeatmap entries={heatEntries} color={habit.color} startDate={startDate} metWeekStarts={metWeeks} />
        </div>
      </div>
    </motion.div>
  );
});

function TodayChip({
  done,
  muted,
  color,
  onColor,
  accentText,
  label,
  children,
}: {
  done: boolean;
  /** Not-done mark: neutral outline so it doesn't read as "today, in the habit's color". */
  muted: boolean;
  color: string;
  onColor: string;
  accentText: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <span
      title={label}
      className="shrink-0 h-7 px-2.5 rounded-full inline-flex items-center gap-1 text-xs font-semibold tabular-nums whitespace-nowrap"
      style={
        done
          ? { backgroundColor: color, color: onColor }
          : muted
            ? { boxShadow: 'inset 0 0 0 1.5px var(--hint-strong)', color: 'var(--hint-strong)' }
            : { boxShadow: `inset 0 0 0 1.5px ${color}`, color: accentText }
      }
    >
      {children}
    </span>
  );
}
