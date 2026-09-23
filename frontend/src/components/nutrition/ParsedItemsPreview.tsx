import { NUTRITION_COLOR, fmt } from '../../utils/nutrition';
import type { ParsedItem } from '../../types';

interface Props {
  items: ParsedItem[];
  onChange: (items: ParsedItem[]) => void;
}

/**
 * Editable draft of items parsed from free text (LLM, stage 2). Nothing is
 * written to the diary until the user confirms; changing grams rescales macros.
 */
export function ParsedItemsPreview({ items, onChange }: Props) {
  const setGrams = (i: number, text: string) => {
    const grams = Number(text.replace(',', '.'));
    if (!Number.isFinite(grams) || grams < 0) return;
    onChange(
      items.map((it, j) => {
        if (j !== i) return it;
        const k = it.grams > 0 ? grams / it.grams : 0;
        return {
          ...it,
          grams,
          kcal: it.kcal * k,
          protein: it.protein * k,
          fat: it.fat * k,
          carbs: it.carbs * k,
        };
      }),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="bg-tg-section rounded-xl px-3 py-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-tg-text truncate">
              {it.name}
              {it.estimated && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full align-middle" style={{ backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }}>
                  оценка
                </span>
              )}
            </div>
            <div className="text-[11px] text-tg-hint">
              {fmt(it.kcal)} ккал · Б {fmt(it.protein, 1)} · Ж {fmt(it.fat, 1)} · У {fmt(it.carbs, 1)}
            </div>
          </div>
          <input
            type="text"
            inputMode="decimal"
            defaultValue={String(Math.round(it.grams))}
            onBlur={(e) => setGrams(i, e.target.value)}
            className="w-16 px-2 py-1.5 rounded-lg bg-tg-secondary text-tg-text text-sm text-center outline-none"
          />
          <span className="text-xs text-tg-hint -ml-2">г</span>
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="w-7 h-7 flex items-center justify-center rounded-full text-tg-hint active:opacity-60"
            aria-label="Убрать"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
