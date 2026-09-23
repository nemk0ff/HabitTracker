import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useNutritionStore } from '../stores/nutritionStore';
import { CalorieRing } from '../components/nutrition/CalorieRing';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { toDateString } from '../utils/dates';
import { NUTRITION_COLOR, fmt } from '../utils/nutrition';

export function HubPage() {
  const user = useAuthStore((s) => s.user);
  const habits = useHabitsStore((s) => s.habits);
  const navigate = useNavStore((s) => s.navigate);
  const { days, loadDay } = useNutritionStore();
  const nutritionEnabled = !!user?.features?.nutrition;

  const today = toDateString(new Date());
  const todayFood = days[today];

  useBackButton(null);
  useMainButton(null, () => {});

  useEffect(() => {
    if (nutritionEnabled) loadDay(today);
  }, [nutritionEnabled, today, loadDay]);

  const doneToday = habits.filter((h) => h.entries.some((e) => e.date === today && e.value > 0)).length;

  const openNutrition = () => {
    if (!nutritionEnabled) {
      haptic('warning');
      return;
    }
    haptic('light');
    navigate('food-day', { foodDate: today });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrollable">
      <div className="p-4 pb-10">
        <h1 className="text-xl font-bold text-tg-text mb-1">
          {user?.firstName ? `Привет, ${user.firstName}!` : 'Привет!'}
        </h1>
        <p className="text-sm text-tg-hint mb-5">Что открываем?</p>

        <div className="flex flex-col gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              haptic('light');
              navigate('home');
            }}
            className="bg-tg-section rounded-2xl p-5 flex items-center gap-4 text-left"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ backgroundColor: '#4CAF5022' }}>
              🎯
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold text-tg-text">Трекер привычек</div>
              <div className="text-sm text-tg-hint">
                {habits.length === 0 ? 'Пока нет привычек' : `Сегодня: ${doneToday} из ${habits.length}`}
              </div>
            </div>
            <Chevron />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={openNutrition}
            className={`bg-tg-section rounded-2xl p-5 flex items-center gap-4 text-left relative ${nutritionEnabled ? '' : 'opacity-60'}`}
          >
            {nutritionEnabled && todayFood ? (
              <CalorieRing eaten={todayFood.totals.kcal} goal={todayFood.goal?.kcal ?? null} size={56} stroke={6} compact />
            ) : (
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ backgroundColor: `${NUTRITION_COLOR}22` }}>
                🥗
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold text-tg-text">Трекер питания</div>
              <div className="text-sm text-tg-hint">
                {!nutritionEnabled
                  ? 'Скоро будет доступен'
                  : todayFood
                    ? todayFood.goal
                      ? `Сегодня: ${fmt(todayFood.totals.kcal)} из ${fmt(todayFood.goal.kcal)} ккал`
                      : `Сегодня: ${fmt(todayFood.totals.kcal)} ккал`
                    : 'Калории и БЖУ за день'}
              </div>
            </div>
            {nutritionEnabled ? (
              <Chevron />
            ) : (
              <span className="absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }}>
                В разработке
              </span>
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" className="shrink-0 text-tg-hint">
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
