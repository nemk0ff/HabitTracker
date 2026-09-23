import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Same sheet chrome as NotificationSheet: dimmed backdrop + spring slide-up panel.
 * Portaled to <body> so a transformed ancestor (e.g. an animated card) can't break
 * `position: fixed`; clicks are stopped so they don't reach ancestor React handlers.
 */
export function BottomSheet({ open, onClose, children }: Props) {
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
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-tg-bg rounded-t-2xl max-h-[88vh] overflow-y-auto"
            >
              <div className="p-5">
                <div className="w-9 h-1 bg-tg-hint/30 rounded-full mx-auto mb-5" />
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
