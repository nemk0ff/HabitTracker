import { useRef, useState, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import { MiniHeatmap } from './MiniHeatmap';
import { calculateStreak, toDateString } from '../utils/dates';
import { useHabitsStore } from '../stores/habitsStore';
import type { Habit } from '../types';

interface Props {
  habit: Habit;
}

export function HabitCard({ habit }: Props) {
  const { navigate, toggleEntry } = useHabitsStore();
  const { current } = calculateStreak(habit.entries);
  const todayStr = toDateString(new Date());
  const todayEntry = habit.entries.find((e) => e.date === todayStr);
  const isDoneToday = todayEntry && todayEntry.value > 0;

  const heatmapRef = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(18);

  useLayoutEffect(() => {
    if (!heatmapRef.current) return;
    const w = heatmapRef.current.offsetWidth;
    // each week column = cellSize(11) + gap(3) = 14px, last column has no trailing gap
    // total width = N*14 - 3 → N = floor((w + 3) / 14)
    setWeeks(Math.max(4, Math.floor((w + 3) / 14)));
  }, []);

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newValue = isDoneToday ? 0 : 1;
    toggleEntry(habit.id, todayStr, newValue);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate('habit', habit.id)}
      className="bg-tg-section rounded-2xl p-4 cursor-pointer active:opacity-80 transition-opacity"
    >
      <div className="flex gap-3">
        {/* Heatmap — takes all available space */}
        <div ref={heatmapRef} className="flex-1 min-w-0 overflow-hidden">
          <MiniHeatmap
            entries={habit.entries}
            color={habit.color}
            binary={habit.binary}
            weeks={weeks}
            showDayLabels={false}
          />
        </div>

        {/* Right column — fixed width, anchored to right edge */}
        <div className="w-14 shrink-0 flex flex-col justify-between items-start">
          {/* Checkbox */}
          <button
            onClick={handleCheck}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{
              backgroundColor: isDoneToday ? habit.color : 'transparent',
              border: isDoneToday ? 'none' : `2px solid ${habit.color}`,
            }}
          >
            {isDoneToday && (
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

          {/* Icon + name */}
          <div className="w-full min-w-0">
            {habit.icon && (
              <span className="text-base leading-none block mb-0.5">{habit.icon}</span>
            )}
            <span className="font-semibold text-tg-text text-xs leading-tight truncate block">
              {habit.name}
            </span>
          </div>

          {/* Streak */}
          {current > 0 ? (
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
    </motion.div>
  );
}
