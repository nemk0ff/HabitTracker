import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Apple,
  BookmarkPlus,
  CalendarDays,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Dumbbell,
  Moon,
  Scale,
  Soup,
  Target,
  Utensils,
  UtensilsCrossed,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { CalorieRing } from '../../components/nutrition/CalorieRing';
import { MacroBars } from '../../components/nutrition/MacroBars';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { FoodCalendarSheet } from '../../components/nutrition/FoodCalendarSheet';
import { WeightSheet } from '../../components/nutrition/WeightSheet';
import { InsightsCard } from '../../components/nutrition/InsightsCard';
import { ON_TRACK_COLORS, ON_TRACK_LABELS, phaseLine } from '../../utils/phases';
import { SaveTemplateSheet } from '../../components/nutrition/SaveTemplateSheet';
import { TemplatesHint, markTemplatesHintSeen } from '../../components/nutrition/TemplatesHint';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { capitalizeFirst, shiftDate, toDateString } from '../../utils/dates';
import { MEALS, fallbackProtein, fmt, formatDayTitle, mealByTime, mealLabel, sumMacros } from '../../utils/nutrition';
import { fetchFrequent, type FrequentFood } from '../../api/nutrition';
import { toast } from '../../stores/toastStore';
import type { FoodLogEntry, Meal, NutritionGoal } from '../../types';

