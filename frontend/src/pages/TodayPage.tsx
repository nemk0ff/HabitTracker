import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronRight, Plus, Utensils, Scale, NotebookText } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useNutritionStore } from '../stores/nutritionStore';
import { toast } from '../stores/toastStore';
import { HoursSheet } from '../components/HoursSheet';
import { WeightSheet } from '../components/nutrition/WeightSheet';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { toDateString } from '../utils/dates';
import { MACRO_COLORS, fmt, mealByTime } from '../utils/nutrition';
import { formatHours, isHoursHabit } from '../utils/habits';
import { setHabitValue, toggleHabitDay } from '../utils/habitActions';
import type { Habit } from '../types';

/**
 * Start screen: everything that is marked daily, without choosing a module first
 * (design review 07.10: habits got 2 marks per 36 opens behind the old hub).
 */
export function TodayPage() {
  const user = useAuthStore((s) => s.user);
  const habits = useHabitsStore((s) => s.habits);
  const navigate = useNavStore((s) => s.navigate);
  const { days, plans, loadDay, loadPlan, saveWeight } = useNutritionStore();
  const nutrition = !!user?.features?.nutrition;
  const today = toDateString(new Date());
  const day = days[today];
  const plan = plans[today];

  const [hoursHabit, setHoursHabit] = useState<Habit | null>(null);
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

  const tapHabit = (h: Habit) => (isHoursHabit(h) ? setHoursHabit(h) : toggleHabitDay(h, today));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrollable">
      <div className="p-4 pb-10">
        <h1 className="text-xl font-semibold text-tg-text capitalize mb-4">
          {format(new Date(), 'EEEE, d MMMM', { locale: ru })}
        </h1>

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
          <button onClick={() => navigate('create')} className="w-full rounded-2xl bg-tg-section py-6 text-sm text-tg-hint">
            Добавь первую привычку
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {habits.map((h) => (
              <HabitTile
                key={h.id}
                habit={h}
                date={today}
                onTap={() => tapHabit(h)}
                onOpen={() => navigate('habit', { selectedHabitId: h.id })}
              />
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
          onClose={() => setHoursHabit(null)}
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

function HabitTile({ habit, date, onTap, onOpen }: { habit: Habit; date: string; onTap: () => void; onOpen: () => void }) {
  const entry = habit.entries.find((e) => e.date === date && e.value > 0);
  const done = !!entry;
  const hours = isHoursHabit(habit);
  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onTap}
        aria-pressed={done}
        aria-label={`${habit.name}: ${done ? 'отмечено' : 'не отмечено'}`}
        className="w-full aspect-square rounded-2xl p-3 flex flex-col justify-between text-left transition-colors duration-200"
        style={{
          backgroundColor: done ? habit.color : 'var(--tg-theme-section-bg-color)',
          color: done ? '#fff' : 'var(--tg-theme-text-color)',
          boxShadow: done ? undefined : `inset 0 0 0 1.5px ${habit.color}55`,
        }}
      >
        <span className="text-2xl leading-none">{habit.icon ?? '•'}</span>
        <span>
          {hours && done && <span className="block font-display text-base leading-tight">{formatHours(entry!.value)}</span>}
          <span className="block text-sm font-medium leading-tight line-clamp-2">{habit.name}</span>
        </span>
      </motion.button>
      <button
        onClick={onOpen}
        aria-label={`Открыть «${habit.name}»`}
        className="absolute top-0 right-0 w-10 h-10 flex items-center justify-center"
        style={{ color: done ? '#fff' : 'var(--tg-theme-hint-color)' }}
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
}
