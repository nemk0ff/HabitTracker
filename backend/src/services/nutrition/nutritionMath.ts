export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** ~7700 kcal of surplus ≈ 1 kg of body weight (rule of thumb). */
export const KCAL_PER_KG = 7700;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Scale per-100g macros to a given weight. */
export function scaleMacros(per100: Macros, grams: number): Macros {
  const k = grams / 100;
  return {
    kcal: round1(per100.kcal * k),
    protein: round1(per100.protein * k),
    fat: round1(per100.fat * k),
    carbs: round1(per100.carbs * k),
  };
}

export function sumMacros(items: Macros[]): Macros {
  const total = items.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: acc.protein + m.protein,
      fat: acc.fat + m.fat,
      carbs: acc.carbs + m.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
  return {
    kcal: round1(total.kcal),
    protein: round1(total.protein),
    fat: round1(total.fat),
    carbs: round1(total.carbs),
  };
}

/**
 * Lower-case + ё→е + collapsed spaces. SQLite LIKE is case-insensitive only for
 * ASCII, so Cyrillic search goes through this on both write and query.
 */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Poor man's Russian stemming for search: drop the inflected ending so that
 * "курица" also matches "куриная", "гречку" matches "гречка".
 */
export function searchStems(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length >= 6 ? w.slice(0, -2) : w.length >= 4 ? w.slice(0, -1) : w));
}
