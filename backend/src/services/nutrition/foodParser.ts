/**
 * Free-text meal parsing ("200г курицы и 150г макарон" → items).
 * Stage 2 plugs a Claude-backed implementation in here; the route and the
 * Mini App UI already speak this contract.
 */
export interface ParsedItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Matched catalog food, if any. */
  foodId: number | null;
  /** true when the numbers are an estimate rather than a catalog match. */
  estimated: boolean;
}

export interface FoodParser {
  readonly available: boolean;
  parse(text: string, userId: number): Promise<ParsedItem[]>;
}

class NotImplementedParser implements FoodParser {
  readonly available = false;
  async parse(): Promise<ParsedItem[]> {
    throw new Error('Food text parsing is not implemented yet');
  }
}

export const foodParser: FoodParser = new NotImplementedParser();
