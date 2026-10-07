import { useRef, useState, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import { MiniHeatmap } from './MiniHeatmap';
import { calculateStreak, toDateString } from '../utils/dates';
import { useNavStore } from '../stores/navStore';
import { HoursSheet } from './HoursSheet';
import { formatHours, isHoursHabit, levelEntries, weekProgress } from '../utils/habits';
import { ChevronRight } from 'lucide-react';
import { setHabitValue, toggleHabitDay } from '../utils/habitActions';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
  readOnly?: boolean;
}

export function HabitCard({ habit, readOnly = false }: Props) {
  const navigate = useNavStore((s) => s.navigate);
  const { current } = calculateStreak(habit.entries);
  const todayStr = toDateString(new Date());
  const todayEntry = habit.entries.find((e) => e.date === todayStr);
  const isDoneToday = todayEntry && todayEntry.value > 0;

  const hours = isHoursHabit(habit);
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
            entries={levelEntries(habit)}
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
                <span className="text-xs font-bold text-white whitespace-nowrap">{formatHours(todayEntry!.value)}</span>
              )}
              {!hours && isDoneToday && (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path
                    d="M4 9.5L7.5 13L14 5"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            {habit.icon && (
              <span className="text-xl leading-none">{habit.icon}</span>
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
            <div className="text-xs font-medium" style={{ color: habit.color }}>
              {weekProgress(habit, toDateString(new Date())).done} из {habit.weeklyTarget} за неделю
            </div>
          ) : current > 0 ? (
            <div className="flex items-center gap-0.5 text-xs font-medium" style={{ color: habit.color }}>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 0.5C7 0.5 8.5 3 8.5 5C8.5 5.8 8.2 6.5 7.7 7C8.8 6.2 10 5 10 3.5C10 3.5 13 6 13 9.5C13 11.7 11.2 13.5 9 13.5C8.1 13.5 7.3 13.2 6.7 12.7C6.9 12.3 7 11.9 7 11.5C7 10.1 5.9 9 4.5 9C3.8 9 3.2 9.3 2.7 9.7C2 9.7 1 9 1 9.5C1 11.7 2.8 13.5 5 13.5C3.6 13.5 2.5 12.4 2.5 11C2.5 9.6 3.6 8.5 5 8.5C5 8.5 4 7.5 4 6C4 4 7 0.5 7 0.5Z" />
              </svg>
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
}
