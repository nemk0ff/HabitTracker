import { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getMonthGrid,
  toDateString,
  formatMonthYear,
  WEEKDAY_LABELS,
  isToday,
} from '../utils/dates';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  getHeatmapColor,
  getEmptyColor,
  readableOnBlend,
  contrastRatio,
  useIsDark,
  HEATMAP_ALPHA,
} from '../utils/colors';
import type { HabitEntry } from '../types';

const DEFAULT_LEVEL_LABELS = ['легко', 'средне', 'тяжело'];

interface Props {
  entries: HabitEntry[];
  color: string;
  binary?: boolean;
  onToggle?: (date: string, value: number) => void;
  /** Select mode: a tap reports the day instead of cycling its intensity. */
  onSelect?: (date: string) => void;
  selectedDate?: string;
  /** Screen-reader names for levels 1–3 (default: легко / средне / тяжело). */
  levelLabels?: string[];
}

export function Heatmap({ entries, color, binary = false, onToggle, onSelect, selectedDate, levelLabels = DEFAULT_LEVEL_LABELS }: Props) {
  const today = new Date();
  const initial = selectedDate ? new Date(selectedDate + 'T00:00:00') : today;
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [direction, setDirection] = useState(0);

  const entryMap = useMemo(() => new Map(entries.map((e) => [e.date, e.value])), [entries]);
  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);
  const monthDate = new Date(year, month);

  const isDark = useIsDark();
  // Today's ring on an empty cell: the habit colour if it's visible on the surface (≥3:1),
  // otherwise the text colour (e.g. yellow on white).
  const emptyRing = contrastRatio(color, isDark ? '#212121' : '#ffffff') >= 3 ? color : 'var(--tg-theme-text-color)';

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
    if (onSelect) {
      onSelect(dateStr);
      window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
      return;
    }
    const current = entryMap.get(dateStr) ?? 0;
    const next = binary ? (current > 0 ? 0 : 1) : (current >= 3 ? 0 : current + 1);
    onToggle?.(dateStr, next);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  const isFutureMonth = new Date(year, month) > today;

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4 px-1">
        <button
          onClick={goPrev}
          aria-label="Предыдущий месяц"
          className="w-11 h-11 flex items-center justify-center rounded-xl active:bg-tg-secondary transition-colors"
        >
          <ChevronLeft size={20} strokeWidth={2} aria-hidden />
        </button>

        <span className="text-base font-semibold text-tg-text capitalize" aria-live="polite">
          {formatMonthYear(monthDate)}
        </span>

        <button
          onClick={goNext}
          disabled={isFutureMonth}
          aria-label="Следующий месяц"
          className="w-11 h-11 flex items-center justify-center rounded-xl active:bg-tg-secondary transition-colors disabled:opacity-30"
        >
          <ChevronRight size={20} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs font-medium text-tg-hint">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0, x: direction * 40 }}
          animate={{ opacity: 1 }}
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
                const level = value > 0 ? (binary ? 3 : Math.min(value, 3)) : 0;
                const bg = level > 0 ? getHeatmapColor(color, level) : getEmptyColor();
                const ink = level > 0 ? readableOnBlend(color, HEATMAP_ALPHA[level] ?? 1, isDark) : undefined;
                const isSelected = selectedDate === dateStr;
                const state =
                  value <= 0
                    ? 'не отмечено'
                    : binary
                      ? 'выполнено'
                      : (levelLabels[Math.min(value, 3) - 1] ?? 'отмечено');
                const label = `${format(day, 'd MMMM', { locale: ru })}${isTodayCell ? ', сегодня' : ''}: ${state}`;

                return (
                  <motion.button
                    key={dateStr}
                    whileTap={isFuture ? {} : { scale: 0.85 }}
                    onClick={() => !isFuture && handleCellTap(dateStr)}
                    disabled={isFuture}
                    aria-label={label}
                    aria-current={isTodayCell ? 'date' : undefined}
                    aria-pressed={onSelect && selectedDate !== undefined ? isSelected : undefined}
                    className="aspect-square rounded-lg flex items-center justify-center text-xs font-medium transition-colors disabled:opacity-30 relative focus-ring"
                    style={{ backgroundColor: bg }}
                  >
                    {isSelected && (
                      <div
                        className="absolute -inset-[3px] rounded-[10px] pointer-events-none"
                        style={{ boxShadow: '0 0 0 2px var(--tg-theme-text-color)' }}
                      />
                    )}
                    {isTodayCell && (
                      <div
                        className="absolute inset-0 rounded-lg pointer-events-none"
                        style={{ boxShadow: `inset 0 0 0 ${level > 0 ? 2 : 1.5}px ${ink ?? emptyRing}` }}
                      />
                    )}
                    <span
                      className={`relative z-10 ${isTodayCell ? 'font-bold' : ''}`}
                      style={{ color: ink }}
                      aria-hidden="true"
                    >
                      {day.getDate()}
                    </span>
                    {/* Non-colour cue for intensity: 1–3 dots under the digit. */}
                    {!binary && level > 0 && (
                      <span className="absolute bottom-[3px] left-0 right-0 flex justify-center gap-[2px] pointer-events-none" aria-hidden="true">
                        {Array.from({ length: level }, (_, i) => (
                          <span key={i} className="w-[3px] h-[3px] rounded-full" style={{ backgroundColor: ink }} />
                        ))}
                      </span>
                    )}
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
