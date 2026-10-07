import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '../stores/toastStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNutritionStore } from '../stores/nutritionStore';

/**
 * Single bottom toast: confirmations with "Отменить" and network errors.
 * Store errors were previously recorded but never shown — surfaced here.
 */
export function Toaster() {
  const { toast, show, hide } = useToastStore();
  const habitsError = useHabitsStore((s) => s.error);
  const nutritionError = useNutritionStore((s) => s.error);

  useEffect(() => {
    if (habitsError) show(`Не сохранилось: ${habitsError}`, { tone: 'error', ms: 5000 });
  }, [habitsError, show]);
  useEffect(() => {
    if (nutritionError) show(`Не сохранилось: ${nutritionError}`, { tone: 'error', ms: 5000 });
  }, [nutritionError, show]);

  return createPortal(
    <div className="fixed left-0 right-0 bottom-4 z-[60] flex justify-center px-4 pointer-events-none">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto max-w-md w-full rounded-2xl px-4 py-3 flex gap-3 shadow-lg ${
              toast.actions.length > 1 ? 'flex-col' : 'items-center'
            }`}
            style={{
              backgroundColor: toast.tone === 'error' ? 'var(--over)' : 'var(--tg-theme-text-color)',
              color: 'var(--tg-theme-bg-color)',
            }}
          >
            <span className="flex-1 text-sm leading-snug">{toast.text}</span>
            {/* Several actions (e.g. intensity choice + undo) get their own row */}
            <div className={toast.actions.length > 1 ? 'flex gap-2 -mx-1' : 'contents'}>
              {toast.actions.map((a, i) => (
                <button
                  key={a.label}
                  onClick={() => {
                    a.onClick();
                    hide();
                  }}
                  className={`shrink-0 text-sm font-semibold min-h-[36px] px-1 ${
                    toast.actions.length > 1 && i < toast.actions.length - 1
                      ? 'flex-1 rounded-lg toast-chip'
                      : toast.actions.length > 1
                        ? 'ml-auto px-2'
                        : ''
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
