import { readFile, writeFile, unlink } from 'fs/promises';
import cron from 'node-cron';
import { sendMessage } from './bot.js';

const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';
const STATE_PATH = process.env.CLAUDE_SESSION_STATE_PATH || '/tmp/claude-session.json';

const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
const WARNING_BEFORE_END_MS = 30 * 60 * 1000;
const CLEANUP_AFTER_END_MS = 5 * 60 * 1000;

interface SessionState {
  sessionStart: string;
  warningSent: boolean;
}

async function loadState(): Promise<SessionState | null> {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw) as SessionState;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    console.error('[claudeSessions] Failed to read state:', err);
    return null;
  }
}

async function saveState(state: SessionState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function clearState(): Promise<void> {
  try {
    await unlink(STATE_PATH);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error('[claudeSessions] Failed to clear state:', err);
  }
}

function formatUtcHHMM(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export async function registerSessionStart(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    const existing = await loadState();
    if (existing) {
      const existingStart = new Date(existing.sessionStart).getTime();
      if (!Number.isNaN(existingStart) && Date.now() < existingStart + SESSION_DURATION_MS) {
        console.log(
          `[claudeSessions] Existing window still active (started ${existing.sessionStart}) — skipping new-session notification`,
        );
        return;
      }
    }
  }

  const start = new Date();
  await saveState({ sessionStart: start.toISOString(), warningSent: false });

  if (!DEVELOPER_CHAT_ID) {
    console.warn('[claudeSessions] DEVELOPER_CHAT_ID not set — skipping notification');
    return;
  }

  const end = new Date(start.getTime() + SESSION_DURATION_MS);
  const text =
    `🚀 <b>Новая сессия Claude</b>\n` +
    `Окно действует до <b>${formatUtcHHMM(end)} UTC</b>\n` +
    `(старт: ${formatUtcHHMM(start)} UTC)`;
  await sendMessage(DEVELOPER_CHAT_ID, text);
}

async function checkSessionWarning(): Promise<void> {
  const state = await loadState();
  if (!state) return;

  const start = new Date(state.sessionStart).getTime();
  if (Number.isNaN(start)) {
    console.error('[claudeSessions] Invalid sessionStart in state, clearing');
    await clearState();
    return;
  }

  const now = Date.now();
  const warningAt = start + SESSION_DURATION_MS - WARNING_BEFORE_END_MS;
  const cleanupAt = start + SESSION_DURATION_MS + CLEANUP_AFTER_END_MS;

  if (now >= cleanupAt) {
    await clearState();
    return;
  }

  if (!state.warningSent && now >= warningAt) {
    if (!DEVELOPER_CHAT_ID) return;
    const sent = await sendMessage(
      DEVELOPER_CHAT_ID,
      '⚠️ <b>До конца сессии Claude осталось 30 минут</b>\nНе забудь потратить токены, если они ещё нужны.',
    );
    // Mark only after a successful send, so a Telegram hiccup is retried next minute.
    if (sent) await saveState({ ...state, warningSent: true });
  }
}

export function startSessionWarningCron(): void {
  cron.schedule(
    '* * * * *',
    () => {
      checkSessionWarning().catch((err) => console.error('[claudeSessions] Cron error:', err));
    },
    { timezone: 'UTC' },
  );
  console.log('[claudeSessions] Session warning cron started (runs every minute)');
}