export function FoodDayPage() {
  const { date, navigate, back } = useNavStore(
    useShallow((s) => ({ date: s.foodDate, navigate: s.navigate, back: s.back })),
  );
  const day = useNutritionStore((s) => s.days[date]);
  const plan = useNutritionStore((s) => s.plans[date]);
  const {
    loadDay,
    loadPlan,
    saveWeight,
    updateEntry,
    removeEntry,
    copyDay,
    addEntry,
    setDayComplete,
    templates,
    templatesLoaded,
    loadTemplates,
    saveTemplateFromMeal,
    applyTemplate,
  } = useNutritionStore(
    useShallow((s) => ({
      templates: s.templates,
      templatesLoaded: s.templatesLoaded,
      loadTemplates: s.loadTemplates,
      saveTemplateFromMeal: s.saveTemplateFromMeal,
      applyTemplate: s.applyTemplate,
      loadDay: s.loadDay,
      loadPlan: s.loadPlan,
      saveWeight: s.saveWeight,
      updateEntry: s.updateEntry,
      removeEntry: s.removeEntry,
      copyDay: s.copyDay,
      addEntry: s.addEntry,
      setDayComplete: s.setDayComplete,
    })),
  );
  const today = toDateString(new Date());

  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [frequent, setFrequent] = useState<FrequentFood[]>([]);
  const quickMeal: Meal = date === today ? mealByTime() : 'lunch';
  const prevDate = shiftDate(date, -1);
  const prevDay = useNutritionStore((s) => s.days[prevDate]);
  const [weightOpen, setWeightOpen] = useState(false);
  const [savingMeal, setSavingMeal] = useState<Meal | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  useBackButton(back);
  useMainButton('Добавить еду', () =>
    navigate('food-add', { foodMeal: date === today ? mealByTime() : 'lunch' }),
  );

  useEffect(() => {
    loadDay(date);
    loadPlan(date);
    loadDay(shiftDate(date, -1));
  }, [date, loadDay, loadPlan]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Templates for the quick-add meal go first in the chip row (meal-less ones fit anywhere).
  const quickTemplates = useMemo(
    () => templates.filter((t) => t.meal === quickMeal || t.meal === null),
    [templates, quickMeal],
  );
  const savingEntries = useMemo(
    () => (savingMeal ? day?.entries.filter((e) => e.meal === savingMeal) ?? [] : []),
    [savingMeal, day?.entries],
  );
  const hasMultiMeal = !!day && MEALS.some((m) => day.entries.filter((e) => e.meal === m.key).length >= 2);

  // Model targets override the static goal: today's kcal (training-day aware) and protein.
  const effectiveGoal = useMemo<NutritionGoal | null>(() => {
    if (!day?.goal) return null;
    return {
      ...day.goal,
      kcal: plan?.todayKcal ?? day.goal.kcal,
      protein: plan?.proteinTarget ?? fallbackProtein(day.goal),
    };
  }, [day?.goal, plan]);

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

  useEffect(() => {
    // Fast date flipping changes quickMeal; a slower earlier response must not win.
    let ignore = false;
    fetchFrequent(quickMeal)
      .then((f) => !ignore && setFrequent(f))
      .catch(() => !ignore && setFrequent([]));
    return () => {
      ignore = true;
    };
  }, [quickMeal]);

  /** One tap: the food with its last-used portion, undoable from the toast. */
  const quickAdd = async (f: FrequentFood) => {
    const entry = await addEntry({ date, meal: quickMeal, grams: f.grams, foodId: f.food.id });
    if (!entry) return;
    haptic('success');
    toast(`${f.food.name} · ${fmt(f.grams)} г добавлено`, {
      actions: [{ label: 'Отменить', onClick: () => removeEntry(entry) }],
    });
  };

  const quickTemplate = async (id: number) => {
    if (applyingId !== null) return;
    setApplyingId(id);
    const created = await applyTemplate(id, date, quickMeal);
    setApplyingId(null);
    haptic(created.length > 0 ? 'success' : 'warning');
  };

  const repeatMeal = async (meal: Meal) => {
    const n = await copyDay(prevDate, date, meal);
    haptic(n > 0 ? 'success' : 'warning');
  };

  const copyYesterday = async () => {
    setCopying(true);
    const n = await copyDay(shiftDate(date, -1), date);
    setCopying(false);
    haptic(n > 0 ? 'success' : 'warning');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        {/* Header: day switcher on the left, stats and goal as icons on the right */}
        <div className="flex items-center mb-3 -mx-1">
          <button
            onClick={() => go(shiftDate(date, -1))}
            aria-label="Предыдущий день"
            className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <button
            onClick={() => setCalendarOpen(true)}
            className="flex items-center gap-1.5 px-2 min-h-[40px] rounded-xl active:bg-tg-secondary"
          >
            <span className="text-lg font-semibold text-tg-text">{capitalizeFirst(formatDayTitle(date, today))}</span>
            <CalendarDays size={18} className="text-tg-hint" aria-hidden />
          </button>
          <button
            onClick={() => go(shiftDate(date, 1))}
            disabled={date >= today}
            aria-label="Следующий день"
            className="w-10 h-10 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text disabled:opacity-30"
          >
            <ChevronRight size={22} aria-hidden />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => navigate('food-stats')}
            aria-label="Статистика"
            className="w-11 h-11 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text"
          >
            <ChartColumn size={22} aria-hidden />
          </button>
          <button
            onClick={() => navigate('food-goal')}
            aria-label="Цель и вес"
            className="w-11 h-11 flex items-center justify-center rounded-xl active:bg-tg-secondary text-tg-text"
          >
            <Target size={22} aria-hidden />
          </button>
        </div>

        {/* Summary */}
        <div className="bg-tg-section rounded-2xl p-4">
          <div className="flex items-center gap-5">
            <CalorieRing eaten={day?.totals.kcal ?? 0} goal={effectiveGoal?.kcal ?? null} size={130} stroke={11} />
            <MacroBars totals={day?.totals ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 }} goal={effectiveGoal} />
          </div>

          {/* Day context in one line: where the target comes from, training, sleep */}
          {plan && plan.mode !== 'none' && (
            <p className="text-sm text-tg-hint mt-3 flex flex-wrap items-center gap-x-1">
              <span>{plan.mode === 'adaptive' ? 'Норма подстроена под твой вес' : 'Норма по цели'}</span>
              {plan.isTrainingDay && (
                <span className="inline-flex items-center gap-1">
                  · <Dumbbell size={14} aria-hidden /> тренировка +{plan.trainingBonus}
                </span>
              )}
              {plan.sleepLastNightH !== null && (
                <span className="inline-flex items-center gap-1">
                  · <Moon size={14} aria-hidden /> {fmt(plan.sleepLastNightH, 1)} ч
                </span>
              )}
            </p>
          )}

          {/* Current goal phase: pace vs plan, dot coloured by on-track state */}
          {plan?.phase && (
            <button
              onClick={() => navigate('food-goal')}
              className="w-full text-left text-sm text-tg-text mt-1.5 flex items-center gap-2 tabular-nums active:opacity-70"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: plan.phase.onTrack ? ON_TRACK_COLORS[plan.phase.onTrack] : 'var(--tg-theme-hint-color)' }}
                aria-hidden
              />
              <span className="min-w-0">{phaseLine(plan.phase)}</span>
              {plan.phase.onTrack && <span className="sr-only">{ON_TRACK_LABELS[plan.phase.onTrack]}</span>}
            </button>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setWeightOpen(true)}
              className="flex-1 min-w-0 min-h-[44px] rounded-xl px-3 flex items-center gap-2 text-sm text-tg-text active:opacity-70"
              style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color)' }}
            >
              <Scale size={18} className="text-tg-hint shrink-0" aria-hidden />
              <span className="truncate">
                {plan?.weightKg != null ? `${fmt(plan.weightKg, 1)} кг` : date === today ? 'Взвеситься' : 'Вес не записан'}
                {plan?.trendKg != null && <span className="text-tg-hint"> · тренд {fmt(plan.trendKg, 1)}</span>}
              </span>
            </button>
            <button
              onClick={() => navigate('food-suggest')}
              className="shrink-0 whitespace-nowrap min-h-[44px] rounded-xl px-4 flex items-center justify-center gap-2 text-sm font-medium active:opacity-70"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}
            >
              <Utensils size={18} aria-hidden /> Что доесть
            </button>
          </div>
        </div>

        {plan && plan.insights.length > 0 && <InsightsCard insights={plan.insights} />}

        {day && !day.goal && (
          <button
            onClick={() => navigate('food-goal')}
            className="w-full mt-3 rounded-xl px-4 py-3 text-left text-sm"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}
          >
            Поставь цель по калориям, чтобы видеть остаток на день
          </button>
        )}

        {/* Quick add: what you usually eat at this time */}
        {(frequent.length > 0 || quickTemplates.length > 0) && (
          <div className="mt-4">
            <div className="text-sm text-tg-hint mb-2 px-1">Частое на {mealLabel(quickMeal).toLowerCase()}</div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {quickTemplates.map((t) => (
                <button
                  key={`t${t.id}`}
                  onClick={() => quickTemplate(t.id)}
                  disabled={applyingId !== null}
                  className="shrink-0 min-h-[40px] max-w-[220px] px-3 rounded-full text-sm font-medium active:opacity-70 truncate disabled:opacity-50"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}
                >
                  🍽 {t.name} · {fmt(t.totals.kcal)} ккал
                </button>
              ))}
              {frequent.map((f) => (
                <button
                  key={f.food.id}
                  onClick={() => quickAdd(f)}
                  className="shrink-0 min-h-[40px] max-w-[180px] px-3 rounded-full bg-tg-section text-sm text-tg-text active:opacity-70 truncate"
                >
                  + {f.food.name} · {fmt(f.grams)} г
                </button>
              ))}
            </div>
          </div>
        )}

        <TemplatesHint show={templatesLoaded && templates.length === 0 && hasMultiMeal} />

        {/* Meals */}
        <div className="flex flex-col gap-3 mt-4">
          {MEALS.map((meal) => {
            const entries = day?.entries.filter((e) => e.meal === meal.key) ?? [];
            const total = sumMacros(entries);
            return (
              <div key={meal.key} className="bg-tg-section rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <MealIcon meal={meal.key} />
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
                      <div className="text-xs text-tg-hint">
                        {fmt(e.grams)} г · Б {fmt(e.protein, 1)} · Ж {fmt(e.fat, 1)} · У {fmt(e.carbs, 1)}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-tg-text ml-3">{fmt(e.kcal)}</span>
                  </button>
                ))}

                <div className="flex">
                  <button
                    onClick={() => navigate('food-add', { foodMeal: meal.key })}
                    className="flex-1 min-h-[44px] px-4 text-left text-sm font-medium active:opacity-70"
                    style={{ color: 'var(--accent)' }}
                  >
                    + Добавить
                  </button>
                  {entries.length >= 2 && (
                    <button
                      onClick={() => setSavingMeal(meal.key)}
                      className="min-h-[44px] px-4 flex items-center gap-1.5 text-sm text-tg-hint active:opacity-70"
                    >
                      <BookmarkPlus size={16} aria-hidden /> Сохранить как набор
                    </button>
                  )}
                  {entries.length === 0 && prevDay?.entries.some((e) => e.meal === meal.key) && (
                    <button
                      onClick={() => repeatMeal(meal.key)}
                      className="min-h-[44px] px-4 text-sm text-tg-hint active:opacity-70"
                    >
                      Повторить как вчера
                    </button>
                  )}
                </div>
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

        {/* Explicit "day is complete" — the model trusts it over its heuristic */}
        {day && day.entries.length > 0 && (
          <button
            onClick={() => {
              setDayComplete(date, !day.complete);
              haptic('select');
            }}
            aria-pressed={day.complete}
            className="w-full mt-4 min-h-[48px] rounded-xl text-sm font-medium active:opacity-70"
            style={
              day.complete
                ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }
                : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
            }
          >
            {day.complete ? '✓ День заполнен полностью' : 'Отметить: всё за день записано'}
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

      <SaveTemplateSheet
        meal={savingMeal}
        entries={savingEntries}
        onClose={() => setSavingMeal(null)}
        onSave={async (name) => {
          if (!savingMeal) return false;
          const tpl = await saveTemplateFromMeal(date, savingMeal, name);
          if (!tpl) return false;
          markTemplatesHintSeen();
          haptic('success');
          toast(`Набор «${tpl.name}» сохранён`);
          return true;
        }}
      />

      <WeightSheet
        open={weightOpen}
        initialKg={plan?.weightKg ?? plan?.trendKg ?? null}
        onClose={() => setWeightOpen(false)}
        onSave={async (kg) => {
          await saveWeight(date, kg);
          haptic('success');
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

const MEAL_ICONS: Record<Meal, typeof Coffee> = { breakfast: Coffee, lunch: Soup, dinner: UtensilsCrossed, snack: Apple };

function MealIcon({ meal }: { meal: Meal }) {
  const Icon = MEAL_ICONS[meal];
  return <Icon size={20} className="text-tg-hint" aria-hidden />;
}
