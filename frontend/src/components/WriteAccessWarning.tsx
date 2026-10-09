import { useState } from 'react';
import { MessageCircleOff } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ensureWriteAccess } from '../utils/writeAccess';

/** True when a check-in is scheduled but Telegram doesn't let the bot message the user. */
export function useCantMessage(): boolean {
  return useAuthStore(
    (s) => !!(s.user?.checkinTime || s.user?.morningCheckinTime) && s.user?.canMessage === false,
  );
}

/** «Бот не может тебе писать» + [Разрешить]. Used on Today (card) and in Settings (row). */
export function WriteAccessWarning({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <section
      role="status"
      className={`rounded-2xl p-4 flex items-center gap-3 ${className}`}
      style={{ backgroundColor: 'color-mix(in srgb, var(--over, #e5484d) 10%, transparent)' }}
    >
      <MessageCircleOff size={20} className="shrink-0" style={{ color: 'var(--over, #e5484d)' }} aria-hidden />
      <p className="flex-1 min-w-0 text-sm font-medium text-tg-text">Бот не может тебе писать — сводка не придёт</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await ensureWriteAccess();
          setBusy(false);
        }}
        className="min-h-[44px] px-4 shrink-0 rounded-xl text-sm font-semibold text-white active:opacity-80 disabled:opacity-60"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        Разрешить
      </button>
    </section>
  );
}
