import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSheetBackButton } from '../../hooks/useTelegramButtons';

export { isSheetOpen } from '../../hooks/useTelegramButtons';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name. Without it the sheet's first heading is used, then «Окно». */
  label?: string;
  /** Panel max height (Tailwind class). */
  maxHeightClass?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal bottom sheet: dimmed backdrop + spring slide-up panel, role="dialog".
 * - focus moves into the panel on open and returns to the opener on close; Tab is trapped;
 * - Escape and Telegram's native BackButton close the top-most sheet (pages ignore Back
 *   while a sheet is open — see useSheetBackButton);
 * - portaled to <body> so a transformed ancestor (e.g. an animated card) can't break
 *   `position: fixed`; clicks are stopped so they don't reach ancestor React handlers.
 */
export function BottomSheet({ open, onClose, children, label, maxHeightClass = 'max-h-[88vh]' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useSheetBackButton(open, onClose);

  // Focus management: remember the opener, focus the panel, restore on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (!label) {
        const heading = panel.querySelector('h1, h2, h3');
        const text = heading?.textContent?.trim();
        if (text) panel.setAttribute('aria-label', text);
      }
      if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, label]);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div onClick={(e) => e.stopPropagation()}>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={label ?? 'Окно'}
              tabIndex={-1}
              onKeyDown={trapTab}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={`fixed bottom-0 left-0 right-0 z-50 bg-tg-bg rounded-t-2xl ${maxHeightClass} overflow-y-auto outline-none`}
            >
              <div className="p-5">
                <div className="w-9 h-1 bg-tg-hint/30 rounded-full mx-auto mb-5" aria-hidden="true" />
                {children}
                <div className="h-6" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
