/**
 * Ready-made habits for the first launch, the empty Today screen and the create form.
 * Colors come from HABIT_COLORS, picked from the darker half so white text stays readable.
 */
export interface HabitTemplate {
  key: string;
  name: string;
  icon: string;
  color: string;
  binary: boolean;
  /** 'hours' = entries store minutes (sleep); null = done / intensity. */
  measure: 'hours' | null;
  /** null = every day; 1–6 = N times a week. */
  weeklyTarget: number | null;
}

export const HABIT_TEMPLATES: HabitTemplate[] = [
  { key: 'water', name: 'Вода', icon: '💧', color: '#2196F3', binary: true, measure: null, weeklyTarget: null },
  { key: 'workout', name: 'Зарядка', icon: '🤸', color: '#FF5722', binary: true, measure: null, weeklyTarget: null },
  { key: 'sport', name: 'Спорт', icon: '💪', color: '#F44336', binary: false, measure: null, weeklyTarget: 3 },
  { key: 'sleep', name: 'Сон', icon: '😴', color: '#3F51B5', binary: false, measure: 'hours', weeklyTarget: null },
  { key: 'reading', name: 'Чтение', icon: '📚', color: '#9C27B0', binary: true, measure: null, weeklyTarget: null },
  { key: 'walk', name: 'Прогулка', icon: '🚶', color: '#4CAF50', binary: true, measure: null, weeklyTarget: null },
  { key: 'nosugar', name: 'Без сладкого', icon: '🍬', color: '#E91E63', binary: true, measure: null, weeklyTarget: null },
  { key: 'meditation', name: 'Медитация', icon: '🧘', color: '#607D8B', binary: true, measure: null, weeklyTarget: null },
  { key: 'english', name: 'Английский', icon: '🇬🇧', color: '#009688', binary: true, measure: null, weeklyTarget: 5 },
  { key: 'early', name: 'Рано лечь', icon: '🌙', color: '#673AB7', binary: true, measure: null, weeklyTarget: null },
];

/** Shown as one-tap chips on the empty Today screen. */
export const QUICK_TEMPLATE_KEYS = ['water', 'workout', 'reading'] as const;

/** Short caption for a template tile: "каждый день", "3 раза в неделю", "часы сна". */
export function templateHint(t: HabitTemplate): string {
  if (t.measure === 'hours') return 'часы';
  if (t.weeklyTarget === null) return 'каждый день';
  const n = t.weeklyTarget;
  return `${n} ${n >= 2 && n <= 4 ? 'раза' : 'раз'} в неделю`;
}

/** Payload for useHabitsStore().addHabit. */
export function templateToHabit(t: HabitTemplate) {
  return { name: t.name, icon: t.icon, color: t.color, binary: t.binary, measure: t.measure, weeklyTarget: t.weeklyTarget };
}
