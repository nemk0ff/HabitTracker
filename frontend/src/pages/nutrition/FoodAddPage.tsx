import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { AgentLogPanel } from '../../components/nutrition/AgentLogPanel';
import { FavoriteStar } from '../../components/nutrition/FavoriteStar';
import { useAuthStore } from '../../stores/authStore';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { fetchMyFoods, searchFoods } from '../../api/nutrition';
import { NUTRITION_COLOR, fmt, foodSourceLabel, mealLabel } from '../../utils/nutrition';
import type { Food, MealTemplate } from '../../types';

type Tab = 'search' | 'templates' | 'text';

export function FoodAddPage() {
  const { foodDate: date, foodMeal, navigate } = useNavStore();
  const { recent, loadRecent, addEntry, toggleFavorite, templates, templatesLoaded, loadTemplates, applyTemplate, deleteTemplate } =
    useNutritionStore();
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
    loadTemplates();
  }, [loadTemplates]);

  const [applying, setApplying] = useState(false);
  const addTemplate = async (t: MealTemplate) => {
    if (applying) return;
    setApplying(true);
    const created = await applyTemplate(t.id, date, foodMeal);
    setApplying(false);
    if (created.length > 0) {
      haptic('success');
      back();
    } else {
      haptic('warning');
    }
  };

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
          <div className="flex bg-tg-section rounded-xl p-1 mb-4">
            {(
              [
                ['search', '🔍 Поиск'],
                ['templates', templates.length ? `🍽 Наборы · ${templates.length}` : '🍽 Наборы'],
                ...(agentLog ? [['text', '✨ Текстом']] : []),
              ] as [Tab, string][]
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

        {tab === 'templates' ? (
          <TemplatesList
            templates={templates}
            loaded={templatesLoaded}
            disabled={applying}
            onPick={addTemplate}
            onDelete={(t) => {
              deleteTemplate(t.id);
              haptic('medium');
            }}
          />
        ) : tab === 'search' || !agentLog ? (
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

function TemplatesList({
  templates,
  loaded,
  disabled,
  onPick,
  onDelete,
}: {
  templates: MealTemplate[];
  loaded: boolean;
  disabled: boolean;
  onPick: (t: MealTemplate) => void;
  onDelete: (t: MealTemplate) => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

  if (!loaded) return <p className="text-sm text-tg-hint text-center py-6">Загружаю…</p>;
  if (templates.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <div className="text-3xl mb-2" aria-hidden>
          🍽
        </div>
        <p className="text-sm text-tg-text">Ешь одно и то же? Сохрани приём как набор — потом одним тапом</p>
        <p className="text-xs text-tg-hint mt-2">
          В дневнике у приёма пищи с двумя и больше продуктами есть кнопка «Сохранить как набор»
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {templates.map((t) =>
        confirmId === t.id ? (
          <div key={t.id} className="flex items-center gap-2 bg-tg-section rounded-xl pl-4 pr-1.5 py-1.5">
            <span className="flex-1 min-w-0 text-sm text-tg-text truncate">Удалить «{t.name}»?</span>
            <button
              onClick={() => setConfirmId(null)}
              className="min-h-[40px] px-3 rounded-lg text-sm text-tg-text active:opacity-60"
            >
              Нет
            </button>
            <button
              onClick={() => {
                setConfirmId(null);
                onDelete(t);
              }}
              className="min-h-[40px] px-3 rounded-lg text-sm font-medium text-white active:opacity-80"
              style={{ backgroundColor: 'var(--tg-theme-destructive-text-color, #e5484d)' }}
            >
              Удалить
            </button>
          </div>
        ) : (
          <div key={t.id} className="flex items-center bg-tg-section rounded-xl">
            <button
              onClick={() => onPick(t)}
              disabled={disabled}
              className="flex-1 min-w-0 px-4 py-2.5 text-left active:opacity-70 disabled:opacity-50"
            >
              <div className="flex items-baseline gap-2">
                <span className="flex-1 min-w-0 text-sm font-medium text-tg-text truncate">{t.name}</span>
                <span className="shrink-0 text-sm text-tg-text">{fmt(t.totals.kcal)} ккал</span>
              </div>
              <div className="text-xs text-tg-hint line-clamp-2">
                {t.items.map((i) => `${i.name} ${fmt(i.grams)} г`).join(' · ')}
              </div>
              <div className="text-xs text-tg-hint">
                Б {fmt(t.totals.protein)} · Ж {fmt(t.totals.fat)} · У {fmt(t.totals.carbs)}
              </div>
            </button>
            <button
              onClick={() => setConfirmId(t.id)}
              aria-label={`Удалить набор «${t.name}»`}
              className="w-11 h-11 shrink-0 flex items-center justify-center text-tg-hint active:opacity-60"
            >
              <Trash2 size={18} aria-hidden />
            </button>
          </div>
        ),
      )}
    </div>
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
