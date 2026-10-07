import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  actions: ToastAction[];
}

interface ToastState {
  toast: Toast | null;
  /** Shows one toast at a time (a new one replaces the current), auto-hides after `ms`. */
  show: (text: string, opts?: { actions?: ToastAction[]; tone?: Toast['tone']; ms?: number }) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (text, { actions = [], tone = 'info', ms = 4000 } = {}) => {
    if (timer) clearTimeout(timer);
    set({ toast: { id: ++seq, text, tone, actions } });
    timer = setTimeout(() => set({ toast: null }), ms);
  },
  hide: () => {
    if (timer) clearTimeout(timer);
    set({ toast: null });
  },
}));

/** Shorthand for non-React code (stores). */
export const toast = (...args: Parameters<ToastState['show']>) => useToastStore.getState().show(...args);
