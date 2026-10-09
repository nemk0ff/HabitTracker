import { requestWriteAccessApi } from '../api/me';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';

const DENIED_TEXT = 'Без разрешения бот не сможет написать — включишь в настройках';
const BLOCKED_TEXT = 'Похоже, бот заблокирован — разблокируй его в чате и нажми /start';

/** Asks Telegram for permission (Bot API 6.9+). Resolves null when the client can't ask. */
function askTelegram(): Promise<boolean | null> {
  const wa = window.Telegram?.WebApp;
  if (!wa?.requestWriteAccess || (wa.isVersionAtLeast && !wa.isVersionAtLeast('6.9'))) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      wa.requestWriteAccess!((granted) => resolve(!!granted));
    } catch {
      resolve(null);
    }
  });
}

let inFlight: Promise<boolean> | null = null;

/**
 * Makes sure the bot can message the user (check-ins, reminders). Already allowed → true.
 * Otherwise asks Telegram for write access and lets the backend verify the channel (it sends a
 * confirmation message). Refusal → explaining toast, false. Concurrent calls share one prompt.
 */
export function ensureWriteAccess(): Promise<boolean> {
  if (useAuthStore.getState().user?.canMessage === true) return Promise.resolve(true);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // null = can't ask (plain browser / old client): let the backend just try to send.
      const granted = await askTelegram();
      if (granted === false) {
        haptic('warning');
        toast(DENIED_TEXT, { ms: 5000 });
        return false;
      }
      try {
        const { canMessage } = await requestWriteAccessApi();
        useAuthStore.getState().patchUser({ canMessage });
        if (canMessage) haptic('success');
        // Telegram said yes but the send still failed → the bot is blocked in the chat.
        else toast(granted === true ? BLOCKED_TEXT : DENIED_TEXT, { ms: 5000 });
        return canMessage;
      } catch {
        toast('Не удалось проверить связь с ботом, попробуй ещё раз', { tone: 'error' });
        return false;
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
