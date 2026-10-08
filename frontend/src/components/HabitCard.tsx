import { memo, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import { MiniHeatmap } from './MiniHeatmap';
import { calculateStreak, toDateString } from '../utils/dates';
import { useNavStore } from '../stores/navStore';
import { HoursSheet } from './HoursSheet';
import { formatHours, isHoursHabit, levelEntries, weekProgress } from '../utils/habits';
import { Check, ChevronRight, Flame } from 'lucide-react';
import { setHabitValue, toggleHabitDay } from '../utils/habitActions';
import { readableOn, legibleColor, useIsDark } from '../utils/colors';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
  readOnly?: boolean;
}

export const HabitCard = memo(function HabitCard({ habit, readOnly = false }: Props) {
  const navigate = useNavStore((s) => s.navigate);
  const todayStr = toDateString(new Date());
  // Recomputed only when this habit (or the day) changes, not on every parent render.
  const { current } = useMemo(() => calculateStreak(habit.entries), [habit.entries, todayStr]);
  const heatEntries = useMemo(() => levelEntries(habit), [habit]);
  const weekDone = useMemo(
    () => (habit.weeklyTarget ? weekProgress(habit, todayStr).done : 0),
    [habit, todayStr],
  );
  const todayEntry = habit.entries.find((e) => e.date === todayStr);
  const isDoneToday = todayEntry && todayEntry.value > 0;

  const hours = isHoursHabit(habit);
  const isDark = useIsDark();
  const onColor = readableOn(habit.color);
  const textColor = legibleColor(habit.color, isDark);
  const [hoursOpen, setHoursOpen] = useState(false);

  const heatmapRef = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(18);

  useLayoutEffect(() => {
    const el = heatmapRef.current;
    if (!el) return;
    // each week column = cellSize(11) + gap(3) = 14px, last column has no trailing gap
    // total width = N*14 - 3 → N = floor((w + 3) / 14)
    const update = (w: number) => {
      setWeeks(Math.max(4, Math.floor((w + 3) / 14)));
    };
    update(el.offsetWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Tapping anywhere on the card marks today (the main action); details open via "›".
  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hours) setHoursOpen(true);
    else toggleHabitDay(habit, todayStr);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileTap={readOnly ? undefined : { scale: 0.98 }}
      onClick={readOnly ? undefined : handleCheck}
      className={`bg-tg-section rounded-2xl p-4 transition-opacity ${
        readOnly ? '' : 'cursor-pointer active:opacity-80'
      }`}
    >
      <div className="flex gap-3">
        {/* Heatmap — takes all available space */}
        <div ref={heatmapRef} className="flex-1 min-w-0 overflow-hidden">
          <MiniHeatmap
            entries={heatEntries}
            color={habit.color}
            binary={habit.binary}
            weeks={weeks}
            showDayLabels={false}
          />
        </div>

        {/* Right column — width adapts to habit name (min 56px, max ~160px) */}
        <div className="shrink-0 flex flex-col justify-between items-start min-w-14 max-w-[160px] w-fit">
          {/* Checkbox + emoji icon */}
          <div className="flex items-center gap-2">
            <button
              onClick={readOnly ? undefined : handleCheck}
              disabled={readOnly}
              aria-label={isDoneToday ? `${habit.name}: снять отметку` : `${habit.name}: отметить сегодня`}
              className={`${hours && isDoneToday ? 'px-2 min-w-10' : 'w-10'} h-10 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0`}
              style={{
                backgroundColor: isDoneToday ? habit.color : 'transparent',
                border: isDoneToday ? 'none' : `2px solid ${habit.color}`,
              }}
            >
              {hours && isDoneToday && (
                <span className="text-xs font-bold whitespace-nowrap" style={{ color: onColor }}>{formatHours(todayEntry!.value)}</span>
              )}
              {!hours && isDoneToday && (
                <Check size={16} color={onColor} strokeWidth={2.5} aria-hidden />
              )}
            </button>
            {habit.icon && (
              <span className="text-xl leading-none" aria-hidden="true">{habit.icon}</span>
            )}
            {!readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('habit', { selectedHabitId: habit.id });
                }}
                aria-label={`Открыть «${habit.name}»`}
                className="w-10 h-10 -mr-2 flex items-center justify-center text-tg-hint"
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            )}
          </div>

          {/* Name */}
          <span className="font-semibold text-tg-text text-lg leading-tight break-words line-clamp-2 w-full">
            {habit.name}
          </span>

          {/* Weekly goal → this week's progress; daily habit → streak */}
          {habit.weeklyTarget ? (
            <div className="text-xs font-medium" style={{ color: textColor }}>
              {weekDone} из {habit.weeklyTarget} за неделю
            </div>
          ) : current > 0 ? (
            <div className="flex items-center gap-0.5 text-xs font-medium" style={{ color: textColor }}>
              <span className="sr-only">Серия дней подряд:</span>
              <Flame size={11} fill="currentColor" strokeWidth={1.5} aria-hidden />
              {current}
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>

      {hours && (
        <HoursSheet
          date={hoursOpen ? todayStr : null}
          title={habit.name}
          minutes={todayEntry?.value ?? 0}
          color={habit.color}
          onClose={() => setHoursOpen(false)}
          onSave={(m) => setHabitValue(habit, todayStr, m)}
        />
      )}
    </motion.div>
  );
});
