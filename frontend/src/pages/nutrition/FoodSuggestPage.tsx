import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { FavoriteStar } from '../../components/nutrition/FavoriteStar';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { NUTRITION_COLOR, MACRO_COLORS, fallbackProtein, fmt, mealByTime } from '../../utils/nutrition';
import { toDateString } from '../../utils/dates';
import { DONE_KCAL, bestCombo, remainingOf, suggest, type Suggestion } from '../../utils/suggest';

/** "Что доесть": favorite foods that can close the rest of the day's КБЖУ. */
export function FoodSuggestPage() {
  const { foodDate: date, navigate } = useNavStore();
  const { days, plans, favorites, loadDay, loadPlan, loadFavorites, addEntry, addEntries, toggleFavorite } =
    useNutritionStore();
  const day = days[date];
  const plan = plans[date];
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [adding, setAdding] = useState(false);

  useBackButton(useNavStore((s) => s.back));
  useMainButton(null, () => {});

  useEffect(() => {
    loadDay(date);
    loadPlan(date);
    loadFavorites();
  }, [date, loadDay, loadPlan, loadFavorites]);

  // Same targets as the day screen: the model's kcal/protein, goal fat/carbs.
  const remaining = useMemo(() => {
    if (!day?.goal) return null;
    return remainingOf(
      {
        kcal: plan?.todayKcal ?? day.goal.kcal,
        protein: plan?.proteinTarget ?? fallbackProtein(day.goal) ?? undefined,
        fat: day.goal.fat ?? undefined,
        carbs: day.goal.carbs ?? undefined,
      },
      day.totals,
    );
  }, [day, plan]);

  const suggestions = useMemo(() => (remaining ? suggest(favorites, remaining) : []), [favorites, remaining]);
  const combo = useMemo(() => (remaining ? bestCombo(suggestions, remaining) : null), [suggestions, remaining]);
  const done = remaining !== null && remaining.kcal <= DONE_KCAL;
  const meal = date === toDateString(new Date()) ? mealByTime() : 'snack';

  const target = useMemo<PortionTarget | null>(
    () =>
      picked
        ? {
            title: picked.food.name,
            subtitle: picked.food.brand,
            per100: picked.food,
            servings: picked.food.servings,
            grams: picked.grams,
            meal,
          }
        : null,
    [picked, meal],
  );

  const addCombo = async () => {
    if (!combo || adding) return;
    setAdding(true);
    try {
      await addEntries(combo.items.map((i) => ({ date, meal, grams: Math.round(i.grams), foodId: i.food.id })));
      haptic('success');
    } finally {
      setAdding(false);
    }
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
        <h1 className="text-xl font-bold text-tg-text mb-1">Что доесть</h1>

        {!day ? (
          <p className="text-sm text-tg-hint">Загрузка…</p>
        ) : !remaining ? (
          <button
            onClick={() => navigate('food-goal')}
            className="w-full mt-2 rounded-xl px-4 py-3 text-left text-sm"
            style={{ backgroundColor: `${NUTRITION_COLOR}1a`, color: NUTRITION_COLOR }}
          >
            Сначала поставь цель по калориям →
          </button>
        ) : (
          <p className="text-sm text-tg-hint mb-4">
            {done ? (
              'Норма на сегодня закрыта 🎉'
            ) : (
              <>
                Осталось <b className="text-tg-text">{fmt(remaining.kcal)} ккал</b>
                {remaining.protein > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: MACRO_COLORS.protein }}>Б {fmt(remaining.protein)} г</span>
                  </>
                )}
                {remaining.hasFat && ` · Ж ${fmt(remaining.fat)} г`}
                {remaining.hasCarbs && ` · У ${fmt(remaining.carbs)} г`}
              </>
            )}
          </p>
        )}

        {/* Best combination */}
        {combo && (
          <div className="bg-tg-section rounded-2xl p-4 mb-4">
            <div className="text-sm font-semibold text-tg-text mb-2">🍽 Лучший набор</div>
            {combo.items.map((i) => (
              <div key={i.food.id} className="flex justify-between text-sm text-tg-text py-0.5">
                <span className="truncate mr-3">{i.food.name}</span>
                <span className="shrink-0 text-tg-hint">{fmt(i.grams)} г</span>
              </div>
            ))}
            <div className="text-xs text-tg-hint mt-2">
              {fmt(combo.total.kcal)} ккал · Б {fmt(combo.total.protein)} · Ж {fmt(combo.total.fat)} · У {fmt(combo.total.carbs)}
            </div>
            <button
              onClick={addCombo}
              disabled={adding}
              className="w-full mt-3 py-2.5 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: NUTRITION_COLOR }}
            >
              {adding ? '…' : 'Добавить всё'}
            </button>
          </div>
        )}

        {/* Favorites matrix */}
        {favorites.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">⭐</div>
            <p className="text-sm text-tg-hint mb-4">Отметь любимые продукты звёздочкой в поиске — они появятся здесь</p>
            <button
              onClick={() => navigate('food-add')}
              className="px-5 py-2.5 rounded-xl text-sm font-medium"
              style={{ backgroundColor: `${NUTRITION_COLOR}1a`, color: NUTRITION_COLOR }}
            >
              К поиску продуктов
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.food.id}
                s={s}
                dimmed={done || s.fit !== 'fits'}
                onClick={() => setPicked(s)}
                onStar={() => toggleFavorite(s.food)}
              />
            ))}
          </div>
        )}
      </div>

      <PortionSheet
        target={target}
        confirmLabel="Добавить"
        favorite={picked ? favorites.some((f) => f.id === picked.food.id) : false}
        onToggleFavorite={picked ? () => toggleFavorite(picked.food) : undefined}
        onClose={() => setPicked(null)}
        onConfirm={async (grams, m) => {
          if (!picked) return;
          const entry = await addEntry({ date, meal: m, grams, foodId: picked.food.id });
          if (entry) setPicked(null);
        }}
      />
    </motion.div>
  );
}

