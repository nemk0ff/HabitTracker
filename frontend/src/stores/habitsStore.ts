import { create } from 'zustand';
import * as habitsApi from '../api/habits';
import { useNavStore } from './navStore';
import type { Habit, HabitEntry } from '../types';

interface HabitsState {
  habits: Habit[];
  /** True only while the very first load runs (no habits yet) — reloads keep the list on screen. */
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  addHabit: (data: habitsApi.CreateHabitData) => Promise<boolean>;
  editHabit: (id: number, data: habitsApi.UpdateHabitData) => Promise<boolean>;
  /** Manual order of the active habits, top to bottom (optimistic; re-syncs on error). */
  reorder: (ids: number[]) => Promise<void>;
  /** Archive / restore (optimistic; rolls back on error). */
  setArchived: (id: number, archived: boolean) => Promise<boolean>;
  removeHabit: (id: number) => Promise<void>;
  toggleEntry: (habitId: number, date: string, value: number) => Promise<void>;
}

/** Replaces (or removes, when `entry` is undefined) one habit's entry for `date`. */
function withEntry(habits: Habit[], habitId: number, date: string, entry: HabitEntry | undefined): Habit[] {
  return habits.map((h) => {
    if (h.id !== habitId) return h;
    const rest = h.entries.filter((e) => e.date !== date);
    return { ...h, entries: entry ? [...rest, entry] : rest };
  });
}

/**
 * Entry writes are serialized per `habitId:date`, so rapid taps / undo reach the server in the
 * order the user made them and the last action wins. `latestWrite` tells a failing write whether
 * a newer one for the same cell has superseded it (then its rollback would be wrong).
 */
const writeChains = new Map<string, Promise<void>>();
const latestWrite = new Map<string, number>();
let writeSeq = 0;

export const useHabitsStore = create<HabitsState>((set, get) => ({
  habits: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: get().habits.length === 0, error: null });
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
      // The server returns the existing habit for a double-tap — don't list it twice.
      set((s) => ({
        habits: s.habits.some((h) => h.id === habit.id)
          ? s.habits.map((h) => (h.id === habit.id ? { ...h, ...habit } : h))
          : [...s.habits, habit],
      }));
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  editHabit: async (id, data) => {
    try {
      const updated = await habitsApi.updateHabit(id, data);
      set((s) => ({
        habits: s.habits.map((h) =>
          h.id === id ? { ...h, ...updated, entries: updated.entries ?? h.entries } : h,
        ),
      }));
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  reorder: async (ids) => {
    const order = new Map(ids.map((id, i) => [id, i]));
    set((s) => ({
      habits: s.habits.map((h) => (order.has(h.id) ? { ...h, sortOrder: order.get(h.id)! } : h)),
    }));
    try {
      await habitsApi.reorderHabits(ids);
    } catch (e: any) {
      set({ error: e.message });
      void get().load();
    }
  },

  setArchived: async (id, archived) => {
    const prev = get().habits.find((h) => h.id === id);
    if (!prev) return false;
    set((s) => ({ habits: s.habits.map((h) => (h.id === id ? { ...h, archived } : h)) }));
    try {
      const updated = await habitsApi.updateHabit(id, { archived });
      // Keep the loaded entries if the PATCH response doesn't carry them.
      set((s) => ({
        habits: s.habits.map((h) => (h.id === id ? { ...h, ...updated, entries: updated.entries ?? h.entries } : h)),
      }));
      return true;
    } catch (e: any) {
      set((s) => ({ habits: s.habits.map((h) => (h.id === id ? { ...h, archived: prev.archived } : h)), error: e.message }));
      return false;
    }
  },

  removeHabit: async (id) => {
    try {
      await habitsApi.deleteHabit(id);
      set((s) => ({ habits: s.habits.filter((h) => h.id !== id) }));
      // Back to wherever the habit was opened from (Today or the list).
      const nav = useNavStore.getState();
      nav.back();
      useNavStore.setState({ selectedHabitId: null });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  toggleEntry: (habitId, date, value) => {
    const key = `${habitId}:${date}`;
    const seq = ++writeSeq;
    latestWrite.set(key, seq);

    // Optimistic update; remember this cell's previous entry for a targeted rollback.
    const prevEntry = get().habits.find((h) => h.id === habitId)?.entries.find((e) => e.date === date);
    const nextEntry = value === 0 ? undefined : prevEntry ? { ...prevEntry, value } : { id: -1, date, value };
    set((s) => ({ habits: withEntry(s.habits, habitId, date, nextEntry) }));

    const run = async () => {
      try {
        await habitsApi.toggleEntry(habitId, date, value);
      } catch (e: any) {
        // The last write of the chain failed: its `prevEntry` may itself be an unsaved optimistic
        // value (several failed taps in a row), so roll back and then re-sync with the server.
        if (latestWrite.get(key) === seq) {
          set((s) => ({ habits: withEntry(s.habits, habitId, date, prevEntry), error: e.message }));
          void get().load();
        }
      }
    };

    const chain = (writeChains.get(key) ?? Promise.resolve()).then(run);
    writeChains.set(key, chain);
    void chain.finally(() => {
      if (writeChains.get(key) === chain) {
        writeChains.delete(key);
        latestWrite.delete(key);
      }
    });
    return chain;
  },
}));
