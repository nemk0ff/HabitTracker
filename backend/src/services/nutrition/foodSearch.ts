import type { Food } from '@prisma/client';
import { prisma } from '../../db.js';
import { normalizeSearch, searchStems } from './nutritionMath.js';

const OFF_SEARCH_URL = 'https://search.openfoodfacts.org/search';
const OFF_TIMEOUT_MS = 3000;
const LOCAL_LIMIT = 30;
/** Go online to Open Food Facts only when the local catalog has fewer hits than this. */
const ONLINE_THRESHOLD = 5;

export interface Serving {
  label: string;
  grams: number;
}

export function parseServings(raw: string | null): Serving[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Ids of the user's starred foods. */
export async function favoriteIds(userId: number): Promise<Set<number>> {
  const rows = await prisma.favoriteFood.findMany({ where: { userId }, select: { foodId: true } });
  return new Set(rows.map((r) => r.foodId));
}

/** `own`: the viewer's own product (base catalog and Open Food Facts rows have no owner). */
export function serializeFood(f: Food, favIds: Set<number> | undefined, viewerId: number) {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    source: f.source,
    sourceUrl: f.sourceUrl,
    kcal: f.kcal,
    protein: f.protein,
    fat: f.fat,
    carbs: f.carbs,
    servings: parseServings(f.servings),
    own: f.ownerId === viewerId,
    favorite: favIds?.has(f.id) ?? false,
  };
}

/** Foods visible to a user: base catalog (ownerId null) + their own. */
export function visibleTo(userId: number) {
  return { OR: [{ ownerId: null }, { ownerId: userId }] };
}

/** True when `stem` starts a word in `text` ("кол" starts "кола", not "шоколад"). */
function atWordStart(text: string, stem: string): boolean {
  let i = text.indexOf(stem);
  while (i >= 0) {
    if (i === 0 || !/[a-zа-я0-9]/.test(text[i - 1]!)) return true;
    i = text.indexOf(stem, i + 1);
  }
  return false;
}

async function searchLocal(userId: number, q: string): Promise<Food[]> {
  if (!q) return [];
  const stems = searchStems(q);
  const rows = await prisma.food.findMany({
    where: {
      AND: [visibleTo(userId), ...stems.map((w) => ({ searchName: { contains: w } }))],
    },
    take: 200,
  });

  // Word-start matches dominate, so own products don't outrank a real match just
  // because the stem appears mid-word ("кола" vs "шоколад").
  const score = (f: Food) =>
    stems.filter((s) => atWordStart(f.searchName, s)).length * 400 +
    (f.searchName.startsWith(q) ? 300 : f.searchName.startsWith(stems[0]!) ? 150 : 0) +
    (f.ownerId === userId ? 200 : 0) +
    (f.source === 'seed' ? 50 : 0) +
    Math.min(f.usageCount, 100) * 5 -
    f.searchName.length;

  return rows.sort((a, b) => score(b) - score(a)).slice(0, LOCAL_LIMIT);
}

interface OffHit {
  code?: string;
  product_name?: string;
  product_name_ru?: string;
  brands?: string[] | string;
  countries_tags?: string[];
  nutriments?: Record<string, number>;
}

function hasMacros(n: Record<string, number> | undefined): n is Record<string, number> {
  return (
    !!n &&
    typeof n['energy-kcal_100g'] === 'number' &&
    typeof n['proteins_100g'] === 'number' &&
    typeof n['fat_100g'] === 'number' &&
    typeof n['carbohydrates_100g'] === 'number'
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Query Open Food Facts (Search-a-licious) and cache usable hits as Food(source='off'). */
async function searchOpenFoodFacts(q: string): Promise<Food[]> {
  const stems = searchStems(normalizeSearch(q));
  const params = new URLSearchParams({
    q,
    langs: 'ru',
    page_size: '25',
    fields: 'code,product_name,product_name_ru,brands,nutriments,countries_tags',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  let hits: OffHit[] = [];
  try {
    const res = await fetch(`${OFF_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': 'HabitTracker/1.0 (Telegram Mini App)' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { hits?: OffHit[] };
    hits = body.hits ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const isRu = (h: OffHit) => Number(h.countries_tags?.includes('en:russia') ?? false);
  // OFF matches loosely on multi-word queries; keep only hits containing every stem.
  const matches = (h: OffHit) => {
    const brand = Array.isArray(h.brands) ? h.brands.join(' ') : h.brands ?? '';
    const text = normalizeSearch(`${h.product_name_ru ?? ''} ${h.product_name ?? ''} ${brand}`);
    return stems.every((w) => text.includes(w));
  };
  const usable = hits
    .filter((h) => h.code && (h.product_name_ru || h.product_name) && hasMacros(h.nutriments) && matches(h))
    .sort((a, b) => isRu(b) - isRu(a))
    .slice(0, 10);

  const saved: Food[] = [];
  for (const h of usable) {
    const n = h.nutriments!;
    const name = decodeEntities((h.product_name_ru || h.product_name)!).trim().slice(0, 120);
    const brandRaw = Array.isArray(h.brands) ? h.brands[0] : h.brands?.split(',')[0];
    const brand = brandRaw ? decodeEntities(brandRaw).trim() || null : null;
    const data = {
      name,
      searchName: normalizeSearch(`${name} ${brand ?? ''}`),
      brand,
      kcal: Math.round(n['energy-kcal_100g']),
      protein: Math.round(n['proteins_100g'] * 10) / 10,
      fat: Math.round(n['fat_100g'] * 10) / 10,
      carbs: Math.round(n['carbohydrates_100g'] * 10) / 10,
      sourceUrl: `https://world.openfoodfacts.org/product/${h.code}`,
    };
    try {
      saved.push(
        await prisma.food.upsert({
          where: { source_externalId: { source: 'off', externalId: h.code! } },
          update: data,
          create: { ...data, source: 'off', externalId: h.code! },
        }),
      );
    } catch {
      // a single bad row shouldn't break search
    }
  }
  return saved;
}

/** Local catalog only (seed + own + cached), best match first. No network. */
export function searchLocalFoods(userId: number, rawQuery: string): Promise<Food[]> {
  return searchLocal(userId, normalizeSearch(rawQuery));
}

export async function searchFoods(userId: number, rawQuery: string) {
  const q = normalizeSearch(rawQuery);
  if (q.length < 2) return [];

  const [local, favs] = await Promise.all([searchLocal(userId, q), favoriteIds(userId)]);
  if (local.length >= ONLINE_THRESHOLD) return local.map((f) => serializeFood(f, favs, userId));

  const online = await searchOpenFoodFacts(rawQuery.trim());
  const seen = new Set(local.map((f) => f.id));
  return [...local, ...online.filter((f) => !seen.has(f.id))].map((f) => serializeFood(f, favs, userId));
}

/** Recently eaten foods of a user (most recent first), for the empty search state. */
export async function recentFoods(userId: number) {
  const recent = await prisma.foodLogEntry.findMany({
    where: { userId, foodId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { foodId: true },
    take: 100,
  });
  const ids = [...new Set(recent.map((r) => r.foodId!))].slice(0, 20);
  const [foods, favs] = await Promise.all([prisma.food.findMany({ where: { id: { in: ids } } }), favoriteIds(userId)]);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return ids
    .map((id) => byId.get(id))
    .filter((f): f is Food => !!f)
    .map((f) => serializeFood(f, favs, userId));
}
