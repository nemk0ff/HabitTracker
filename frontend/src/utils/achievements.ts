import { differenceInCalendarDays, parseISO } from 'date-fns';
import { shiftDate, toDateString } from './dates';
import { doneEntries, isDayClosed, isDoneValue, RETURN_BREAK_DAYS } from './habits';
import { challengeProgress, streaks } from './habitStats';
import { postAchievement } from '../api/me';
import { useAuthStore } from '../stores/authStore';
import type { Habit } from '../types';

/**
 * Badges computed purely from the loaded habits (the last 18 weeks of entries). Earned keys are
 * also remembered in localStorage, so a badge stays on the shelf after the data that earned it
 * changes (an undone mark, a finished challenge turned into a plain habit).
 */
export interface Achievement {
  key: string;
  icon: string;
  title: string;
  /** How to get it — shown on a locked badge. */
  hint: string;
  earned: (ctx: Ctx) => boolean;
}

interface Ctx {
  habits: Habit[];
  today: string;
}

function anyBestStreak(habits: Habit[], n: number): boolean {
  return habits.some((h) => streaks(h).best >= n);
}

function totalMarks(habits: Habit[]): number {
  return habits.reduce((sum, h) => sum + doneEntries(h).length, 0);
}

/** Closed days (every habit marked or skipped) within the loaded 18 weeks. */
function closedDays(habits: Habit[], today: string, need: number): boolean {
  let n = 0;
  for (let i = 0; i < 18 * 7; i++) {
    if (isDayClosed(habits, shiftDate(today, -i)) && ++n >= need) return true;
  }
  return false;
}

/** A done mark right after ≥3 days without any mark or skip — same break as `isReturningUser`. */
function cameBack(habits: Habit[]): boolean {
  const activity = new Set<string>();
  const done = new Set<string>();
  for (const h of habits) {
    for (const e of h.entries) {
      if (e.skipped) activity.add(e.date);
      else if (isDoneValue(h, e.value)) {
        activity.add(e.date);
        done.add(e.date);
      }
    }
  }
  const dates = [...activity].sort();
  for (let i = 1; i < dates.length; i++) {
    const gap = differenceInCalendarDays(parseISO(dates[i]!), parseISO(dates[i - 1]!));
    if (gap >= RETURN_BREAK_DAYS && done.has(dates[i]!)) return true;
  }
  return false;
}

/** 3 habits, each first marked a week or more ago and still marked within the last 7 days. */
function threeForAWeek(habits: Habit[], today: string): boolean {
  const weekAgo = shiftDate(today, -6);
  const kept = habits.filter((h) => {
    const dates = doneEntries(h).map((e) => e.date).sort();
    return dates.length > 0 && dates[0]! <= weekAgo && dates[dates.length - 1]! >= weekAgo;
  });
  return kept.length >= 3;
}

export const ACHIEVEMENTS: Achievement[] = [
  { key: 'first_mark', icon: '✅', title: 'Первая отметка', hint: 'Отметь любую привычку', earned: ({ habits }) => totalMarks(habits) > 0 },
  { key: 'streak_7', icon: '🔥', title: '7 дней подряд', hint: 'Неделя без перерыва в одной привычке', earned: ({ habits }) => anyBestStreak(habits, 7) },
  { key: 'streak_30', icon: '🏆', title: '30 дней подряд', hint: 'Месяц без перерыва в одной привычке', earned: ({ habits }) => anyBestStreak(habits, 30) },
  { key: 'marks_100', icon: '💯', title: '100 отметок', hint: 'Сотня отметок по всем привычкам', earned: ({ habits }) => totalMarks(habits) >= 100 },
  {
    key: 'first_challenge',
    icon: '🎯',
    title: 'Первый челлендж',
    hint: 'Пройди челлендж до конца',
    earned: ({ habits, today }) => habits.some((h) => challengeProgress(h, today)?.succeeded),
  },
  { key: 'closed_7', icon: '🌙', title: '7 закрытых дней', hint: 'Отметь всё за день — 7 раз', earned: ({ habits, today }) => closedDays(habits, today, 7) },
  { key: 'comeback', icon: '💪', title: 'Снова в деле', hint: 'Вернись после перерыва в 3 дня', earned: ({ habits }) => cameBack(habits) },
  { key: 'three_week', icon: '🌱', title: 'Три привычки', hint: 'Веди 3 привычки хотя бы неделю', earned: ({ habits, today }) => threeForAWeek(habits, today) },
];

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function achievementByKey(key: string): Achievement | undefined {
  return BY_KEY.get(key);
}

/** Keys earned by the current data (not counting the remembered ones). Archived habits count too. */
export function computeEarned(habits: Habit[], today = toDateString(new Date())): Set<string> {
  const ctx = { habits, today };
  return new Set(ACHIEVEMENTS.filter((a) => a.earned(ctx)).map((a) => a.key));
}

// ─── Remembered (localStorage, per user) ─────────────────────────────────────

function storageKey(): string {
  return `achievements:${useAuthStore.getState().user?.id ?? 'anon'}`;
}

export function rememberedEarned(): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey());
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function remember(keys: Set<string>) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...keys]));
  } catch {
    /* private mode: the shelf just recomputes */
  }
}

/**
 * Records keys earned now that weren't remembered yet: stores them, reports each to the backend
 * once, and returns them (the caller toasts). `before` excludes keys the user already had in the
 * data before this action, so opening the app with old progress doesn't toast.
 */
export function unlockNew(before: Set<string>, after: Set<string>): Achievement[] {
  const known = rememberedEarned();
  const fresh: Achievement[] = [];
  let changed = false;
  for (const key of after) {
    if (known.has(key)) continue;
    known.add(key);
    changed = true;
    void postAchievement(key).catch(() => {});
    const a = BY_KEY.get(key);
    if (a && !before.has(key)) fresh.push(a);
  }
  if (changed) remember(known);
  return fresh;
}
