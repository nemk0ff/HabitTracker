import { create } from 'zustand';
import * as api from '../api/nutrition';
import type { LogInput } from '../api/nutrition';
import type { Food, FoodDay, FoodLogEntry, Meal, NutritionGoal } from '../types';
import { sumMacros } from '../utils/nutrition';

interface NutritionState {
  /** Diary days by YYYY-MM-DD. */
  days: Record<string, FoodDay>;
  goal: NutritionGoal | null;
  goalLoaded: boolean;
  recent: Food[];
  error: string | null;

  loadDay: (date: string) => Promise<void>;
  loadGoal: () => Promise<void>;
  loadRecent: () => Promise<void>;
  addEntry: (input: LogInput) => Promise<FoodLogEntry | null>;
  addEntries: (inputs: LogInput[]) => Promise<void>;
  updateEntry: (entry: FoodLogEntry, data: { grams?: number; meal?: Meal }) => Promise<void>;
  removeEntry: (entry: FoodLogEntry) => Promise<void>;
  copyDay: (fromDate: string, toDate: string) => Promise<number>;
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
    goal: null,
    goalLoaded: false,
    recent: [],
    error: null,

    loadDay: async (date) => {
      try {
        const day = await api.fetchDay(date);
        set((s) => ({ days: { ...s.days, [date]: day }, goal: day.goal, goalLoaded: true, error: null }));
      } catch (e: any) {
        set({ error: e.message });
      }
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

    copyDay: async (fromDate, toDate) => {
      try {
        const created = await api.copyDay(fromDate, toDate);
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
        days: Object.fromEntries(Object.entries(s.days).map(([k, d]) => [k, { ...d, goal: saved }])),
      }));
    },
  };
});
