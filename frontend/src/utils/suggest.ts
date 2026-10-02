/**
 * "Что доесть": which favorite foods can close the rest of today's КБЖУ.
 * Pure functions (no React) — covered by a tsx script in the plan's checks.
 */
import type { Food, Macros } from '../types';

export type Fit = 'fits' | 'tooCaloric' | 'tooLight';

export interface Remaining extends Macros {
  /** fat/carbs are only targeted when the goal sets them. */
  hasFat: boolean;
  hasCarbs: boolean;
}

export interface Suggestion {
  food: Food;
  fit: Fit;
  /** Grams that close the remaining kcal (rounded to the food's step, capped at 3 portions). */
  grams: number;
  portionGrams: number;
  /** Macros for `grams`. */
  gives: Macros;
}

export interface Combo {
  items: { food: Food; grams: number }[];
  total: Macros;
}

/** Below this the day counts as closed. */
export const DONE_KCAL = 50;
const OVERSHOOT = 1.15;
const MAX_PORTIONS = 3;
/** "Мало калорий": even 3 portions give less than this share of the gap (and < LIGHT_KCAL). */
const LIGHT_SHARE = 0.25;
const LIGHT_KCAL = 200;
const PROTEIN_MATTERS_G = 10;
const COMBO_POOL = 12;
const COMBO_STEPS = 6;
const COMBO_MAX_ERROR = 0.25;

export function remainingOf(target: Partial<Macros> & { kcal: number }, eaten: Macros): Remaining {
  const left = (t: number | null | undefined, e: number) => (t ? Math.max(0, t - e) : 0);
  return {
    kcal: Math.max(0, target.kcal - eaten.kcal),
    protein: left(target.protein, eaten.protein),
    fat: left(target.fat, eaten.fat),
    carbs: left(target.carbs, eaten.carbs),
    hasFat: !!target.fat,
    hasCarbs: !!target.carbs,
  };
}

function portionOf(f: Food): number {
  return f.servings[0]?.grams ?? 100;
}

/** Half a portion for foods with servings ("½ упаковки"), else 10 g. */
function stepOf(f: Food): number {
  return f.servings[0] ? f.servings[0].grams / 2 : 10;
}

function macrosFor(f: Food, grams: number): Macros {
  const k = grams / 100;
  return { kcal: f.kcal * k, protein: f.protein * k, fat: f.fat * k, carbs: f.carbs * k };
}

export function classify(f: Food, r: Remaining): Suggestion {
  const portionGrams = portionOf(f);
  const needG = f.kcal > 0 ? (r.kcal / f.kcal) * 100 : Infinity;
  let fit: Fit = 'fits';
  if (r.kcal <= DONE_KCAL || macrosFor(f, portionGrams).kcal > r.kcal * OVERSHOOT) fit = 'tooCaloric';
  // A food doesn't have to close the whole gap alone (it can be part of the set) —
  // it's "too light" only when a realistic amount barely moves the needle (cucumbers).
  else if (macrosFor(f, MAX_PORTIONS * portionGrams).kcal < Math.min(r.kcal * LIGHT_SHARE, LIGHT_KCAL)) fit = 'tooLight';

  const step = stepOf(f);
  const capped = Math.min(Number.isFinite(needG) ? needG : 0, MAX_PORTIONS * portionGrams);
  const grams = Math.max(step, Math.round(capped / step) * step);
  return { food: f, fit, grams, portionGrams, gives: macrosFor(f, grams) };
}

const FIT_ORDER: Record<Fit, number> = { fits: 0, tooLight: 1, tooCaloric: 2 };

/** Fitting foods first — by protein per kcal when protein is still short, else by closeness to the kcal gap. */
export function suggest(favorites: Food[], r: Remaining): Suggestion[] {
  const proteinShort = r.protein > PROTEIN_MATTERS_G;
  return favorites
    .map((f) => classify(f, r))
    .sort((a, b) => {
      if (a.fit !== b.fit) return FIT_ORDER[a.fit] - FIT_ORDER[b.fit];
      if (proteinShort) return b.food.protein / (b.food.kcal || 1) - a.food.protein / (a.food.kcal || 1);
      return Math.abs(a.gives.kcal - r.kcal) - Math.abs(b.gives.kcal - r.kcal);
    });
}

/** Relative miss vs the remaining macros; kcal overshoot hurts twice as much as undershoot. */
function comboError(t: Macros, r: Remaining, items: number): number {
  const rel = (got: number, want: number) => (want > 0 ? (got - want) / want : 0);
  const k = rel(t.kcal, r.kcal);
  let err = k > 0 ? 2 * k : -k;
  if (r.protein > PROTEIN_MATTERS_G) err += Math.abs(rel(t.protein, r.protein));
  if (r.hasFat) err += 0.5 * Math.abs(rel(t.fat, r.fat));
  if (r.hasCarbs) err += 0.5 * Math.abs(rel(t.carbs, r.carbs));
  return err + 0.03 * items;
}

/**
 * Best set of 1–3 fitting favorites (amounts in 0–6 half-portion / 50 g steps)
 * for the remaining macros, or null when nothing lands within ±25% of the kcal gap.
 */
export function bestCombo(suggestions: Suggestion[], r: Remaining): Combo | null {
  if (r.kcal <= DONE_KCAL) return null;
  const pool = suggestions.filter((s) => s.fit === 'fits').slice(0, COMBO_POOL).map((s) => s.food);
  if (pool.length === 0) return null;

  const unit = (f: Food) => (f.servings[0] ? f.servings[0].grams / 2 : 50);
  let best: { err: number; items: { food: Food; grams: number }[]; total: Macros } | null = null;

  const consider = (foods: Food[], steps: number[]) => {
    const items = foods.map((food, i) => ({ food, grams: steps[i]! * unit(food) })).filter((i) => i.grams > 0);
    if (items.length === 0) return;
    const total = items.reduce<Macros>(
      (a, i) => {
        const m = macrosFor(i.food, i.grams);
        return { kcal: a.kcal + m.kcal, protein: a.protein + m.protein, fat: a.fat + m.fat, carbs: a.carbs + m.carbs };
      },
      { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    );
    const err = comboError(total, r, items.length);
    if (!best || err < best.err) best = { err, items, total };
  };

  const n = pool.length;
  for (let a = 0; a < n; a++) {
    for (let sa = 1; sa <= COMBO_STEPS; sa++) consider([pool[a]!], [sa]);
    for (let b = a + 1; b < n; b++) {
      for (let sa = 1; sa <= COMBO_STEPS; sa++)
        for (let sb = 1; sb <= COMBO_STEPS; sb++) consider([pool[a]!, pool[b]!], [sa, sb]);
      for (let c = b + 1; c < n; c++)
        for (let sa = 1; sa <= COMBO_STEPS; sa++)
          for (let sb = 1; sb <= COMBO_STEPS; sb++)
            for (let sc = 1; sc <= COMBO_STEPS; sc++) consider([pool[a]!, pool[b]!, pool[c]!], [sa, sb, sc]);
    }
  }

  const found = best as { err: number; items: { food: Food; grams: number }[]; total: Macros } | null;
  if (!found || Math.abs(found.total.kcal - r.kcal) / r.kcal > COMBO_MAX_ERROR) return null;
  return { items: found.items, total: found.total };
}
