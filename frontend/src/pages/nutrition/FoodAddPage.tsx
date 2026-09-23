import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { PortionSheet, type PortionTarget } from '../../components/nutrition/PortionSheet';
import { ParsedItemsPreview } from '../../components/nutrition/ParsedItemsPreview';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { fetchMyFoods, parseText, searchFoods } from '../../api/nutrition';
import { NUTRITION_COLOR, fmt, foodSourceLabel, mealLabel, sumMacros, MEALS } from '../../utils/nutrition';
import type { Food, Meal, ParsedItem } from '../../types';

type Tab = 'search' | 'text';

/** Demo draft for the text tab until the LLM parser (stage 2) is live. */
const DEMO_TEXT = '200 г куриной грудки и 150 г варёных макарон';
const DEMO_ITEMS: ParsedItem[] = [
  { name: 'Куриная грудка отварная', grams: 200, kcal: 274, protein: 59.6, fat: 3.6, carbs: 1, foodId: null, estimated: false },
  { name: 'Макароны варёные', grams: 150, kcal: 237, protein: 8.7, fat: 1.4, carbs: 46.4, foodId: null, estimated: false },
];

export function FoodAddPage() {
  const { foodDate: date, foodMeal, navigate } = useNavStore();
  const { recent, loadRecent, addEntry, addEntries } = useNutritionStore();

  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [mine, setMine] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParsedItem[]>([]);
  const [draftMeal, setDraftMeal] = useState<Meal>(foodMeal);

  const back = () => navigate('food-day');
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

  const runParse = async () => {
    const t = text.trim();
    if (!t) return;
    setParsing(true);
    setParseNote(null);
    try {
      const { items } = await parseText(t);
      setDraft(items);
      if (items.length === 0) setParseNote('Не удалось ничего распознать');
    } catch (e: any) {
      setParseNote(e.message || 'Ошибка разбора');
      setDraft([]);
    } finally {
      setParsing(false);
    }
  };

  const addDraft = async () => {
    await addEntries(
      draft
        .filter((it) => it.grams > 0)
        .map((it) =>
          it.foodId
            ? { date, meal: draftMeal, grams: it.grams, foodId: it.foodId }
            : {
                date,
                meal: draftMeal,
                grams: it.grams,
                name: it.name,
                kcal: it.kcal,
                protein: it.protein,
                fat: it.fat,
                carbs: it.carbs,
                source: 'llm' as const,
              },
        ),
    );
    haptic('success');
    back();
  };

  const list = results ?? recent;
  const draftTotal = sumMacros(draft);

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <h1 className="text-xl font-bold text-tg-text mb-3">Добавить: {mealLabel(foodMeal).toLowerCase()}</h1>

        {/* Tabs */}
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

        {tab === 'search' ? (
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
                <FoodRow key={f.id} food={f} onClick={() => setPicked(f)} />
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
                    <FoodRow key={f.id} food={f} onClick={() => setPicked(f)} onEdit={() => navigate('food-product', { foodId: f.id })} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Опиши, что съел. Например: «${DEMO_TEXT}»`}
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none resize-none placeholder:text-tg-hint"
            />
            <button
              onClick={runParse}
              disabled={!text.trim() || parsing}
              className="w-full mt-2 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: NUTRITION_COLOR }}
            >
              {parsing ? 'Разбираю…' : 'Разобрать'}
            </button>

            {parseNote && (
              <div className="mt-3 rounded-xl bg-tg-section px-4 py-3 text-sm text-tg-hint">
                {parseNote}
                {draft.length === 0 && (
                  <button
                    onClick={() => {
                      setText(DEMO_TEXT);
                      setDraft(DEMO_ITEMS);
                      setParseNote(null);
                    }}
                    className="block mt-2 font-medium"
                    style={{ color: NUTRITION_COLOR }}
                  >
                    Показать, как это будет работать →
                  </button>
                )}
              </div>
            )}

            {draft.length > 0 && (
              <div className="mt-4">
                <ParsedItemsPreview items={draft} onChange={setDraft} />

                <div className="grid grid-cols-4 gap-2 mt-3">
                  {MEALS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setDraftMeal(m.key)}
                      className="py-2 rounded-xl text-xs font-medium"
                      style={{
                        backgroundColor: draftMeal === m.key ? `${NUTRITION_COLOR}22` : 'rgba(128,128,128,0.1)',
                        color: draftMeal === m.key ? NUTRITION_COLOR : 'var(--tg-theme-text-color)',
                      }}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={addDraft}
                  className="w-full mt-3 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80"
                  style={{ backgroundColor: NUTRITION_COLOR }}
                >
                  Добавить всё · {fmt(draftTotal.kcal)} ккал
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <PortionSheet
        target={target}
        confirmLabel="Добавить"
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

function FoodRow({ food, onClick, onEdit }: { food: Food; onClick: () => void; onEdit?: () => void }) {
  return (
    <div className="flex items-center bg-tg-section rounded-xl">
      <button onClick={onClick} className="flex-1 min-w-0 px-4 py-2.5 text-left active:opacity-70">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-tg-text truncate">{food.name}</span>
          <span
            className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={
              food.own
                ? { backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }
                : { backgroundColor: 'rgba(128,128,128,0.15)', color: 'var(--tg-theme-hint-color)' }
            }
          >
            {foodSourceLabel(food)}
          </span>
        </div>
        <div className="text-[11px] text-tg-hint truncate">
          {food.brand ? `${food.brand} · ` : ''}
          {fmt(food.kcal)} ккал · Б {fmt(food.protein, 1)} · Ж {fmt(food.fat, 1)} · У {fmt(food.carbs, 1)} на 100 г
        </div>
      </button>
      {onEdit && (
        <button onClick={onEdit} className="px-3 py-2 text-tg-hint active:opacity-60" aria-label="Изменить">
          ✏️
        </button>
      )}
    </div>
  );
}
