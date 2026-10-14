import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Pause } from 'lucide-react';
import { haptic } from '../hooks/useTelegramButtons';
import { readableOn } from '../utils/colors';
import { formatHours, isCountHabit, isDoneValue, isHoursHabit, isSkippedOn, pluralDays, weekProgress } from '../utils/habits';
import { challengeProgress, streaks } from '../utils/habitStats';
import { ChallengeBar } from './ChallengeCelebration';
import { countTarget } from '../utils/habitActions';
import type { Habit } from '../types';

interface TileProps {
  habit: Habit;
  date: string;
  onTap: (habit: Habit) => void;
  onOpen: (id: number) => void;
  /** Long press: actions sheet (open / skip / unmark). Without it a long press opens the habit. */
  onMenu?: (habit: Habit) => void;
}

export const HabitTile = memo(function HabitTile({ habit, date, onTap, onOpen, onMenu }: TileProps) {
  const entry = habit.entries.find((e) => e.date === date && e.value > 0);
  const done = !!entry && isDoneValue(habit, entry.value);
  // A pass for the day (ill / vacation): muted tile with ⏸, the streak is kept.
  const skipped = !entry && isSkippedOn(habit, date);
  const hours = isHoursHabit(habit);
  const count = isCountHabit(habit);
  const countValue = count ? (entry?.value ?? 0) : 0;
  const target = count ? countTarget(habit) : 1;
  const week = weekProgress(habit, date);
  // On a filled tile the ink is black or white by the habit colour's brightness (white on yellow is unreadable).
  const ink = done ? readableOn(habit.color) : 'var(--tg-theme-text-color)';
  // Daily habits show the run of days; weekly-goal ones already show "N из M в нед.".
  const streak = useMemo(
    () => (habit.weeklyTarget ? 0 : streaks(habit).current),
    [habit, date],
  );
  const challenge = useMemo(() => challengeProgress(habit, date), [habit, date]);
  const label =
    `${habit.name}: ` +
    (skipped
      ? 'пропуск, серия сохранится'
      : count
      ? `${countValue} из ${target}${done ? ', выполнено' : '. Нажми, чтобы добавить 1'}`
      : done
        ? 'отмечено'
        : 'не отмечено') +
    (hours && done ? `, ${formatHours(entry!.value)}` : '') +
    (challenge ? `. Челлендж: ${challenge.done} из ${challenge.total}` : `. На этой неделе ${week.done} из ${week.needed}`) +
    (streak >= 2 ? `. Серия ${pluralDays(streak)}` : '');

  // Long press (450 ms, cancelled by moving the finger) opens the actions sheet (or the habit);
  // the tap that ends it doesn't mark.
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
            if (onMenu) onMenu(habit);
            else onOpen(habit.id);
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
        aria-pressed={count ? undefined : done}
        aria-label={label}
        className="w-full aspect-square rounded-2xl p-3 flex flex-col justify-between text-left transition-colors duration-200 select-none [-webkit-touch-callout:none]"
        style={{
          backgroundColor: done ? habit.color : 'var(--tg-theme-section-bg-color)',
          color: ink,
          boxShadow: done
            ? undefined
            : skipped
              ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--tg-theme-hint-color) 35%, transparent)'
              : `inset 0 0 0 1.5px ${habit.color}55`,
          opacity: skipped ? 0.7 : undefined,
        }}
      >
        <span className="flex items-center gap-1.5 pr-6" aria-hidden>
          {count ? (
            <ProgressRing value={countValue} target={target} color={done ? ink : habit.color}>
              {habit.icon ?? '•'}
            </ProgressRing>
          ) : (
            <span className="text-2xl leading-none" style={skipped ? { filter: 'grayscale(1)' } : undefined}>
              {habit.icon ?? '•'}
            </span>
          )}
          {streak >= 2 && <span className="text-xs font-semibold whitespace-nowrap">🔥 {streak}</span>}
        </span>
        <span aria-hidden>
          {count && (
            <span className="block font-display text-base leading-tight tabular-nums">
              {countValue}
              <span style={{ opacity: 0.7 }}> из {target}</span>
            </span>
          )}
          {hours && done && <span className="block font-display text-base leading-tight">{formatHours(entry!.value)}</span>}
          <span className="block text-sm font-medium leading-tight line-clamp-2">{habit.name}</span>
          {/* This week at a glance: "2 из 3" for weekly goals, seven day dots for daily habits */}
          {skipped ? (
            <span className="flex items-center gap-1 text-xs mt-1 whitespace-nowrap text-tg-hint">
              <Pause size={12} aria-hidden /> пропуск
            </span>
          ) : challenge ? (
            // Challenge: «12/30» and a thin bar instead of the week dots.
            <span className="block mt-1">
              <span className="block text-xs font-semibold tabular-nums whitespace-nowrap" style={{ opacity: 0.9 }}>
                {challenge.succeeded ? '🏆 ' : ''}
                {challenge.done}/{challenge.total}
              </span>
              <ChallengeBar done={challenge.done} total={challenge.total} color={done ? ink : habit.color} className="mt-1" />
            </span>
          ) : habit.weeklyTarget ? (
            <span className="block text-xs mt-1 whitespace-nowrap" style={{ opacity: 0.85 }}>
              {week.done} из {week.needed} в нед.
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
                      : d.skipped
                        ? // Skipped day: a dashed ring — kept apart from both done and missed.
                          { border: '1px dashed currentColor', opacity: 0.6 }
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

/** Arc around the icon: how much of a count habit's daily target is done. */
function ProgressRing({ value, target, color, children }: { value: number; target: number; color: string; children: ReactNode }) {
  const size = 38;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, value / target);
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          style={{ transition: 'stroke-dashoffset 250ms ease-out' }}
        />
      </svg>
      <span className="text-lg leading-none">{children}</span>
    </span>
  );
}
