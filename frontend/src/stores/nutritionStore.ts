import { create } from 'zustand';
import * as api from '../api/nutrition';
import type { LogInput } from '../api/nutrition';
import type { Food, FoodDay, FoodLogEntry, Meal, MealTemplate, NutritionGoal, Plan } from '../types';
import { fmt, sumMacros } from '../utils/nutrition';
import { toast } from './toastStore';

interface NutritionState {
  /** Diary days by YYYY-MM-DD. */
  days: Record<string, FoodDay>;
  /** Model output by YYYY-MM-DD. */
  plans: Record<string, Plan>;
  goal: NutritionGoal | null;
  goalLoaded: boolean;
  recent: Food[];
  favorites: Food[];
  /** Meal templates («наборы»); loaded lazily by loadTemplates. */
  templates: MealTemplate[];
  templatesLoaded: boolean;
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
  /** Fetches templates once; `force` refetches. */
  loadTemplates: (force?: boolean) => Promise<void>;
  saveTemplateFromMeal: (date: string, meal: Meal, name: string) => Promise<MealTemplate | null>;
  deleteTemplate: (id: number) => Promise<void>;
  /** Logs the template into (date, meal), shows an undo toast; returns the created entries. */
  applyTemplate: (id: number, date: string, meal: Meal) => Promise<FoodLogEntry[]>;
}

function withEntries(day: FoodDay, entries: FoodLogEntry[]): FoodDay {
  return { ...day, entries, totals: sumMacros(entries) };
}

/**
 * Per-date mutation counter, bumped when a mutation of that date starts and again when it settles.
 * A day GET that overlapped a mutation may carry the pre-mutation state and would overwrite the
 * optimistic change, so its result is dropped (unless the day isn't cached at all yet).
 */
const dayVersion = new Map<string, number>();
const bumpDay = (date: string) => dayVersion.set(date, (dayVersion.get(date) ?? 0) + 1);

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
    templates: [],
    templatesLoaded: false,
    error: null,

    loadDay: async (date) => {
      const version = dayVersion.get(date) ?? 0;
      try {
        const day = await api.fetchDay(date);
        // A mutation of this day overlapped the request: keep the (optimistic) cached day.
        if ((dayVersion.get(date) ?? 0) !== version && get().days[date]) return;
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
      bumpDay(input.date);
      try {
        const entry = await api.addLogEntry(input);
        // Dedupe: a reload that overlapped the POST may already contain the entry.
        patchDay(entry.date, (entries) => [...entries.filter((e) => e.id !== entry.id), entry]);
        return entry;
      } catch (e: any) {
        set({ error: e.message });
        return null;
      } finally {
        bumpDay(input.date);
      }
    },

    addEntries: async (inputs) => {
      for (const input of inputs) {
        await get().addEntry(input);
      }
    },

    updateEntry: async (entry, data) => {
      bumpDay(entry.date);
      try {
        const updated = await api.updateLogEntry(entry.id, data);
        patchDay(entry.date, (entries) => entries.map((e) => (e.id === entry.id ? updated : e)));
      } catch (e: any) {
        set({ error: e.message });
      } finally {
        bumpDay(entry.date);
      }
    },

    removeEntry: async (entry) => {
      // Optimistic, like habitsStore.toggleEntry; reload the day on failure.
      bumpDay(entry.date);
      patchDay(entry.date, (entries) => entries.filter((e) => e.id !== entry.id));
      try {
        await api.deleteLogEntry(entry.id);
        bumpDay(entry.date);
      } catch (e: any) {
        bumpDay(entry.date);
        set({ error: e.message });
        get().loadDay(entry.date);
      }
    },

    setDayComplete: async (date, complete) => {
      bumpDay(date);
      set((s) => (s.days[date] ? { days: { ...s.days, [date]: { ...s.days[date]!, complete } } } : s));
      try {
        await api.setDayComplete(date, complete);
        bumpDay(date);
      } catch (e: any) {
        bumpDay(date);
        set({ error: e.message });
        get().loadDay(date);
      }
    },

    copyDay: async (fromDate, toDate, meal) => {
      bumpDay(toDate);
      try {
        const created = await api.copyDay(fromDate, toDate, meal);
        const ids = new Set(created.map((c) => c.id));
        patchDay(toDate, (entries) => [...entries.filter((e) => !ids.has(e.id)), ...created]);
        return created.length;
      } catch (e: any) {
        set({ error: e.message });
        return 0;
      } finally {
        bumpDay(toDate);
      }
    },

    loadTemplates: async (force = false) => {
      if (get().templatesLoaded && !force) return;
      try {
        set({ templates: await api.fetchMealTemplates(), templatesLoaded: true });
      } catch {
        // templates are an extra; the screens just don't show them
      }
    },

    saveTemplateFromMeal: async (date, meal, name) => {
      try {
        const tpl = await api.createMealTemplate({ name, fromDate: date, fromMeal: meal });
        set((s) => ({ templates: [tpl, ...s.templates.filter((t) => t.id !== tpl.id)] }));
        return tpl;
      } catch (e: any) {
        set({ error: e.message });
        toast(e.message || 'Не получилось сохранить набор', { tone: 'error' });
        return null;
      }
    },

    deleteTemplate: async (id) => {
      const prev = get().templates;
      set({ templates: prev.filter((t) => t.id !== id) });
      try {
        await api.deleteMealTemplate(id);
      } catch (e: any) {
        set({ templates: prev, error: e.message });
        toast(e.message || 'Не получилось удалить набор', { tone: 'error' });
      }
    },

    applyTemplate: async (id, date, meal) => {
      const tpl = get().templates.find((t) => t.id === id);
      bumpDay(date);
      try {
        const created = await api.applyMealTemplate(id, date, meal);
        const ids = new Set(created.map((c) => c.id));
        patchDay(date, (entries) => [...entries.filter((e) => !ids.has(e.id)), ...created]);
        const kcal = sumMacros(created).kcal;
        toast(`Добавлено: ${tpl?.name ?? 'набор'} (${fmt(kcal)} ккал)`, {
          ms: 6000,
          actions: [
            {
              label: 'Отменить',
              onClick: () => {
                for (const entry of created) get().removeEntry(entry);
              },
            },
          ],
        });
        return created;
      } catch (e: any) {
        set({ error: e.message });
        toast(e.message || 'Не получилось добавить набор', { tone: 'error' });
        return [];
      } finally {
        bumpDay(date);
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
