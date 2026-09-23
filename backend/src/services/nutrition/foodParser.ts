/**
 * Free-text meal parsing ("200г курицы и 150г макарон" → items).
 * Claude splits the text into items with grams; each item is then matched to
 * the user's own products or the local catalog, and only unmatched items fall
 * back to Claude's own estimate (flagged `estimated`).
 */
import { prisma } from '../../db.js';
import { CLAUDE_MODEL, claudeAvailable, getClaude, responseText } from '../claude.js';
import { parseServings, searchLocalFoods } from './foodSearch.js';
import { round1, scaleMacros, type Macros } from './nutritionMath.js';

export interface ParsedItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Matched catalog food, if any. */
  foodId: number | null;
  /** true when the numbers are Claude's estimate rather than a catalog match. */
  estimated: boolean;
}

export interface FoodParser {
  readonly available: boolean;
  parse(text: string, userId: number): Promise<ParsedItem[]>;
}

export class FoodParseError extends Error {}

const SYSTEM_PROMPT = `Ты разбираешь запись пользователя о том, что он съел, для дневника питания.

Раздели текст на отдельные продукты или блюда и для каждого верни:
- name — короткое понятное название на русском ("Куриная грудка отварная", а не "курочка").
- grams — съеденный вес в граммах. Если указаны штуки, порции, ложки или упаковки — переведи в граммы по типичным весам или по порциям из списка продуктов пользователя. Если количество не указано — возьми обычную порцию.
- own_food_id — id из списка "Мои продукты", если продукт явно оттуда (совпадает название, магазин или бренд); иначе null.
- catalog_query — 1–3 слова для поиска в справочнике продуктов, в именительном падеже, с состоянием если важно ("гречка варёная", "яйцо", "куриная грудка отварная").
- kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g — твоя оценка КБЖУ на 100 г (используется, только если продукт не найдётся в справочнике). Для блюд из ресторанов и готовой еды оценивай по типичной рецептуре.

Составное блюдо, где пользователь перечислил ингредиенты с весами ("200 г курицы и 150 г макарон"), разбивай на ингредиенты. Блюдо целиком без весов ингредиентов ("тарелка борща", "шаурма") — одной позицией. Не выдумывай продукты, которых нет в тексте.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          own_food_id: { type: ['integer', 'null'] },
          catalog_query: { type: 'string' },
          kcal_per_100g: { type: 'number' },
          protein_per_100g: { type: 'number' },
          fat_per_100g: { type: 'number' },
          carbs_per_100g: { type: 'number' },
        },
        required: [
          'name',
          'grams',
          'own_food_id',
          'catalog_query',
          'kcal_per_100g',
          'protein_per_100g',
          'fat_per_100g',
          'carbs_per_100g',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

interface RawItem {
  name: string;
  grams: number;
  own_food_id: number | null;
  catalog_query: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function toParsed(name: string, grams: number, per100: Macros, foodId: number | null, estimated: boolean): ParsedItem {
  const m = scaleMacros(per100, grams);
  return { name, grams: round1(grams), ...m, foodId, estimated };
}

class ClaudeFoodParser implements FoodParser {
  get available() {
    return claudeAvailable();
  }

  async parse(text: string, userId: number): Promise<ParsedItem[]> {
    const own = await prisma.food.findMany({ where: { ownerId: userId }, orderBy: { usageCount: 'desc' }, take: 300 });
    const ownList = own.length
      ? own
          .map((f) => {
            const servings = parseServings(f.servings)
              .map((s) => `${s.label}=${s.grams}г`)
              .join(', ');
            return `${f.id}: ${f.name}${f.brand ? ` (${f.brand})` : ''}${servings ? ` [${servings}]` : ''}`;
          })
          .join('\n')
      : '(пусто)';

    const response = await getClaude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      // On a safety-classifier refusal, re-run server-side on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Мои продукты (id: название [порции]):\n${ownList}\n\nЗапись:\n${text}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new FoodParseError('Claude отказался разбирать этот текст');
    if (response.stop_reason === 'max_tokens') throw new FoodParseError('Слишком длинная запись — разбей на части');

    let raw: RawItem[];
    try {
      raw = (JSON.parse(responseText(response.content)) as { items: RawItem[] }).items;
    } catch {
      throw new FoodParseError('Не удалось разобрать ответ Claude');
    }

    const ownById = new Map(own.map((f) => [f.id, f]));
    const out: ParsedItem[] = [];
    for (const it of raw) {
      if (!it?.name || !isFiniteNonNeg(it.grams) || it.grams <= 0 || it.grams > 5000) continue;

      const mine = it.own_food_id != null ? ownById.get(it.own_food_id) : undefined;
      if (mine) {
        out.push(toParsed(mine.name, it.grams, mine, mine.id, false));
        continue;
      }

      const [match] = it.catalog_query ? await searchLocalFoods(userId, it.catalog_query) : [];
      if (match && (match.source === 'seed' || match.ownerId === userId)) {
        out.push(toParsed(match.name, it.grams, match, match.id, false));
        continue;
      }

      if ([it.kcal_per_100g, it.protein_per_100g, it.fat_per_100g, it.carbs_per_100g].every(isFiniteNonNeg)) {
        out.push(
          toParsed(
            it.name,
            it.grams,
            { kcal: it.kcal_per_100g, protein: it.protein_per_100g, fat: it.fat_per_100g, carbs: it.carbs_per_100g },
            null,
            true,
          ),
        );
      }
    }
    return out;
  }
}

export const foodParser: FoodParser = new ClaudeFoodParser();
