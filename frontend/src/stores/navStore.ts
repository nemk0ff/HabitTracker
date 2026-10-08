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

const MAX_HISTORY = 20;

interface NavState extends Required<NavParams> {
  screen: Screen;
  /** Screens visited before the current one (oldest first). */
  history: Screen[];
  /**
   * Params not passed keep their previous values. Navigating to the current screen only updates
   * params; navigating to a screen already in the history unwinds back to it (no loops).
   */
  navigate: (screen: Screen, params?: NavParams) => void;
  /** Returns to the previous screen ('hub' when there is none). */
  back: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  screen: 'hub',
  history: [],
  selectedHabitId: null,
  foodDate: toDateString(new Date()),
  foodMeal: 'breakfast',
  foodId: null,

  navigate: (screen, params = {}) => {
    set((s) => {
      if (screen === s.screen) return { ...params };
      const i = s.history.lastIndexOf(screen);
      const history = i >= 0 ? s.history.slice(0, i) : [...s.history, s.screen].slice(-MAX_HISTORY);
      return { screen, history, ...params };
    });
  },

  back: () => {
    set((s) => {
      const history = s.history.slice(0, -1);
      const prev = s.history[s.history.length - 1] ?? 'hub';
      return { screen: prev === s.screen ? 'hub' : prev, history };
    });
  },
}));
