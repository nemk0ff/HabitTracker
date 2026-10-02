import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { MEALS, NUTRITION_COLOR, MACRO_COLORS, fmt, scaleMacros } from '../../utils/nutrition';
import { haptic } from '../../hooks/useTelegramButtons';
import { FavoriteStar } from './FavoriteStar';
import type { Macros, Meal, Serving } from '../../types';

export interface PortionTarget {
  title: string;
  subtitle?: string | null;
  /** Macros per 100 g. */
  per100: Macros;
  servings: Serving[];
  grams: number;
  meal: Meal;
}

interface Props {
  target: PortionTarget | null;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (grams: number, meal: Meal) => void | Promise<void>;
  /** Shown in edit mode. */
  onDelete?: () => void;
  /** Star in the header when provided. Kept outside `target` so toggling doesn't reset the inputs. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
}

const QUICK_GRAMS = [50, 100, 150, 200, 300];

export function PortionSheet({ target, confirmLabel, onClose, onConfirm, onDelete, favorite, onToggleFavorite }: Props) {
  const [gramsText, setGramsText] = useState('100');
  const [meal, setMeal] = useState<Meal>('breakfast');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setGramsText(String(Math.round(target.grams)));
      setMeal(target.meal);
      setBusy(false);
    }
  }, [target]);

  const grams = Number(gramsText.replace(',', '.'));
  const valid = Number.isFinite(grams) && grams > 0 && grams <= 5000;
  const m = target && valid ? scaleMacros(target.per100, grams) : { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  const confirm = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(grams, meal);
      haptic('success');
    } finally {
      setBusy(false);
    }
  };

  const chips: Serving[] = [
    ...(target?.servings ?? []),
    ...QUICK_GRAMS.filter((g) => !target?.servings.some((s) => s.grams === g)).map((g) => ({ label: `${g} г`, grams: g })),
  ];

  return (
    <BottomSheet open={!!target} onClose={onClose}>
      {target && (
        <>
          <div className="flex items-start gap-2">
            <h2 className="flex-1 text-lg font-bold text-tg-text leading-tight">{target.title}</h2>
            {onToggleFavorite && <FavoriteStar active={!!favorite} onToggle={onToggleFavorite} className="-mt-1 -mr-2" />}
          </div>
          {target.subtitle && <p className="text-xs text-tg-hint mt-0.5">{target.subtitle}</p>}
          <p className="text-xs text-tg-hint mt-1">
            На 100 г: {fmt(target.per100.kcal)} ккал · Б {fmt(target.per100.protein, 1)} · Ж {fmt(target.per100.fat, 1)} · У{' '}
            {fmt(target.per100.carbs, 1)}
          </p>

          {/* Grams */}
          <div className="flex items-center gap-3 mt-5">
            <input
              type="text"
              inputMode="decimal"
              value={gramsText}
              onChange={(e) => setGramsText(e.target.value.replace(/[^\d.,]/g, ''))}
              onFocus={(e) => e.target.select()}
              className="w-28 px-4 py-3 rounded-xl bg-tg-secondary text-tg-text text-2xl font-bold text-center outline-none"
            />
            <span className="text-tg-hint text-lg">грамм</span>
          </div>

          <div className="flex gap-2 overflow-x-auto mt-3 pb-1 -mx-1 px-1">
            {chips.map((s) => (
              <button
                key={`${s.label}-${s.grams}`}
                onClick={() => {
                  setGramsText(String(s.grams));
                  haptic('select');
                }}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-tg-secondary text-tg-text active:opacity-70"
                style={grams === s.grams ? { backgroundColor: NUTRITION_COLOR, color: '#fff' } : undefined}
              >
                {s.label.endsWith(' г') ? s.label : `${s.label} · ${s.grams} г`}
              </button>
            ))}
          </div>

          {/* Live macros */}
          <div className="grid grid-cols-4 gap-2 mt-5">
            {[
              { label: 'ккал', value: fmt(m.kcal), color: NUTRITION_COLOR },
              { label: 'белки', value: fmt(m.protein, 1), color: MACRO_COLORS.protein },
              { label: 'жиры', value: fmt(m.fat, 1), color: MACRO_COLORS.fat },
              { label: 'углев.', value: fmt(m.carbs, 1), color: MACRO_COLORS.carbs },
            ].map((c) => (
              <div key={c.label} className="bg-tg-secondary rounded-xl py-2 text-center">
                <div className="text-base font-bold" style={{ color: c.color }}>{c.value}</div>
                <div className="text-[10px] text-tg-hint">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Meal */}
          <div className="grid grid-cols-4 gap-2 mt-5">
            {MEALS.map((x) => (
              <button
                key={x.key}
                onClick={() => {
                  setMeal(x.key);
                  haptic('select');
                }}
                className="py-2 rounded-xl text-xs font-medium transition-colors"
                style={{
                  backgroundColor: meal === x.key ? `${NUTRITION_COLOR}22` : 'rgba(128,128,128,0.1)',
                  color: meal === x.key ? NUTRITION_COLOR : 'var(--tg-theme-text-color)',
                }}
              >
                <div className="text-base">{x.icon}</div>
                {x.label}
              </button>
            ))}
          </div>

          <button
            onClick={confirm}
            disabled={!valid || busy}
            className="w-full mt-6 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 transition-opacity disabled:opacity-40"
            style={{ backgroundColor: NUTRITION_COLOR }}
          >
            {busy ? '...' : confirmLabel}
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              className="w-full mt-2 py-3 rounded-xl text-sm font-medium text-tg-destructive active:opacity-70"
            >
              Удалить запись
            </button>
          )}
        </>
      )}
    </BottomSheet>
  );
}
