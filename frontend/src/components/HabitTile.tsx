import { memo, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { haptic } from '../hooks/useTelegramButtons';
import { calculateStreak } from '../utils/dates';
import { readableOn } from '../utils/colors';
import { formatHours, isHoursHabit, pluralDays, weekProgress } from '../utils/habits';
import type { Habit } from '../types';

interface TileProps {
  habit: Habit;
  date: string;
  onTap: (habit: Habit) => void;
  onOpen: (id: number) => void;
}

export const HabitTile = memo(function HabitTile({ habit, date, onTap, onOpen }: TileProps) {
  const entry = habit.entries.find((e) => e.date === date && e.value > 0);
  const done = !!entry;
  const hours = isHoursHabit(habit);
  const week = weekProgress(habit, date);
  // On a filled tile the ink is black or white by the habit colour's brightness (white on yellow is unreadable).
  const ink = done ? readableOn(habit.color) : 'var(--tg-theme-text-color)';
  const weekTarget = habit.weeklyTarget ? week.target : 7;
  // Daily habits show the run of days; weekly-goal ones already show "N из M в нед.".
  const streak = useMemo(() => (habit.weeklyTarget ? 0 : calculateStreak(habit.entries).current), [habit, date]);
  const label =
    `${habit.name}: ${done ? 'отмечено' : 'не отмечено'}` +
    (hours && done ? `, ${formatHours(entry!.value)}` : '') +
    `. На этой неделе ${week.done} из ${weekTarget}` +
    (streak >= 2 ? `. Серия ${pluralDays(streak)}` : '');

  // Long press (450 ms, cancelled by moving the finger) opens the habit; the tap that ends it doesn't mark.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };
  useEffect(() => cancelPress, []);

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onPointerDown={(e) => {
          longPressed.current = false;
          pressStart.current = { x: e.clientX, y: e.clientY };
          if (pressTimer.current) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            longPressed.current = true;
            haptic('medium');
            onOpen(habit.id);
          }, 450);
        }}
        onPointerMove={(e) => {
          const s = pressStart.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onTap(habit);
        }}
        aria-pressed={done}
        aria-label={label}
        className="w-full aspect-square rounded-2xl p-3 flex flex-col justify-between text-left transition-colors duration-200 select-none [-webkit-touch-callout:none]"
        style={{
          backgroundColor: done ? habit.color : 'var(--tg-theme-section-bg-color)',
          color: ink,
          boxShadow: done ? undefined : `inset 0 0 0 1.5px ${habit.color}55`,
        }}
      >
        <span className="flex items-center gap-1.5 pr-6" aria-hidden>
          <span className="text-2xl leading-none">{habit.icon ?? '•'}</span>
          {streak >= 2 && <span className="text-xs font-semibold whitespace-nowrap">🔥 {streak}</span>}
        </span>
        <span aria-hidden>
          {hours && done && <span className="block font-display text-base leading-tight">{formatHours(entry!.value)}</span>}
          <span className="block text-sm font-medium leading-tight line-clamp-2">{habit.name}</span>
          {/* This week at a glance: "2 из 3" for weekly goals, seven day dots for daily habits */}
          {habit.weeklyTarget ? (
            <span className="block text-xs mt-1 whitespace-nowrap" style={{ opacity: 0.85 }}>
              {week.done} из {week.target} в нед.
            </span>
          ) : (
            <span className="flex gap-[3px] mt-1.5">
              {week.days.map((d) => (
                <span
                  key={d.date}
                  className="w-[7px] h-[7px] rounded-full"
                  style={
                    d.done
                      ? { backgroundColor: done ? ink : habit.color }
                      : // Empty day: an outline ring (not a faint fill), dimmer for days still ahead.
                        { boxShadow: `inset 0 0 0 ${d.future ? 1 : 1.5}px currentColor`, opacity: d.future ? 0.7 : 0.85 }
                  }
                />
              ))}
            </span>
          )}
        </span>
      </motion.button>
      <button
        onClick={() => onOpen(habit.id)}
        aria-label={`Открыть «${habit.name}»`}
        className="absolute top-0 right-0 w-9 h-9 flex items-center justify-center"
        style={{ color: done ? ink : 'var(--tg-theme-hint-color)', opacity: 0.75 }}
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
});
