import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

/** Invite to the evening check-in in the bot (users with habits but no check-in time). */
export function CheckinBanner({ onAccept, onOther, onDismiss }: { onAccept: () => Promise<void>; onOther: () => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section
      className="relative rounded-2xl p-4 pr-12 mb-5"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Скрыть"
        className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-tg-hint active:opacity-60"
      >
        <X size={18} aria-hidden />
      </button>
      <p className="text-base font-medium text-tg-text flex items-start gap-1.5">
        <MessageCircle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} aria-hidden />
        Отмечать привычки прямо в чате?
      </p>
      <p className="text-sm text-tg-hint mt-0.5">Бот напишет вечером один раз</p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAccept();
            setBusy(false);
          }}
          className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white active:opacity-80 disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          В 21:00
        </button>
        <button
          type="button"
          onClick={onOther}
          className="min-h-[44px] px-4 rounded-xl text-sm font-medium bg-tg-section text-tg-text active:opacity-70"
        >
          Другое время
        </button>
      </div>
    </section>
  );
}
