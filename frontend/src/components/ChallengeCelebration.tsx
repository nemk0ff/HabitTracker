import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import { BottomSheet } from './nutrition/BottomSheet';
import { useHabitsStore } from '../stores/habitsStore';
import { useAuthStore } from '../stores/authStore';
import { useToday } from '../hooks/useToday';
import { haptic } from '../hooks/useTelegramButtons';
import { challengeProgress } from '../utils/habitStats';
import { pluralDays } from '../utils/habits';
import { readableOn } from '../utils/colors';
import { shareHabitProgress } from '../utils/shareCard';
import type { Habit } from '../types';

function celebratedKey(h: Pick<Habit, 'id' | 'challengeStart' | 'challengeDays'>): string {
  return `challenge-celebrated:${useAuthStore.getState().user?.id ?? 'anon'}:${h.id}:${h.challengeStart}:${h.challengeDays}`;
}

function wasCelebrated(h: Habit): boolean {
  try {
    return localStorage.getItem(celebratedKey(h)) === '1';
  } catch {
    // No storage: celebrate at most once per session (see `shownThisSession`).
    return false;
  }
}

function markCelebrated(h: Habit) {
  try {
    localStorage.setItem(celebratedKey(h), '1');
  } catch {
    /* private mode */
  }
}

const shownThisSession = new Set<string>();

/**
 * One-time «Челлендж пройден!» sheet: pops up (on any screen) once a challenge habit reaches its
 * goal, offers to share the card and to keep the habit going without the challenge.
 */
export function ChallengeCelebration() {
  const habits = useHabitsStore((s) => s.habits);
  const editHabit = useHabitsStore((s) => s.editHabit);
  const today = useToday();
  const [habitId, setHabitId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'share' | 'continue' | null>(null);

  const finished = useMemo(
    () =>
      habits.find((h) => {
        if (h.archived || !challengeProgress(h, today)?.succeeded) return false;
        const key = celebratedKey(h);
        return !shownThisSession.has(key) && !wasCelebrated(h);
      }) ?? null,
    [habits, today],
  );

  useEffect(() => {
    if (!finished || habitId !== null) return;
    setHabitId(finished.id);
  }, [finished, habitId]);

  // Open a beat later so the mark's own toast / haptic lands first — and only if the challenge is still
  // passed by then (the mark may have been undone or rolled back); it counts as celebrated only once shown.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (habitId === null || open) return;
    const t = setTimeout(() => {
      const h = useHabitsStore.getState().habits.find((x) => x.id === habitId);
      if (!h || h.archived || !challengeProgress(h, today)?.succeeded) {
        setHabitId(null);
        return;
      }
      shownThisSession.add(celebratedKey(h));
      markCelebrated(h);
      haptic('success');
      setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [habitId, open, today]);

  const habit = habits.find((h) => h.id === habitId) ?? null;
  const progress = habit ? challengeProgress(habit, today) : null;
  const close = () => {
    setOpen(false);
    setHabitId(null);
  };

  const share = async () => {
    if (!habit || busy) return;
    setBusy('share');
    await shareHabitProgress(habit);
    setBusy(null);
  };

  const keepGoing = async () => {
    if (!habit || busy) return;
    setBusy('continue');
    const ok = await editHabit(habit.id, { challengeDays: null, challengeStart: null });
    setBusy(null);
    if (ok) {
      haptic('success');
      close();
    }
  };

  return (
    <BottomSheet open={open && habit !== null} onClose={close} label="Челлендж пройден">
      {habit && (
        <div className="flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 11, stiffness: 180, delay: 0.15 }}
            className="w-28 h-28 rounded-[32px] flex items-center justify-center text-6xl mb-4"
            style={{ backgroundColor: `${habit.color}2a` }}
            aria-hidden
          >
            {habit.icon || '🏆'}
          </motion.div>
          <h2 className="font-display text-2xl text-tg-text leading-tight">Челлендж пройден!</h2>
          <p className="text-base text-tg-text mt-2 break-words">«{habit.name}»</p>
          {progress && (
            <p className="text-sm text-tg-hint mt-1">
              Отмечено {pluralDays(progress.total)} — получилось 🎉
            </p>
          )}
          <div className="w-full flex flex-col gap-2 mt-6">
            <button
              type="button"
              onClick={() => void share()}
              disabled={busy !== null}
              className="w-full min-h-[52px] rounded-xl font-semibold text-base flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-60"
              style={{ backgroundColor: habit.color, color: readableOn(habit.color) }}
            >
              <Share2 size={18} aria-hidden />
              {busy === 'share' ? 'Готовлю картинку…' : 'Поделиться'}
            </button>
            <button
              type="button"
              onClick={() => void keepGoing()}
              disabled={busy !== null}
              className="w-full min-h-[52px] rounded-xl font-semibold text-base bg-tg-section text-tg-text active:opacity-70 disabled:opacity-60"
            >
              {busy === 'continue' ? 'Сохраняю…' : 'Продолжить как привычку'}
            </button>
            <button type="button" onClick={close} className="w-full min-h-[44px] text-sm text-tg-hint active:opacity-70">
              Закрыть
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/** Thin progress bar of a challenge (tile, card, detail). */
export function ChallengeBar({ done, total, color, className = '' }: { done: number; total: number; color: string; className?: string }) {
  return (
    <span
      className={`block h-[4px] rounded-full overflow-hidden ${className}`}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` }}
      aria-hidden
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, (done / total) * 100)}%`, backgroundColor: color, transition: 'width 250ms ease-out' }}
      />
    </span>
  );
}