function SuggestionCard({
  s,
  dimmed,
  onClick,
  onStar,
}: {
  s: Suggestion;
  dimmed: boolean;
  onClick: () => void;
  onStar: () => void;
}) {
  const portions = s.grams / s.portionGrams;
  const hint =
    s.fit === 'tooCaloric'
      ? 'слишком калорийно'
      : s.fit === 'tooLight'
        ? 'мало калорий'
        : `≈ ${fmt(s.grams)} г${s.food.servings[0] ? ` · ${fmt(portions, 1)} ${s.food.servings[0].label}` : ''}`;

  return (
    <div
      onClick={onClick}
      className={`relative bg-tg-section rounded-2xl p-3 pr-8 cursor-pointer active:opacity-80 transition-opacity ${
        dimmed ? 'opacity-40' : ''
      }`}
      style={dimmed ? undefined : { boxShadow: `inset 0 0 0 1.5px ${NUTRITION_COLOR}` }}
    >
      <FavoriteStar active onToggle={onStar} className="absolute top-1 right-1" />
      <div className="text-sm font-medium text-tg-text leading-tight line-clamp-2">{s.food.name}</div>
      {s.food.brand && <div className="text-xs text-tg-hint truncate mt-0.5">{s.food.brand}</div>}
      <div className="text-xs text-tg-hint mt-1">{fmt(s.food.kcal)} ккал / 100 г</div>
      <div className="text-xs font-medium mt-2" style={{ color: dimmed ? 'var(--tg-theme-hint-color)' : NUTRITION_COLOR }}>
        {hint}
      </div>
      {!dimmed && s.gives.protein >= 1 && (
        <div className="text-xs mt-0.5" style={{ color: MACRO_COLORS.protein }}>
          +{fmt(s.gives.protein)} г белка
        </div>
      )}
    </div>
  );
}
