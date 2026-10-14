import { create } from 'zustand';
import { api, ApiError, setAuthToken } from '../api/client';
import type { User } from '../types';

const SAFETY_LOADING_MS = 8000;

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  /** /api/auth answered 403: this Telegram account isn't the owner of this personal app. */
  forbidden: boolean;
  authenticate: (initData: string) => Promise<void>;
  /** Merges locally saved settings (checkinTime, morningCheckinTime) into the current user. */
  patchUser: (patch: Partial<User>) => void;
}

let safetyTimerId: ReturnType<typeof setTimeout> | null = null;

function clearSafetyTimer() {
  if (safetyTimerId) {
    clearTimeout(safetyTimerId);
    safetyTimerId = null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: null,
  forbidden: false,

  patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),

  authenticate: async (initData: string) => {
    clearSafetyTimer();
    set({ loading: true, error: null });

    safetyTimerId = setTimeout(() => {
      safetyTimerId = null;
      const state = get();
      if (state.loading && !state.user) {
        set({
          loading: false,
          error: 'Не удалось подключиться. Проверьте интернет и откройте приложение снова из чата с ботом.',
        });
      }
    }, SAFETY_LOADING_MS);

    const controller = new AbortController();
    const abortId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await api<{ token: string; user: User }>('/api/auth', {
        method: 'POST',
        // tzOffset lets the bot compute the user's local "today" for reminders.
        body: JSON.stringify({ initData, tzOffset: new Date().getTimezoneOffset() }),
        signal: controller.signal,
      });
      clearTimeout(abortId);
      clearSafetyTimer();
      setAuthToken(res.token);
      set({ user: res.user, loading: false });
    } catch (e: any) {
      clearTimeout(abortId);
      clearSafetyTimer();
      if (e instanceof ApiError && e.status === 403) {
        set({ forbidden: true, error: null, loading: false });
        return;
      }
      const message = e.name === 'AbortError' ? 'Сервер не отвечает. Проверьте интернет или попробуйте позже.' : (e.message || 'Ошибка входа');
      set({ error: message, loading: false });
    }
  },
}));
