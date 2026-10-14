import { toDateString } from './dates';
import type { TimeOfDay } from '../types';

/**
 * Ready-made habits for the first launch, the empty Today screen and the create form.
 * Colors come from HABIT_COLORS (text on them goes through readableOn).
 */
export interface HabitTemplate {
  key: string;
  name: string;
  icon: string;
  color: string;
  binary: boolean;
  /** 'hours' = entries store minutes (sleep); 'count' = how many vs dailyTarget; null = done / intensity. */
  measure: 'hours' | 'count' | null;
  /** null = every day; 1–6 = N times a week. */
  weeklyTarget: number | null;
  /** Section on Today; null = «В любое время». */
  timeOfDay: TimeOfDay | null;
  /** Count habits: how many per day is done. */
  dailyTarget: number | null;
  /** Challenge templates: done days to reach, starting the day it's created. */
  challengeDays?: number;
}

type Base = Omit<HabitTemplate, 'binary' | 'measure' | 'weeklyTarget' | 'timeOfDay' | 'dailyTarget'>;
const check = (t: Base, timeOfDay: TimeOfDay | null = null): HabitTemplate => ({
  ...t, binary: true, measure: null, weeklyTarget: null, timeOfDay, dailyTarget: null,
});
const count = (t: Base, dailyTarget: number, timeOfDay: TimeOfDay | null = null): HabitTemplate => ({
  ...t, binary: false, measure: 'count', weeklyTarget: null, timeOfDay, dailyTarget,
});

/** At most 12: the onboarding grid is 3 columns + «Своя привычка». */
export const HABIT_TEMPLATES: HabitTemplate[] = [
  count({ key: 'water', name: 'Вода', icon: '💧', color: '#2196F3' }, 8),
  check({ key: 'teeth', name: 'Чистить зубы', icon: '🪥', color: '#00BCD4' }, 'morning'),
  count({ key: 'pills', name: 'Таблетки/витамины', icon: '💊', color: '#FF9800' }, 2, 'morning'),
  check({ key: 'workout', name: 'Зарядка', icon: '🤸', color: '#FF5722' }, 'morning'),
  { key: 'sport', name: 'Спорт', icon: '💪', color: '#F44336', binary: false, measure: null, weeklyTarget: 3, timeOfDay: null, dailyTarget: null },
  { key: 'sleep', name: 'Сон', icon: '😴', color: '#3F51B5', binary: false, measure: 'hours', weeklyTarget: null, timeOfDay: 'morning', dailyTarget: null },
  check({ key: 'skincare', name: 'Скин-кэр', icon: '🧴', color: '#E91E63' }, 'evening'),
  check({ key: 'reading', name: 'Чтение', icon: '📚', color: '#9C27B0' }, 'evening'),
  check({ key: 'walk', name: 'Прогулка', icon: '🚶', color: '#4CAF50' }, 'day'),
  check({ key: 'nosugar', name: 'Без сладкого', icon: '🍬', color: '#8BC34A' }),
  check({ key: 'meditation', name: 'Медитация', icon: '🧘', color: '#607D8B' }, 'morning'),
  { key: 'english', name: 'Английский', icon: '🇬🇧', color: '#009688', binary: true, measure: null, weeklyTarget: 5, timeOfDay: null, dailyTarget: null },
];

/** Challenges: a goal with an end («30 дней без сахара»). Offered on the create form. */
export const CHALLENGE_TEMPLATES: HabitTemplate[] = [
  { ...check({ key: 'ch-nosugar', name: '30 дней без сахара', icon: '🍭', color: '#8BC34A' }), challengeDays: 30 },
  { ...check({ key: 'ch-workout', name: '21 день зарядки', icon: '🤸', color: '#FF5722' }, 'morning'), challengeDays: 21 },
  { ...check({ key: 'ch-nosocial', name: 'Утро без соцсетей', icon: '📵', color: '#607D8B' }, 'morning'), challengeDays: 30 },
  { ...check({ key: 'ch-steps', name: '10 000 шагов', icon: '👟', color: '#4CAF50' }, 'day'), challengeDays: 7 },
];

/** Challenge length presets on the form (days). 66 ≈ how long a habit takes to stick. */
export const CHALLENGE_PRESETS = [7, 21, 30, 66] as const;

/** Longest challenge (the backend enforces it too): GET /habits loads only 18 weeks of entries to count from. */
export const CHALLENGE_MAX_DAYS = 120;

/** Any challenge length the UI sends, clamped to 3..CHALLENGE_MAX_DAYS. */
export function clampChallengeDays(n: number): number {
  return Math.max(3, Math.min(CHALLENGE_MAX_DAYS, Math.round(n)));
}

/** Shown as one-tap chips on the empty Today screen. */
export const QUICK_TEMPLATE_KEYS = ['water', 'workout', 'reading'] as const;

/** Short caption for a template tile: "каждый день", "3 раза в неделю", "часы сна". */
export function templateHint(t: HabitTemplate): string {
  if (t.measure === 'hours') return 'часы';
  if (t.measure === 'count') return `${t.dailyTarget} в день`;
  if (t.weeklyTarget === null) return 'каждый день';
  const n = t.weeklyTarget;
  return `${n} ${n >= 2 && n <= 4 ? 'раза' : 'раз'} в неделю`;
}

/** Payload for useHabitsStore().addHabit. */
export function templateToHabit(t: HabitTemplate) {
  return {
    name: t.name,
    icon: t.icon,
    color: t.color,
    binary: t.binary,
    measure: t.measure,
    weeklyTarget: t.weeklyTarget,
    timeOfDay: t.timeOfDay,
    dailyTarget: t.dailyTarget,
    ...(t.challengeDays ? { challengeDays: t.challengeDays, challengeStart: toDateString(new Date()) } : {}),
  };
}
