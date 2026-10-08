import { memo, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Flame } from 'lucide-react';
import { MiniHeatmap } from './MiniHeatmap';
import { toDateString } from '../utils/dates';
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
  /** Stats line parts, joined with « · ». The streak part (if any) gets the flame icon. */
  flame: number | null;
  parts: string[];
}

function computeStats(h: Habit, today: string): CardStats {
  const value = valueOn(h, today);
  const done = isDoneValue(h, value);

  if (isCountHabit(h)) {
    const target = Math.max(1, h.dailyTarget ?? 1);
    const avg = averageValue(h, WINDOW_DAYS, today);
    return {
      chip: `${value}/${target}`,
      done,
      mark: false,
      flame: null,
      parts: [`сегодня ${value}/${target}`, ...(avg !== null ? [`в среднем ${formatNumber(avg)}`] : [])],
    };
  }

  if (isHoursHabit(h)) {
    const avg = averageValue(h, WINDOW_DAYS, today);
    return {
      chip: value > 0 ? formatHours(value) : '—',
      done,
      mark: false,
      flame: null,
      parts: [`сегодня ${value > 0 ? formatHours(value) : '—'}`, ...(avg !== null ? [`в среднем ${formatHours(avg)}`] : [])],
    };
  }

  if (h.weeklyTarget) {
    const week = weekProgress(h, today);
    const run = weeklyStreak(h, today);
    return {
      chip: done ? 'сегодня' : 'не отмечено',
      done,
      mark: true,
      flame: null,
      parts: [`${week.done} из ${week.target} на этой неделе`, ...(run > 0 ? [`${run} нед. подряд`] : [])],
    };
  }

  const { current, best } = streaks(h);
  const rate = completionRate(h, WINDOW_DAYS, today);
  const parts: string[] = [];
  if (best > current) parts.push(`рекорд ${best}`);
  if (rate !== null && (rate > 0 || current > 0 || best > 0)) parts.push(`${rate}% за ${WINDOW_DAYS} дней`);
  return { chip: done ? 'сегодня' : 'не отмечено', done, mark: true, flame: current > 0 ? current : null, parts };
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

  const statsText = [stats.flame !== null ? `серия ${stats.flame}` : null, ...stats.parts].filter(Boolean).join(', ');
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
        <span className="flex-1 min-w-0 font-semibold text-tg-text text-base leading-snug break-words line-clamp-2">
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

      {/* Full-width history */}
      <div className="mt-3">
        <MiniHeatmap entries={heatEntries} color={habit.color} startDate={startDate} metWeekStarts={metWeeks} />
      </div>

      {/* Stats line */}
      <p className="mt-2.5 text-sm text-hint-strong flex items-center flex-wrap gap-x-1.5 leading-snug">
        {stats.flame !== null && (
          <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: accentText }}>
            <Flame size={14} fill="currentColor" strokeWidth={1.5} aria-hidden />
            {stats.flame}
          </span>
        )}
        {stats.parts.map((p, i) => (
          <span key={p}>
            {(i > 0 || stats.flame !== null) && <span aria-hidden>· </span>}
            {p}
          </span>
        ))}
        {stats.flame === null && stats.parts.length === 0 && <span>Пока без отметок — начни сегодня</span>}
      </p>
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
