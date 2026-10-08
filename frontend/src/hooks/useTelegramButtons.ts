import { useEffect, useRef } from 'react';

/* ------------------------------------------------------------------------------------------
 * Sheet stack + BackButton arbitration.
 *
 * While a bottom sheet is open, Telegram's native BackButton must close the sheet, not leave
 * the page. Telegram calls EVERY registered backButtonClicked handler, so page handlers are
 * wrapped (see installBackButtonGuard) and skip presses while a sheet is open; the sheet's
 * own handler is registered through the raw, unwrapped method.
 * ---------------------------------------------------------------------------------------- */

const sheetStack: symbol[] = [];
let suppressUntil = 0;
let backWasVisible = false;

/** True while any sheet is open (or a sheet just consumed a Back press). */
export function isSheetOpen(): boolean {
  return sheetStack.length > 0 || Date.now() < suppressUntil;
}

/** True if `id` is the top-most open sheet (only it reacts to Escape / Back). */
export function isTopSheet(id: symbol): boolean {
  return sheetStack[sheetStack.length - 1] === id;
}

type Cb = () => void;
let rawOnClick: ((cb: Cb) => unknown) | null = null;
let rawOffClick: ((cb: Cb) => unknown) | null = null;

/**
 * Wraps BackButton.onClick/offClick so handlers registered by pages (incl. ones wired by
 * hand, not via useBackButton) ignore presses while a sheet is open. Idempotent.
 */
export function installBackButtonGuard() {
  const bb = window.Telegram?.WebApp?.BackButton;
  if (!bb || rawOnClick || typeof bb.onClick !== 'function') return;
  const on = bb.onClick.bind(bb) as (cb: Cb) => unknown;
  const off = (typeof bb.offClick === 'function' ? bb.offClick.bind(bb) : () => bb) as (cb: Cb) => unknown;
  rawOnClick = on;
  rawOffClick = off;
  const wrapped = new WeakMap<Cb, Cb>();
  bb.onClick = (cb: Cb) => {
    let w = wrapped.get(cb);
    if (!w) {
      w = () => {
        if (!isSheetOpen()) cb();
      };
      wrapped.set(cb, w);
    }
    return on(w);
  };
  bb.offClick = (cb: Cb) => off(wrapped.get(cb) ?? cb);
}

/**
 * Registers an open sheet: pushes it on the stack, shows BackButton wired to `onClose`
 * (top sheet only) and closes on Escape. Restores BackButton visibility when the last
 * sheet closes.
 */
export function useSheetBackButton(open: boolean, onClose: () => void): symbol {
  const idRef = useRef<symbol>(Symbol('sheet'));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    installBackButtonGuard();
    const id = idRef.current;
    const bb = window.Telegram?.WebApp?.BackButton;

    if (sheetStack.length === 0) backWasVisible = !!bb?.isVisible;
    sheetStack.push(id);

    const onBack = () => {
      if (!isTopSheet(id)) return;
      suppressUntil = Date.now() + 120;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopSheet(id)) return;
      e.preventDefault();
      closeRef.current();
    };

    if (bb) {
      bb.show?.();
      if (rawOnClick) rawOnClick(onBack);
      else bb.onClick?.(onBack);
    }
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const i = sheetStack.lastIndexOf(id);
      if (i >= 0) sheetStack.splice(i, 1);
      if (bb) {
        if (rawOffClick) rawOffClick(onBack);
        else bb.offClick?.(onBack);
        if (sheetStack.length === 0 && !backWasVisible) bb.hide?.();
      }
    };
  }, [open]);

  return idRef.current;
}

/** Shows Telegram's native BackButton while mounted (hidden when `handler` is null). */
export function useBackButton(handler: (() => void) | null) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = handler !== null;

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    installBackButtonGuard();
    if (!enabled) {
      // Don't yank the button from under an open sheet.
      if (!isSheetOpen()) bb.hide?.();
      return;
    }
    const cb = () => {
      if (isSheetOpen()) return; // the sheet's own handler closes it
      ref.current?.();
    };
    bb.show?.();
    bb.onClick?.(cb);
    return () => {
      bb.offClick?.(cb);
      if (!isSheetOpen()) bb.hide?.();
    };
  }, [enabled]);
}

/**
 * Shows Telegram's native MainButton with `text` while mounted; `text === null` hides it.
 * The click handler is registered once while the button is shown, so changing `text` only
 * updates the label (no hide/show flicker); progress is applied after the params.
 */
export function useMainButton(text: string | null, handler: () => void, opts: { progress?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = text !== null;
  const progress = !!opts.progress;

  useEffect(() => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb) return;
    if (!enabled) {
      mb.hideProgress?.();
      mb.hide?.();
      return;
    }
    const cb = () => ref.current();
    mb.onClick?.(cb);
    return () => {
      mb.offClick?.(cb);
      mb.hideProgress?.();
      mb.hide?.();
    };
  }, [enabled]);

  useEffect(() => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb || text === null) return;
    mb.setParams?.({ text, is_visible: true });
    if (progress) mb.showProgress?.(false);
    else mb.hideProgress?.();
  }, [text, progress]);
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' | 'error' | 'select') {
  const h = window.Telegram?.WebApp?.HapticFeedback;
  if (!h) return;
  if (kind === 'light' || kind === 'medium') h.impactOccurred(kind);
  else if (kind === 'select') h.selectionChanged();
  else h.notificationOccurred(kind);
}
