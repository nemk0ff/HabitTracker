/**
 * Client for the developer's Hermes agent — an OpenAI-compatible
 * /v1/chat/completions endpoint reachable on the VPS through a reverse SSH
 * tunnel (HERMES_API_URL, default http://127.0.0.1:8642). The agent runs on a
 * laptop, so it is often offline: every failure becomes a HermesError with a
 * message that can be shown to the user as-is.
 */

const DEFAULT_URL = 'http://127.0.0.1:8642';
/** The agent calls tools (web search) before answering — allow several minutes. */
const TIMEOUT_MS = 240_000;

export class HermesError extends Error {}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function hermesConfigured(): boolean {
  return !!process.env.HERMES_API_KEY;
}

/** Accepts a base URL, a `/v1` URL or the full `/chat/completions` URL. */
function endpoint(): string {
  const base = (process.env.HERMES_API_URL || DEFAULT_URL).replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** One stateless completion: the whole conversation goes in `messages`. */
export async function hermesChat(messages: ChatMessage[]): Promise<string> {
  if (!hermesConfigured()) throw new HermesError('Агент не настроен (нет HERMES_API_KEY на сервере)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HERMES_API_KEY}`,
      },
      body: JSON.stringify({ model: 'hermes-agent', messages, stream: false }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new HermesError(`Агент не ответил за ${TIMEOUT_MS / 60_000} мин — попробуй ещё раз позже`);
    }
    // Connection refused / reset: the laptop or the SSH tunnel is down.
    console.error('[hermes] connection error:', e);
    throw new HermesError('Агент сейчас недоступен (ноутбук выключен или туннель упал) — попробуй позже');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[hermes] HTTP ${res.status}:`, body.slice(0, 500));
    throw new HermesError(
      res.status === 401 || res.status === 403
        ? 'Агент отклонил ключ (проверь HERMES_API_KEY)'
        : `Агент вернул ошибку ${res.status}`,
    );
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new HermesError('Агент вернул пустой ответ');
  return content;
}

/** The agent replies in free text; take the outermost JSON object (tolerates ```json fences and prose around it). */
export function extractJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new HermesError('Агент ответил не в том формате');
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new HermesError('Агент ответил не в том формате');
  }
}
