import { useEffect, useRef } from 'react';

/** Shows Telegram's native BackButton while mounted (hidden when `handler` is null). */
export function useBackButton(handler: (() => void) | null) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = handler !== null;

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    if (!enabled) {
      bb.hide?.();
      return;
    }
    const cb = () => ref.current?.();
    bb.show?.();
    bb.onClick?.(cb);
    return () => {
      bb.offClick?.(cb);
      bb.hide?.();
    };
  }, [enabled]);
}

/** Shows Telegram's native MainButton with `text` while mounted; `text === null` hides it. */
export function useMainButton(text: string | null, handler: () => void, opts: { progress?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb) return;
    if (text === null) {
      mb.hide?.();
      return;
    }
    const cb = () => ref.current();
    mb.setParams?.({ text, is_visible: true });
    mb.onClick?.(cb);
    return () => {
      mb.offClick?.(cb);
      mb.hide?.();
    };
  }, [text]);

  useEffect(() => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb || text === null) return;
    if (opts.progress) mb.showProgress?.(false);
    else mb.hideProgress?.();
  }, [opts.progress, text]);
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' | 'error' | 'select') {
  const h = window.Telegram?.WebApp?.HapticFeedback;
  if (!h) return;
  if (kind === 'light' || kind === 'medium') h.impactOccurred(kind);
  else if (kind === 'select') h.selectionChanged();
  else h.notificationOccurred(kind);
}
