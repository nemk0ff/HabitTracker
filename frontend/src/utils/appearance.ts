/**
 * №23 «Вид»: forced dark theme and a larger font, stored per device (personal phone).
 * applyAppearance() runs in main.tsx before the first render and again on every change.
 */

export type ThemeMode = 'telegram' | 'dark';
export type FontSize = 'normal' | 'large';

export interface Appearance {
  theme: ThemeMode;
  font: FontSize;
}

const STORAGE_KEY = 'appearance';
const DEFAULTS: Appearance = { theme: 'dark', font: 'large' };

/** Coherent dark palette; bg/section match SURFACE_DARK (#212121) used by the contrast helpers in colors.ts. */
const DARK_PALETTE: Record<string, string> = {
  'bg-color': '#212121',
  'secondary-bg-color': '#141414',
  'section-bg-color': '#212121',
  'header-bg-color': '#141414',
  'bottom-bar-bg-color': '#141414',
  'text-color': '#f2f2f2',
  'hint-color': '#9a9aa0',
  'subtitle-text-color': '#9a9aa0',
  'section-header-text-color': '#a3a3a8',
  'section-separator-color': '#2c2c2e',
  'link-color': '#6ab3f3',
  'accent-text-color': '#3fb58a',
  'button-color': '#2e9a6e',
  'button-text-color': '#ffffff',
  'destructive-text-color': '#ff6b61',
};

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Appearance>;
      return {
        theme: p.theme === 'telegram' || p.theme === 'dark' ? p.theme : DEFAULTS.theme,
        font: p.font === 'normal' || p.font === 'large' ? p.font : DEFAULTS.font,
      };
    }
  } catch {
    // storage unavailable — defaults
  }
  return { ...DEFAULTS };
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    // storage unavailable — still applied for this session
  }
}

let current: Appearance = DEFAULTS;
let listening = false;

type WebAppLike = {
  colorScheme?: string;
  themeParams?: Record<string, string | undefined>;
  isVersionAtLeast?: (v: string) => boolean;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
};

const webApp = (): WebAppLike | undefined => (window as any).Telegram?.WebApp;

function callTg(fn: () => void) {
  try {
    fn();
  } catch {
    // unsupported in this client version
  }
}

function applyNow() {
  const root = document.documentElement;
  const wa = webApp();
  const atLeast = (v: string) => wa?.isVersionAtLeast?.(v) ?? false;

  root.style.fontSize = current.font === 'large' ? '112.5%' : '';

  if (current.theme === 'dark') {
    root.dataset.scheme = 'dark';
    for (const [k, v] of Object.entries(DARK_PALETTE)) root.style.setProperty(`--tg-theme-${k}`, v);
    if (wa) {
      if (atLeast('6.9')) callTg(() => wa.setHeaderColor?.(DARK_PALETTE['header-bg-color']!));
      if (atLeast('6.1')) callTg(() => wa.setBackgroundColor?.(DARK_PALETTE['secondary-bg-color']!));
      if (atLeast('7.10')) callTg(() => wa.setBottomBarColor?.(DARK_PALETTE['bottom-bar-bg-color']!));
    }
    return;
  }

  // «Как в Telegram»: restore the client's own theme params (or the index.css defaults).
  const params = wa?.themeParams ?? {};
  for (const k of Object.keys(DARK_PALETTE)) {
    const v = params[k.replace(/-/g, '_')];
    if (v) root.style.setProperty(`--tg-theme-${k}`, v);
    else root.style.removeProperty(`--tg-theme-${k}`);
  }
  if (wa?.colorScheme) root.dataset.scheme = wa.colorScheme;
  else delete root.dataset.scheme;
  if (wa) {
    if (atLeast('6.1')) {
      callTg(() => wa.setHeaderColor?.('bg_color'));
      callTg(() => wa.setBackgroundColor?.('bg_color'));
    }
    if (atLeast('7.10')) callTg(() => wa.setBottomBarColor?.('bottom_bar_bg_color'));
  }
}

/** Applies the given (or stored) appearance; also re-applies after Telegram theme changes. */
export function applyAppearance(a: Appearance = loadAppearance()) {
  current = a;
  applyNow();
  if (!listening) {
    listening = true;
    // Telegram rewrites --tg-theme-* on themeChanged; a forced dark theme re-applies on top.
    webApp()?.onEvent?.('themeChanged', applyNow);
  }
}

export function setAppearance(a: Appearance) {
  saveAppearance(a);
  applyAppearance(a);
}
