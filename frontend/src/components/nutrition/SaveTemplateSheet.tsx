import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { pluralForm } from '../../utils/plural';
import { NUTRITION_COLOR, fmt, mealLabel } from '../../utils/nutrition';
import type { FoodLogEntry, Meal } from '../../types';

interface Props {
  /** Meal being saved; null = closed. */
  meal: Meal | null;
  entries: FoodLogEntry[];
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
}

export function defaultTemplateName(meal: Meal): string {
  return `Мой ${mealLabel(meal).toLowerCase()}`;
}

const MAX_NAME = 40;

/** Name prompt for «Сохранить как набор» — saves the meal's current entries. */
export function SaveTemplateSheet({ meal, entries, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (meal) setName(defaultTemplateName(meal));
  }, [meal]);

  const kcal = entries.reduce((s, e) => s + e.kcal, 0);
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (await onSave(trimmed)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={meal !== null} onClose={onClose}>
      <h2 className="text-lg font-bold text-tg-text">Сохранить как набор</h2>
      <p className="text-xs text-tg-hint mt-0.5">
        {entries.length} {pluralForm(entries.length, 'продукт', 'продукта', 'продуктов')} · {fmt(kcal)} ккал — потом добавишь одним тапом
      </p>
      <input
        autoFocus
        value={name}
        maxLength={MAX_NAME}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Название набора"
        className="w-full mt-4 px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint"
      />
      <div className="text-xs text-tg-hint mt-2 px-1 line-clamp-2">{entries.map((e) => e.name).join(', ')}</div>
      <button
        onClick={save}
        disabled={!trimmed || busy}
        className="w-full mt-4 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: NUTRITION_COLOR }}
      >
        {busy ? '…' : 'Сохранить'}
      </button>
    </BottomSheet>
  );
}
