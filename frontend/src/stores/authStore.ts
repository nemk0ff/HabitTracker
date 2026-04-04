import { create } from 'zustand';
import { api, setAuthToken } from '../api/client';
import type { User } from '../types';

const SAFETY_LOADING_MS = 8000;

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  authenticate: (initData: string) => Promise<void>;
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
        body: JSON.stringify({ initData }),
        signal: controller.signal,
      });
      clearTimeout(abortId);
      clearSafetyTimer();
      setAuthToken(res.token);
      set({ user: res.user, loading: false });
    } catch (e: any) {
      clearTimeout(abortId);
      clearSafetyTimer();
      const message = e.name === 'AbortError' ? 'Сервер не отвечает. Проверьте интернет или попробуйте позже.' : (e.message || 'Ошибка входа');
      set({ error: message, loading: false });
    }
  },
}));
