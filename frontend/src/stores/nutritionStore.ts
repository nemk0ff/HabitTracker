import { create } from 'zustand';
import * as api from '../api/nutrition';
import type { LogInput } from '../api/nutrition';
import type { Food, FoodDay, FoodLogEntry, Meal, NutritionGoal, Plan } from '../types';
import { sumMacros } from '../utils/nutrition';

interface NutritionState {
  /** Diary days by YYYY-MM-DD. */
  days: Record<string, FoodDay>;
  /** Model output by YYYY-MM-DD. */
  plans: Record<string, Plan>;
  goal: NutritionGoal | null;
  goalLoaded: boolean;
  recent: Food[];
  favorites: Food[];
  error: string | null;

  loadDay: (date: string) => Promise<void>;
  loadPlan: (date: string) => Promise<void>;
  saveWeight: (date: string, weightKg: number) => Promise<void>;
  loadGoal: () => Promise<void>;
  loadRecent: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  /** Optimistic star toggle; returns the new state (reverted on error). */
  toggleFavorite: (food: Food) => Promise<boolean>;
  addEntry: (input: LogInput) => Promise<FoodLogEntry | null>;
  addEntries: (inputs: LogInput[]) => Promise<void>;
  updateEntry: (entry: FoodLogEntry, data: { grams?: number; meal?: Meal }) => Promise<void>;
  removeEntry: (entry: FoodLogEntry) => Promise<void>;
  copyDay: (fromDate: string, toDate: string, meal?: Meal) => Promise<number>;
  setDayComplete: (date: string, complete: boolean) => Promise<void>;
  setGoal: (goal: NutritionGoal) => Promise<void>;
}

function withEntries(day: FoodDay, entries: FoodLogEntry[]): FoodDay {
  return { ...day, entries, totals: sumMacros(entries) };
}

export const useNutritionStore = create<NutritionState>((set, get) => {
  /** Apply a change to a cached day (no-op if that day isn't loaded). */
  const patchDay = (date: string, fn: (entries: FoodLogEntry[]) => FoodLogEntry[]) => {
    set((s) => {
      const day = s.days[date];
      if (!day) return s;
      return { days: { ...s.days, [date]: withEntries(day, fn(day.entries)) } };
    });
  };

  return {
    days: {},
    plans: {},
    goal: null,
    goalLoaded: false,
    recent: [],
    favorites: [],
    error: null,

    loadDay: async (date) => {
      try {
        const day = await api.fetchDay(date);
        set((s) => ({ days: { ...s.days, [date]: day }, goal: day.goal, goalLoaded: true, error: null }));
      } catch (e: any) {
        set({ error: e.message });
      }
    },

    loadPlan: async (date) => {
      try {
        const plan = await api.fetchPlan(date);
        set((s) => ({ plans: { ...s.plans, [date]: plan } }));
      } catch {
        // the day screen falls back to the plain goal
      }
    },

    saveWeight: async (date, weightKg) => {
      await api.saveWeight(date, weightKg);
      // Trend and targets depend on the weight — drop cached plans, reload this one.
      set({ plans: {} });
      await get().loadPlan(date);
    },

    loadGoal: async () => {
      try {
        set({ goal: await api.fetchGoal(), goalLoaded: true });
      } catch (e: any) {
        set({ error: e.message });
      }
    },

    loadRecent: async () => {
      try {
        set({ recent: await api.fetchRecentFoods() });
      } catch {
        // empty state just shows no recents
      }
    },

    loadFavorites: async () => {
      try {
        set({ favorites: await api.fetchFavorites() });
      } catch (e: any) {
        set({ error: e.message });
      }
    },

    toggleFavorite: async (food) => {
      const next = !food.favorite;
      const apply = (fav: boolean) =>
        set((s) => ({
          recent: s.recent.map((f) => (f.id === food.id ? { ...f, favorite: fav } : f)),
          favorites: fav
            ? s.favorites.some((f) => f.id === food.id)
              ? s.favorites
              : [...s.favorites, { ...food, favorite: true }]
            : s.favorites.filter((f) => f.id !== food.id),
        }));
      apply(next);
      try {
        await api.setFavorite(food.id, next);
        return next;
      } catch (e: any) {
        apply(!next);
        set({ error: e.message });
        return !next;
      }
    },

    addEntry: async (input) => {
      try {
        const entry = await api.addLogEntry(input);
        patchDay(entry.date, (entries) => [...entries, entry]);
        return entry;
      } catch (e: any) {
        set({ error: e.message });
        return null;
      }
    },

    addEntries: async (inputs) => {
      for (const input of inputs) {
        await get().addEntry(input);
      }
    },

    updateEntry: async (entry, data) => {
      try {
        const updated = await api.updateLogEntry(entry.id, data);
        patchDay(entry.date, (entries) => entries.map((e) => (e.id === entry.id ? updated : e)));
      } catch (e: any) {
        set({ error: e.message });
      }
    },

    removeEntry: async (entry) => {
      // Optimistic, like habitsStore.toggleEntry; reload the day on failure.
      patchDay(entry.date, (entries) => entries.filter((e) => e.id !== entry.id));
      try {
        await api.deleteLogEntry(entry.id);
      } catch (e: any) {
        set({ error: e.message });
        get().loadDay(entry.date);
      }
    },

    setDayComplete: async (date, complete) => {
      set((s) => (s.days[date] ? { days: { ...s.days, [date]: { ...s.days[date]!, complete } } } : s));
      try {
        await api.setDayComplete(date, complete);
      } catch (e: any) {
        set({ error: e.message });
        get().loadDay(date);
      }
    },

    copyDay: async (fromDate, toDate, meal) => {
      try {
        const created = await api.copyDay(fromDate, toDate, meal);
        patchDay(toDate, (entries) => [...entries, ...created]);
        return created.length;
      } catch (e: any) {
        set({ error: e.message });
        return 0;
      }
    },

    setGoal: async (goal) => {
      const saved = await api.saveGoal(goal);
      set((s) => ({
        goal: saved,
        goalLoaded: true,
        plans: {},
        days: Object.fromEntries(Object.entries(s.days).map(([k, d]) => [k, { ...d, goal: saved }])),
      }));
    },
  };
});
