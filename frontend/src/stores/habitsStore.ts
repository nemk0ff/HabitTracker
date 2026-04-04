import { create } from 'zustand';
import * as habitsApi from '../api/habits';
import type { Habit, Screen } from '../types';

interface HabitsState {
  habits: Habit[];
  loading: boolean;
  error: string | null;

  screen: Screen;
  selectedHabitId: number | null;

  load: () => Promise<void>;
  addHabit: (data: { name: string; color?: string; icon?: string; binary?: boolean }) => Promise<void>;
  editHabit: (id: number, data: { name?: string; color?: string; icon?: string; binary?: boolean }) => Promise<void>;
  removeHabit: (id: number) => Promise<void>;
  toggleEntry: (habitId: number, date: string, value: number) => Promise<void>;

  navigate: (screen: Screen, habitId?: number | null) => void;
}

export const useHabitsStore = create<HabitsState>((set, get) => ({
  habits: [],
  loading: false,
  error: null,

  screen: 'home',
  selectedHabitId: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const habits = await habitsApi.fetchHabits();
      set({ habits, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  addHabit: async (data) => {
    try {
      const habit = await habitsApi.createHabit(data);
      set((s) => ({ habits: [...s.habits, habit] }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  editHabit: async (id, data) => {
    try {
      const updated = await habitsApi.updateHabit(id, data);
      set((s) => ({
        habits: s.habits.map((h) =>
          h.id === id ? { ...h, ...updated } : h,
        ),
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  removeHabit: async (id) => {
    try {
      await habitsApi.deleteHabit(id);
      set((s) => ({
        habits: s.habits.filter((h) => h.id !== id),
        screen: 'home',
        selectedHabitId: null,
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  toggleEntry: async (habitId, date, value) => {
    // Optimistic update
    set((s) => ({
      habits: s.habits.map((h) => {
        if (h.id !== habitId) return h;
        const existingIdx = h.entries.findIndex((e) => e.date === date);
        let entries = [...h.entries];
        if (value === 0) {
          entries = entries.filter((e) => e.date !== date);
        } else if (existingIdx >= 0) {
          entries[existingIdx] = { ...entries[existingIdx]!, value };
        } else {
          entries.push({ id: -1, date, value });
        }
        return { ...h, entries };
      }),
    }));

    try {
      await habitsApi.toggleEntry(habitId, date, value);
    } catch (e: any) {
      get().load(); // reload on error
    }
  },

  navigate: (screen, habitId = null) => {
    set({ screen, selectedHabitId: habitId ?? null });
  },
}));
