import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getMonthGrid,
  toDateString,
  formatMonthYear,
  WEEKDAY_LABELS,
  isToday,
} from '../utils/dates';
import { getHeatmapColor, getEmptyColor } from '../utils/colors';
import type { HabitEntry } from '../types';

interface Props {
  entries: HabitEntry[];
  color: string;
  binary?: boolean;
  onToggle: (date: string, value: number) => void;
}

export function Heatmap({ entries, color, binary = false, onToggle }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [direction, setDirection] = useState(0);

  const entryMap = new Map(entries.map((e) => [e.date, e.value]));
  const grid = getMonthGrid(year, month);
  const monthDate = new Date(year, month);

  const isDark =
    typeof window !== 'undefined' &&
    window.Telegram?.WebApp?.colorScheme === 'dark';

  const goPrev = useCallback(() => {
    setDirection(-1);
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const goNext = useCallback(() => {
    setDirection(1);
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const handleCellTap = (dateStr: string) => {
    const current = entryMap.get(dateStr) ?? 0;
    const next = binary ? (current > 0 ? 0 : 1) : (current >= 3 ? 0 : current + 1);
    onToggle(dateStr, next);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  const isFutureMonth = new Date(year, month) > today;

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4 px-1">
        <button
          onClick={goPrev}
          className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span className="text-base font-semibold text-tg-text capitalize">
          {formatMonthYear(monthDate)}
        </span>

        <button
          onClick={goNext}
          disabled={isFutureMonth}
          className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary transition-colors disabled:opacity-30"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-[11px] font-medium text-tg-hint">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0, x: direction * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -40 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-[5px]"
        >
          {grid.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-[5px]">
              {week.map((day, di) => {
                if (!day) {
                  return <div key={`empty-${di}`} className="aspect-square" />;
                }

                const dateStr = toDateString(day);
                const value = entryMap.get(dateStr) ?? 0;
                const isTodayCell = isToday(day);
                const isFuture = day > today;
                const bg = value > 0 ? getHeatmapColor(color, binary ? 3 : value) : getEmptyColor(!!isDark);

                return (
                  <motion.button
                    key={dateStr}
                    whileTap={isFuture ? {} : { scale: 0.85 }}
                    onClick={() => !isFuture && handleCellTap(dateStr)}
                    disabled={isFuture}
                    className="aspect-square rounded-lg flex items-center justify-center text-[11px] font-medium transition-colors disabled:opacity-30 relative"
                    style={{ backgroundColor: bg }}
                  >
                    {isTodayCell && (
                      <div
                        className="absolute inset-0 rounded-lg pointer-events-none"
                        style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}
                      />
                    )}
                    <span
                      className="relative z-10"
                      style={{
                        color: (binary ? value > 0 : value >= 2) ? '#fff' : undefined,
                      }}
                    >
                      {day.getDate()}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
