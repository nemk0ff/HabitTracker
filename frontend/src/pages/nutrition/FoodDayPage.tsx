import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { addDays, parseISO } from 'date-fns';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { CalorieRing } from '../../components/nutrition/CalorieRing';
import { MacroBars } from '../../components/nutrition/MacroBars';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { FoodCalendarSheet } from '../../components/nutrition/FoodCalendarSheet';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { toDateString } from '../../utils/dates';
import { MEALS, NUTRITION_COLOR, fmt, formatDayTitle, mealByTime, sumMacros } from '../../utils/nutrition';
import type { FoodLogEntry } from '../../types';

function shiftDate(date: string, days: number): string {
  return toDateString(addDays(parseISO(date), days));
}

export function FoodDayPage() {
  const { foodDate: date, navigate } = useNavStore();
  const { days, loadDay, updateEntry, removeEntry, copyDay } = useNutritionStore();
  const day = days[date];
  const today = toDateString(new Date());

  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  useBackButton(() => navigate('hub'));
  useMainButton('Добавить еду', () =>
    navigate('food-add', { foodMeal: date === today ? mealByTime() : 'lunch' }),
  );

  useEffect(() => {
    loadDay(date);
  }, [date, loadDay]);

  const go = (d: string) => {
    haptic('select');
    navigate('food-day', { foodDate: d });
  };

  // Memoized: PortionSheet resets its inputs whenever `target` identity changes.
  const editTarget = useMemo<PortionTarget | null>(() => editing
    ? {
        title: editing.name,
        subtitle: 'Изменить порцию',
        per100: {
          kcal: (editing.kcal / editing.grams) * 100,
          protein: (editing.protein / editing.grams) * 100,
          fat: (editing.fat / editing.grams) * 100,
          carbs: (editing.carbs / editing.grams) * 100,
        },
        servings: [],
        grams: editing.grams,
        meal: editing.meal,
      }
    : null, [editing]);

  const copyYesterday = async () => {
    setCopying(true);
    const n = await copyDay(shiftDate(date, -1), date);
    setCopying(false);
    haptic(n > 0 ? 'success' : 'warning');
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        {/* Date navigation */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => go(shiftDate(date, -1))} className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={() => setCalendarOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl active:bg-tg-secondary">
            <span className="text-lg font-bold text-tg-text capitalize">{formatDayTitle(date, today)}</span>
            <span className="text-sm">📅</span>
          </button>
          <button
            onClick={() => go(shiftDate(date, 1))}
            disabled={date >= today}
            className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text disabled:opacity-30"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div className="bg-tg-section rounded-2xl p-4 flex items-center gap-5">
          <CalorieRing eaten={day?.totals.kcal ?? 0} goal={day?.goal?.kcal ?? null} size={130} stroke={11} />
          <MacroBars totals={day?.totals ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 }} goal={day?.goal ?? null} />
        </div>

        {/* Shortcuts */}
        <div className="flex gap-2 mt-3">
          <button onClick={() => navigate('food-stats')} className="flex-1 bg-tg-section rounded-xl py-2.5 text-sm font-medium text-tg-text active:opacity-70">
            📊 Статистика
          </button>
          <button onClick={() => navigate('food-goal')} className="flex-1 bg-tg-section rounded-xl py-2.5 text-sm font-medium text-tg-text active:opacity-70">
            🎯 Цель и вес
          </button>
        </div>

        {day && !day.goal && (
          <button
            onClick={() => navigate('food-goal')}
            className="w-full mt-3 rounded-xl px-4 py-3 text-left text-sm"
            style={{ backgroundColor: `${NUTRITION_COLOR}1a`, color: NUTRITION_COLOR }}
          >
            Поставь цель по калориям — и я буду считать, сколько осталось →
          </button>
        )}

        {/* Meals */}
        <div className="flex flex-col gap-3 mt-4">
          {MEALS.map((meal) => {
            const entries = day?.entries.filter((e) => e.meal === meal.key) ?? [];
            const total = sumMacros(entries);
            return (
              <div key={meal.key} className="bg-tg-section rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{meal.icon}</span>
                    <span className="text-sm font-semibold text-tg-text">{meal.label}</span>
                  </div>
                  {entries.length > 0 && <span className="text-sm text-tg-hint">{fmt(total.kcal)} ккал</span>}
                </div>

                {entries.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEditing(e)}
                    className="w-full flex items-center justify-between px-4 py-2 text-left active:bg-tg-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-tg-text truncate">{e.name}</div>
                      <div className="text-[11px] text-tg-hint">
                        {fmt(e.grams)} г · Б {fmt(e.protein, 1)} · Ж {fmt(e.fat, 1)} · У {fmt(e.carbs, 1)}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-tg-text ml-3">{fmt(e.kcal)}</span>
                  </button>
                ))}

                <button
                  onClick={() => navigate('food-add', { foodMeal: meal.key })}
                  className="w-full px-4 py-2.5 text-left text-sm font-medium active:opacity-70"
                  style={{ color: NUTRITION_COLOR }}
                >
                  + Добавить
                </button>
              </div>
            );
          })}
        </div>

        {day && day.entries.length === 0 && (
          <button
            onClick={copyYesterday}
            disabled={copying}
            className="w-full mt-3 py-3 rounded-xl text-sm font-medium bg-tg-section text-tg-text active:opacity-70 disabled:opacity-40"
          >
            {copying ? 'Копирую…' : '🔁 Как вчера — скопировать прошлый день'}
          </button>
        )}
      </div>

      <PortionSheet
        target={editTarget}
        confirmLabel="Сохранить"
        onClose={() => setEditing(null)}
        onConfirm={async (grams, meal) => {
          if (!editing) return;
          await updateEntry(editing, { grams, meal });
          setEditing(null);
        }}
        onDelete={() => {
          if (!editing) return;
          removeEntry(editing);
          haptic('medium');
          setEditing(null);
        }}
      />

      <FoodCalendarSheet
        open={calendarOpen}
        selectedDate={date}
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => go(d)}
      />
    </motion.div>
  );
}
