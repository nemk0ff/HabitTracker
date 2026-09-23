import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavStore } from '../../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { createFood, deleteFood, fetchMyFoods, updateFood } from '../../api/nutrition';
import { NUTRITION_COLOR, round } from '../../utils/nutrition';
import type { Serving } from '../../types';

const STORES = ['Пятёрочка', 'Яндекс Лавка', 'ВкусВилл', 'Самокат', 'Ресторан'];

type Basis = '100g' | 'portion';

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

export function FoodProductFormPage() {
  const { foodId, navigate } = useNavStore();
  const isEdit = foodId !== null;

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [url, setUrl] = useState('');
  const [basis, setBasis] = useState<Basis>('100g');
  const [portionGrams, setPortionGrams] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [servings, setServings] = useState<Serving[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    fetchMyFoods().then((foods) => {
      const f = foods.find((x) => x.id === foodId);
      if (!f) return;
      setName(f.name);
      setBrand(f.brand ?? '');
      setUrl(f.sourceUrl ?? '');
      setKcal(String(f.kcal));
      setProtein(String(f.protein));
      setFat(String(f.fat));
      setCarbs(String(f.carbs));
      setServings(f.servings);
    });
  }, [isEdit, foodId]);

  const back = () => navigate('food-add');

  const values = [kcal, protein, fat, carbs].map(num);
  const pg = num(portionGrams);
  const valid =
    name.trim().length > 0 &&
    values.every((v, i) => [kcal, protein, fat, carbs][i]!.trim() !== '' && Number.isFinite(v) && v >= 0) &&
    (basis === '100g' || (Number.isFinite(pg) && pg > 0));

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    // Stored per 100 g; a per-portion label is converted and the portion kept as a serving.
    const k = basis === 'portion' ? 100 / pg : 1;
    const [kc, p, f, c] = values.map((v) => round(v * k, 1)) as [number, number, number, number];
    const filled = servings
      .map((s) => ({ label: s.label.trim(), grams: s.grams }))
      .filter((s) => s.label && s.grams > 0);
    const allServings =
      basis === 'portion' && !filled.some((s) => s.grams === pg)
        ? [{ label: 'порция', grams: pg }, ...filled]
        : filled;
    const data = {
      name: name.trim(),
      brand: brand.trim() || null,
      sourceUrl: url.trim() || null,
      kcal: kc,
      protein: p,
      fat: f,
      carbs: c,
      servings: allServings,
    };
    try {
      if (isEdit) await updateFood(foodId!, data);
      else await createFood(data);
      haptic('success');
      back();
    } catch (e: any) {
      setError(e.message || 'Не удалось сохранить');
      haptic('error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!isEdit) return;
    await deleteFood(foodId!);
    haptic('medium');
    back();
  };

  useBackButton(back);
  useMainButton(valid ? (isEdit ? 'Сохранить' : 'Создать продукт') : null, save, { progress: saving });

  const field = 'w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint';

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-tg-text">{isEdit ? 'Мой продукт' : 'Новый продукт'}</h1>

        <div>
          <Label>Название</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Сырники с изюмом" className={field} />
        </div>

        <div>
          <Label>Где покупаю</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {STORES.map((s) => (
              <button
                key={s}
                onClick={() => setBrand(brand === s ? '' : s)}
                className="px-3 py-1.5 rounded-full text-xs font-medium"
                style={
                  brand === s
                    ? { backgroundColor: NUTRITION_COLOR, color: '#fff' }
                    : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                }
              >
                {s}
              </button>
            ))}
          </div>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Магазин, ресторан или бренд" className={field} />
        </div>

        <div>
          <Label>Ссылка (необязательно)</Label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://lavka.yandex.ru/…" className={field} />
        </div>

        <div>
          <Label>КБЖУ указано</Label>
          <div className="flex bg-tg-section rounded-xl p-1">
            {(
              [
                ['100g', 'на 100 г'],
                ['portion', 'на порцию'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setBasis(key)}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={basis === key ? { backgroundColor: NUTRITION_COLOR, color: '#fff' } : { color: 'var(--tg-theme-text-color)' }}
              >
                {label}
              </button>
            ))}
          </div>
          {basis === 'portion' && (
            <input
              value={portionGrams}
              onChange={(e) => setPortionGrams(e.target.value)}
              inputMode="decimal"
              placeholder="Вес порции, г"
              className={`${field} mt-2`}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumField label="Калории, ккал" value={kcal} onChange={setKcal} />
          <NumField label="Белки, г" value={protein} onChange={setProtein} />
          <NumField label="Жиры, г" value={fat} onChange={setFat} />
          <NumField label="Углеводы, г" value={carbs} onChange={setCarbs} />
        </div>

        <div>
          <Label>Типовые порции</Label>
          <div className="flex flex-col gap-2">
            {servings.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={s.label}
                  onChange={(e) => setServings(servings.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder="1 шт"
                  className={`${field} flex-1`}
                />
                <input
                  value={String(s.grams)}
                  onChange={(e) => setServings(servings.map((x, j) => (j === i ? { ...x, grams: num(e.target.value) || 0 } : x)))}
                  inputMode="decimal"
                  className={`${field} w-20 text-center`}
                />
                <button onClick={() => setServings(servings.filter((_, j) => j !== i))} className="px-2 text-tg-hint">
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setServings([...servings, { label: '', grams: 100 }])}
              className="text-sm font-medium text-left px-1"
              style={{ color: NUTRITION_COLOR }}
            >
              + Добавить порцию
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-tg-destructive">{error}</p>}

        <button
          onClick={save}
          disabled={!valid || saving}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: NUTRITION_COLOR }}
        >
          {isEdit ? 'Сохранить' : 'Создать продукт'}
        </button>
        {isEdit && (
          <button onClick={remove} className="w-full py-3 rounded-xl text-sm font-medium text-tg-destructive bg-tg-section active:opacity-70">
            Удалить продукт
          </button>
        )}
      </div>
    </motion.div>
  );
}

function Label({ children }: { children: string }) {
  return <div className="text-xs text-tg-hint mb-1.5 px-1">{children}</div>;
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        inputMode="decimal"
        placeholder="0"
        className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint"
      />
    </div>
  );
}
