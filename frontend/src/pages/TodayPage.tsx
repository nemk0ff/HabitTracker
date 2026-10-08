import { memo, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronRight, Plus, Utensils, Scale, NotebookText } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useNutritionStore } from '../stores/nutritionStore';
import { toast } from '../stores/toastStore';
import { HoursSheet } from '../components/HoursSheet';
import { WeightSheet } from '../components/nutrition/WeightSheet';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { useToday } from '../hooks/useToday';
import { capitalizeFirst } from '../utils/dates';
import { readableOn } from '../utils/colors';
import { MACRO_COLORS, fmt, mealByTime } from '../utils/nutrition';
import { formatHours, isHoursHabit, weekProgress } from '../utils/habits';
import { setHabitValue, toggleHabitDay } from '../utils/habitActions';
import { HABIT_TEMPLATES, QUICK_TEMPLATE_KEYS, templateToHabit, type HabitTemplate } from '../utils/habitTemplates';
import type { Habit } from '../types';

/**
 * Start screen: everything that is marked daily, without choosing a module first
 * (design review 07.10: habits got 2 marks per 36 opens behind the old hub).
 */
export function TodayPage() {
  const nutrition = useAuthStore((s) => !!s.user?.features?.nutrition);
  const habits = useHabitsStore((s) => s.habits);
  const navigate = useNavStore((s) => s.navigate);
  const today = useToday();
  const day = useNutritionStore((s) => s.days[today]);
  const plan = useNutritionStore((s) => s.plans[today]);
  const { loadDay, loadPlan, saveWeight } = useNutritionStore(
    useShallow((s) => ({ loadDay: s.loadDay, loadPlan: s.loadPlan, saveWeight: s.saveWeight })),
  );

  // Keep the id, not the object: the sheet must see the live entries after each save.
  const [hoursHabitId, setHoursHabitId] = useState<number | null>(null);
  const hoursHabit = habits.find((h) => h.id === hoursHabitId) ?? null;
  const [weightOpen, setWeightOpen] = useState(false);

  useBackButton(null);
  useMainButton(null, () => {});

  useEffect(() => {
    if (!nutrition) return;
    loadDay(today);
    loadPlan(today);
  }, [nutrition, today, loadDay, loadPlan]);

  const target = plan?.todayKcal ?? day?.goal?.kcal ?? null;
  const eaten = day?.totals.kcal ?? 0;
  const left = target !== null ? target - eaten : null;
  const proteinTarget = plan?.proteinTarget ?? day?.goal?.protein ?? null;
  const proteinLeft = proteinTarget !== null ? Math.max(0, proteinTarget - (day?.totals.protein ?? 0)) : null;

  const logWeight = async (kg: number) => {
    await saveWeight(today, kg);
    haptic('success');
    toast(`Вес ${fmt(kg, 1)} кг записан`);
  };

  // Stable callbacks so memoized tiles re-render only when their own habit changes.
  const tapHabit = useCallback(
    (h: Habit) => (isHoursHabit(h) ? setHoursHabitId(h.id) : toggleHabitDay(h, today)),
    [today],
  );
  const openHabit = useCallback((id: number) => navigate('habit', { selectedHabitId: id }), [navigate]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrollable">
      <div className="p-4 pb-10">
        <h1 className="text-xl font-semibold text-tg-text mb-4">{capitalizeFirst(format(parseISO(today), 'EEEE, d MMMM', { locale: ru }))}</h1>

        {/* The day's main block: what's left to eat + weight */}
        {nutrition && (
          <section
            className="rounded-3xl p-5 mb-6"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' }}
          >
            {left === null ? (
              <button onClick={() => navigate('food-goal')} className="text-base font-medium" style={{ color: 'var(--accent)' }}>
                Поставь цель по калориям, чтобы видеть остаток
              </button>
            ) : (
              <>
                <div className="text-sm text-tg-hint">{left >= 0 ? 'Осталось съесть' : 'Сверх нормы'}</div>
                <div
                  className="font-display text-[44px] leading-none mt-1"
                  style={{ color: left >= 0 ? 'var(--accent)' : 'var(--over)' }}
                >
                  {fmt(Math.abs(left))}
                  <span className="text-xl ml-1.5">ккал</span>
                </div>
                {proteinLeft !== null && (
                  <div className="text-sm mt-2" style={{ color: MACRO_COLORS.protein }}>
                    {proteinLeft > 0 ? `и ещё ${fmt(proteinLeft)} г белка` : 'белок добран ✓'}
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => navigate('food-add', { foodDate: today, foodMeal: mealByTime() })}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5 active:opacity-80"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus size={18} aria-hidden /> Еда
              </button>
              <button
                onClick={() => navigate('food-suggest', { foodDate: today })}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-medium bg-tg-section text-tg-text flex items-center justify-center gap-1.5 active:opacity-70"
              >
                <Utensils size={18} aria-hidden /> Что доесть
              </button>
            </div>

            {/* Weight: one tap for the three realistic readings of a 0.5 kg scale */}
            <div className="flex items-center gap-2 mt-4">
              <Scale size={18} className="text-tg-hint shrink-0" aria-hidden />
              {plan?.weightKg != null ? (
                <button onClick={() => setWeightOpen(true)} className="text-sm text-tg-text min-h-[36px]">
                  Вес сегодня: {fmt(plan.weightKg, 1)} кг
                  {plan.trendKg != null && <span className="text-tg-hint"> · тренд {fmt(plan.trendKg, 1)}</span>}
                </button>
              ) : plan?.lastWeightKg != null ? (
                <div className="flex gap-1.5 flex-1">
                  {[plan.lastWeightKg - 0.5, plan.lastWeightKg, plan.lastWeightKg + 0.5].map((kg) => (
                    <button
                      key={kg}
                      onClick={() => logWeight(kg)}
                      className="flex-1 min-h-[36px] rounded-lg bg-tg-section text-sm text-tg-text active:opacity-70"
                    >
                      {fmt(kg, 1)}
                    </button>
                  ))}
                  <button
                    onClick={() => setWeightOpen(true)}
                    className="min-h-[36px] px-2 rounded-lg bg-tg-section text-sm text-tg-hint active:opacity-70"
                    aria-label="Другой вес"
                  >
                    …
                  </button>
                </div>
              ) : (
                <button onClick={() => setWeightOpen(true)} className="text-sm min-h-[36px]" style={{ color: 'var(--accent)' }}>
                  Взвеситься
                </button>
              )}
            </div>

            <button
              onClick={() => navigate('food-day', { foodDate: today })}
              className="mt-3 text-sm text-tg-hint flex items-center gap-1 min-h-[32px]"
            >
              <NotebookText size={16} aria-hidden /> Дневник питания
              <ChevronRight size={16} aria-hidden />
            </button>
          </section>
        )}

        {/* Habits: tap a tile to mark today */}
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-base font-semibold text-tg-text">Привычки</h2>
          <button onClick={() => navigate('home')} className="text-sm text-tg-hint flex items-center min-h-[32px]">
            Все <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        {habits.length === 0 ? (
          <EmptyHabits onPickMore={() => navigate('onboarding')} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {habits.map((h) => (
              <HabitTile key={h.id} habit={h} date={today} onTap={tapHabit} onOpen={openHabit} />
            ))}
          </div>
        )}
      </div>

      {hoursHabit && (
        <HoursSheet
          date={today}
          title={hoursHabit.name}
          minutes={hoursHabit.entries.find((e) => e.date === today)?.value ?? 0}
          color={hoursHabit.color}
          onClose={() => setHoursHabitId(null)}
          onSave={(m) => setHabitValue(hoursHabit, today, m)}
        />
      )}
      <WeightSheet
        open={weightOpen}
        initialKg={plan?.weightKg ?? plan?.lastWeightKg ?? null}
        onClose={() => setWeightOpen(false)}
        onSave={logWeight}
      />
    </motion.div>
  );
}

interface TileProps {
  habit: Habit;
  date: string;
  onTap: (habit: Habit) => void;
  onOpen: (id: number) => void;
}

const HabitTile = memo(function HabitTile({ habit, date, onTap, onOpen }: TileProps) {
  const entry = habit.entries.find((e) => e.date === date && e.value > 0);
  const done = !!entry;
  const hours = isHoursHabit(habit);
  const week = weekProgress(habit, date);
  // On a filled tile the ink is black or white by the habit colour's brightness (white on yellow is unreadable).
  const ink = done ? readableOn(habit.color) : 'var(--tg-theme-text-color)';
  const weekTarget = habit.weeklyTarget ? week.target : 7;
  const label =
    `${habit.name}: ${done ? 'отмечено' : 'не отмечено'}` +
    (hours && done ? `, ${formatHours(entry!.value)}` : '') +
    `. На этой неделе ${week.done} из ${weekTarget}`;

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => onTap(habit)}
        aria-pressed={done}
        aria-label={label}
        className="w-full aspect-square rounded-2xl p-3 flex flex-col justify-between text-left transition-colors duration-200"
        style={{
          backgroundColor: done ? habit.color : 'var(--tg-theme-section-bg-color)',
          color: ink,
          boxShadow: done ? undefined : `inset 0 0 0 1.5px ${habit.color}55`,
        }}
      >
        <span className="text-2xl leading-none" aria-hidden>{habit.icon ?? '•'}</span>
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
        className="absolute top-0 right-0 w-10 h-10 flex items-center justify-center"
        style={{ color: done ? ink : 'var(--tg-theme-hint-color)' }}
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
});

/** No habits yet: one tap on a chip creates a ready-made habit; the full picker is one more tap away. */
function EmptyHabits({ onPickMore }: { onPickMore: () => void }) {
  const addHabit = useHabitsStore((s) => s.addHabit);
  const [busy, setBusy] = useState<string | null>(null);
  const quick = QUICK_TEMPLATE_KEYS.map((k) => HABIT_TEMPLATES.find((t) => t.key === k)).filter(
    (t): t is HabitTemplate => !!t,
  );

  const add = async (t: HabitTemplate) => {
    if (busy) return;
    setBusy(t.key);
    const ok = await addHabit(templateToHabit(t));
    setBusy(null);
    haptic(ok ? 'success' : 'error');
  };

  return (
    <div className="rounded-2xl bg-tg-section p-4">
      <p className="text-base font-medium text-tg-text">Начни с одной привычки</p>
      <p className="text-sm text-tg-hint mt-0.5">Нажми — и она появится здесь, отмечать можно сразу</p>
      <div className="flex flex-wrap gap-2 mt-3">
        {quick.map((t) => (
          <motion.button
            key={t.key}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => add(t)}
            disabled={!!busy}
            className="min-h-[44px] px-4 rounded-full text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
            style={{ backgroundColor: t.color, color: readableOn(t.color) }}
          >
            <span aria-hidden>{t.icon}</span> {t.name}
          </motion.button>
        ))}
      </div>
      <button
        type="button"
        onClick={onPickMore}
        className="mt-2 min-h-[44px] text-sm font-medium flex items-center gap-1"
        style={{ color: 'var(--accent)' }}
      >
        Выбрать из списка <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}