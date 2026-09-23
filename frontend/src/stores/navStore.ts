import { create } from 'zustand';
import { toDateString } from '../utils/dates';
import type { Meal, Screen } from '../types';

export interface NavParams {
  selectedHabitId?: number | null;
  /** Day shown in the food diary (YYYY-MM-DD). Persists across screens. */
  foodDate?: string;
  /** Meal pre-selected when adding food. */
  foodMeal?: Meal;
  /** Own product being edited on the product form (null = create). */
  foodId?: number | null;
}

interface NavState extends Required<NavParams> {
  screen: Screen;
  /** Params not passed keep their previous values. */
  navigate: (screen: Screen, params?: NavParams) => void;
}

export const useNavStore = create<NavState>((set) => ({
  screen: 'hub',
  selectedHabitId: null,
  foodDate: toDateString(new Date()),
  foodMeal: 'breakfast',
  foodId: null,

  navigate: (screen, params = {}) => {
    set({ screen, ...params });
  },
}));
