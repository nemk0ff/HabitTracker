import { useSyncExternalStore } from 'react';

export const HABIT_COLORS = [
  '#4CAF50', // green
  '#2196F3', // blue
  '#FF9800', // orange
  '#E91E63', // pink
  '#9C27B0', // purple
  '#00BCD4', // teal
  '#FF5722', // deep orange
  '#607D8B', // blue gray
  '#F44336', // red
  '#8BC34A', // light green
  '#3F51B5', // indigo
  '#FFEB3B', // yellow
];

/** Heatmap fill alpha per level (1 light, 2 medium, 3+ hard). Level 1 must stay visible on dark bg. */
export const HEATMAP_ALPHA = [0, 0.4, 0.7, 1.0] as const;

/** Approximate surfaces the heatmap sits on (Telegram section bg). */
const SURFACE_LIGHT: Rgb = [255, 255, 255];
const SURFACE_DARK: Rgb = [33, 33, 33];

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG contrast ratio between two hex colors (1…21). */
export function contrastRatio(a: string, b: string): number {
  return ratio(parseHex(a), parseHex(b));
}

function pickOn(rgb: Rgb): '#000000' | '#ffffff' {
  return ratio(rgb, [0, 0, 0]) >= ratio(rgb, [255, 255, 255]) ? '#000000' : '#ffffff';
}

/** Black or white — whichever contrasts more with a solid `hex` background. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  return pickOn(parseHex(hex));
}

/** Like readableOn, for `hex` drawn at `alpha` over the light/dark page surface (heatmap cells). */
export function readableOnBlend(hex: string, alpha: number, isDark: boolean): '#000000' | '#ffffff' {
  const fg = parseHex(hex);
  const bg = isDark ? SURFACE_DARK : SURFACE_LIGHT;
  const a = Math.max(0, Math.min(1, alpha));
  return pickOn([0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)) as Rgb);
}

/**
 * `hex` nudged toward black (light theme) or white (dark theme) until it reaches `min`
 * contrast against the surface — for habit-coloured text like «3 из 5» or a streak.
 */
export function legibleColor(hex: string, isDark: boolean, min = 4.5): string {
  const fg = parseHex(hex);
  const bg = isDark ? SURFACE_DARK : SURFACE_LIGHT;
  if (ratio(fg, bg) >= min) return hex;
  const target: Rgb = isDark ? [255, 255, 255] : [0, 0, 0];
  for (let t = 0.1; t <= 1; t += 0.1) {
    const mixed = [0, 1, 2].map((i) => fg[i]! + (target[i]! - fg[i]!) * t) as Rgb;
    if (ratio(mixed, bg) >= min) return toHex(mixed);
  }
  return toHex(target);
}

export function getHeatmapColor(baseColor: string, value: number): string {
  if (value === 0) return 'transparent';
  const opacity = HEATMAP_ALPHA[Math.min(value, 3)] ?? 1;
  const [r, g, b] = parseHex(baseColor);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Empty heatmap cell — themed via the `--empty-cell` token in index.css (reactive to theme changes). */
export function getEmptyColor(_isDark?: boolean): string {
  return 'var(--empty-cell)';
}

/* Reactive light/dark flag, driven by `data-scheme` on <html> (set in main.tsx). */
function subscribeScheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
  return () => obs.disconnect();
}
const getIsDark = () => document.documentElement.dataset.scheme === 'dark';

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeScheme, getIsDark, () => false);
}
