import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { AgentLogPanel } from '../../components/nutrition/AgentLogPanel';
import { FavoriteStar } from '../../components/nutrition/FavoriteStar';
import { useAuthStore } from '../../stores/authStore';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { fetchMyFoods, searchFoods } from '../../api/nutrition';
import { NUTRITION_COLOR, fmt, foodSourceLabel, mealLabel } from '../../utils/nutrition';
import type { Food } from '../../types';

type Tab = 'search' | 'text';

export function FoodAddPage() {
  const { foodDate: date, foodMeal, navigate } = useNavStore();
  const { recent, loadRecent, addEntry, toggleFavorite } = useNutritionStore();
  // Star state for foods shown here (search results / mine aren't in the store).
  const [favOverride, setFavOverride] = useState<Record<number, boolean>>({});
  const isFav = (f: Food) => favOverride[f.id] ?? f.favorite;
  const star = async (f: Food) => {
    setFavOverride((o) => ({ ...o, [f.id]: !isFav(f) }));
    const fav = await toggleFavorite({ ...f, favorite: isFav(f) });
    setFavOverride((o) => ({ ...o, [f.id]: fav }));
  };
  const agentLog = useAuthStore((s) => !!s.user?.features?.agentLog);

  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [mine, setMine] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);

  const back = useNavStore((s) => s.back);
  useBackButton(back);
  useMainButton(null, () => {});

  useEffect(() => {
    loadRecent();
    fetchMyFoods().then(setMine).catch(() => setMine([]));
  }, [loadRecent]);

  // Debounced search; stale requests are aborted.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      searchFoods(q, ctrl.signal)
        .then((r) => {
          setResults(r);
          setSearching(false);
        })
        .catch((e) => {
          if (e?.name !== 'AbortError') setSearching(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const target = useMemo<PortionTarget | null>(
    () =>
      picked
        ? {
            title: picked.name,
            subtitle: picked.brand,
            per100: picked,
            servings: picked.servings,
            grams: picked.servings[0]?.grams ?? 100,
            meal: foodMeal,
          }
        : null,
    [picked, foodMeal],
  );

  const list = results ?? recent;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <h1 className="text-xl font-bold text-tg-text mb-3">Добавить: {mealLabel(foodMeal).toLowerCase()}</h1>

        {/* Tabs (the agent tab is developer-only) */}
        {agentLog && (
          <div className="flex bg-tg-section rounded-xl p-1 mb-4">
            {(
              [
                ['search', '🔍 Поиск'],
                ['text', '✨ Текстом'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  haptic('select');
                }}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                style={tab === key ? { backgroundColor: NUTRITION_COLOR, color: '#fff' } : { color: 'var(--tg-theme-text-color)' }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'search' || !agentLog ? (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Курица, гречка, творог…"
              className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint"
            />

            <div className="text-xs text-tg-hint mt-4 mb-2 px-1">
              {results ? (searching ? 'Ищу…' : `Найдено: ${results.length}`) : searching ? 'Ищу…' : recent.length ? 'Недавние' : ''}
            </div>

            <div className="flex flex-col gap-1.5">
              {list.map((f) => (
                <FoodRow key={f.id} food={f} favorite={isFav(f)} onStar={() => star(f)} onClick={() => setPicked(f)} />
              ))}
            </div>

            {results && !searching && results.length === 0 && (
              <p className="text-sm text-tg-hint text-center py-6">Ничего не нашлось</p>
            )}

            <button
              onClick={() => navigate('food-product', { foodId: null })}
              className="w-full mt-4 py-3 rounded-xl text-sm font-medium active:opacity-70"
              style={{ backgroundColor: `${NUTRITION_COLOR}1a`, color: NUTRITION_COLOR }}
            >
              + Создать свой продукт (Пятёрочка, Лавка, ресторан…)
            </button>

            {!results && mine.length > 0 && (
              <>
                <div className="text-xs text-tg-hint mt-5 mb-2 px-1">Мои продукты</div>
                <div className="flex flex-col gap-1.5">
                  {mine.map((f) => (
                    <FoodRow
                      key={f.id}
                      food={f}
                      favorite={isFav(f)}
                      onStar={() => star(f)}
                      onClick={() => setPicked(f)}
                      onEdit={() => navigate('food-product', { foodId: f.id })}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <AgentLogPanel date={date} meal={foodMeal} onDone={back} />
        )}
      </div>

      <PortionSheet
        target={target}
        confirmLabel="Добавить"
        favorite={picked ? isFav(picked) : false}
        onToggleFavorite={picked ? () => star(picked) : undefined}
        onClose={() => setPicked(null)}
        onConfirm={async (grams, meal) => {
          if (!picked) return;
          const entry = await addEntry({ date, meal, grams, foodId: picked.id });
          if (entry) {
            setPicked(null);
            back();
          }
        }}
      />
    </motion.div>
  );
}

function FoodRow({
  food,
  favorite,
  onStar,
  onClick,
  onEdit,
}: {
  food: Food;
  favorite: boolean;
  onStar: () => void;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center bg-tg-section rounded-xl">
      <button onClick={onClick} className="flex-1 min-w-0 px-4 py-2.5 text-left active:opacity-70">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-tg-text truncate">{food.name}</span>
          <span
            className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
            style={
              food.own
                ? { backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }
                : { backgroundColor: 'rgba(128,128,128,0.15)', color: 'var(--tg-theme-hint-color)' }
            }
          >
            {foodSourceLabel(food)}
          </span>
        </div>
        <div className="text-xs text-tg-hint truncate">
          {food.brand ? `${food.brand} · ` : ''}
          {fmt(food.kcal)} ккал · Б {fmt(food.protein, 1)} · Ж {fmt(food.fat, 1)} · У {fmt(food.carbs, 1)} на 100 г
        </div>
      </button>
      <FavoriteStar active={favorite} onToggle={onStar} />
      {onEdit && (
        <button onClick={onEdit} className="px-3 py-2 text-tg-hint active:opacity-60" aria-label="Изменить">
          ✏️
        </button>
      )}
    </div>
  );
}
