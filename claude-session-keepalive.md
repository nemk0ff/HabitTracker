# Claude Code Session Keep-Alive System

Документация для переноса этой реализации в другой проект с отдельным Telegram-ботом.

## Назначение

Claude Code (CLI) имеет 5-часовое окно сессии. Если за 5 часов не было ни одного промпта, сессия «засыпает» и токены сгорают. Эта система:

1. Каждые 5 часов запускает на VPS минимальный промпт `claude -p "привет"` через cron
2. Сообщает бэкенду о старте новой сессии (POST-запрос с Bearer-токеном)
3. Бэкенд сохраняет состояние сессии и отправляет уведомления в Telegram-бот:
   - «Новая сессия Claude» при старте
   - «Осталось 30 минут» перед концом окна

---

## Компоненты

### 1. `scripts/keep-alive.mjs` — VPS-скрипт (cron)

ESM Node.js скрипт. Запускается по крону каждые 5 часов:

```
0 */5 * * * cd /путь/к/проекту && /usr/bin/node scripts/keep-alive.mjs >> /tmp/keep-alive.log 2>&1
```

**Что делает:**
1. Читает `backend/.env` (парсит вручную, без dotenv)
2. Настраивает прокси из `CLAUDE_PROXY` (HTTP) или `SOCKS_PROXY` (SOCKS5) — HTTP предпочтительнее, т.к. `claude` CLI отклоняет `socks5://` в `HTTPS_PROXY`
3. Устанавливает `CLAUDE_CODE_OAUTH_TOKEN` — long-lived токен, который не перезаписывается при обновлении токена на другой машине
4. Запускает `claude -p "привет"` через `spawnSync` (таймаут 60 с)
5. При успехе POST-запрос на `http://localhost:3001/api/claude/session-start` с `Authorization: Bearer <KEEP_ALIVE_SECRET>`

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, 'backend', '.env');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

function parseEnv(raw) {
  const map = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function ts() {
  return new Date().toISOString();
}

async function main() {
  let raw;
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch (err) {
    console.error(`[${ts()}] [keep-alive] Cannot read ${ENV_PATH}:`, err.message);
    process.exit(1);
  }
  const env = parseEnv(raw);

  if (!env.KEEP_ALIVE_SECRET) {
    console.error(`[${ts()}] [keep-alive] KEEP_ALIVE_SECRET missing in backend/.env`);
    process.exit(1);
  }

  const claudeProxy = env.CLAUDE_PROXY || env.SOCKS_PROXY || '';
  const childEnv = { ...process.env };
  if (claudeProxy) {
    childEnv.HTTPS_PROXY = claudeProxy;
    childEnv.HTTP_PROXY = claudeProxy;
    childEnv.ALL_PROXY = claudeProxy;
    console.log(`[${ts()}] [keep-alive] Using proxy: ${claudeProxy}`);
  } else {
    console.log(`[${ts()}] [keep-alive] No CLAUDE_PROXY/SOCKS_PROXY in .env — running without proxy`);
  }

  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    console.warn(`[${ts()}] [keep-alive] CLAUDE_CODE_OAUTH_TOKEN missing — relying on ~/.claude/.credentials.json (will break when local Claude refreshes)`);
  }

  console.log(`[${ts()}] [keep-alive] Running: claude -p "привет"`);
  const result = spawnSync('claude', ['-p', 'привет'], {
    env: childEnv,
    stdio: 'inherit',
    shell: false,
    timeout: 60_000,
  });

  if (result.error) {
    console.error(`[${ts()}] [keep-alive] Failed to spawn claude:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[${ts()}] [keep-alive] claude exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[${ts()}] [keep-alive] claude OK — notifying backend`);
  try {
    const res = await fetch(`${BACKEND_URL}/api/claude/session-start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.KEEP_ALIVE_SECRET}` },
    });
    if (!res.ok) {
      console.error(`[${ts()}] [keep-alive] Backend returned ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    console.log(`[${ts()}] [keep-alive] Done`);
  } catch (err) {
    console.error(`[${ts()}] [keep-alive] Backend POST failed:`, err.message);
    process.exit(1);
  }
}

main();
```

---

### 2. `backend/src/middleware/sharedSecretGuard.ts` — Fastify middleware

Защищает `/api/claude/session-start` — проверяет `Authorization: Bearer <KEEP_ALIVE_SECRET>`. Используется вместо стандартного JWT-гарда.

```ts
import { FastifyRequest, FastifyReply } from 'fastify';

export async function sharedSecretGuard(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.KEEP_ALIVE_SECRET;
  if (!expected) {
    return reply.status(503).send({ error: 'KEEP_ALIVE_SECRET not configured' });
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.slice(7) !== expected) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
```

---

### 3. `backend/src/routes/claudeSession.ts` — Fastify route

Регистрирует `POST /api/claude/session-start`. Защищён `sharedSecretGuard`.

```ts
import { FastifyInstance } from 'fastify';
import { sharedSecretGuard } from '../middleware/sharedSecretGuard.js';
import { registerSessionStart } from '../services/claudeSessions.js';

export async function claudeSessionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', sharedSecretGuard);

  app.post('/claude/session-start', async (_request, reply) => {
    await registerSessionStart();
    return reply.send({ ok: true });
  });
}
```

Регистрация в `index.ts`:
```ts
import { claudeSessionRoutes } from './routes/claudeSession.js';
// ...
app.register(claudeSessionRoutes, { prefix: '/api' });
```

---

### 4. `backend/src/services/claudeSessions.ts` — Сервис отслеживания сессий

Хранит состояние сессии в JSON-файле. Запускает cron каждую минуту для проверки предупреждения. Отправляет уведомления через `sendMessage()` бота.

**Интерфейс состояния:**
```ts
interface SessionState {
  sessionStart: string; // ISO 8601
  warningSent: boolean;
}
```

**Путь к файлу состояния:** `CLAUDE_SESSION_STATE_PATH` env var, дефолт `/tmp/claude-session.json`.

**Константы:**
- `SESSION_DURATION_MS` = 5 часов
- `WARNING_BEFORE_END_MS` = 30 минут
- `CLEANUP_AFTER_END_MS` = 5 минут (после конца сессии файл удаляется)

```ts
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
    await saveState({ ...state, warningSent: true });
    if (DEVELOPER_CHAT_ID) {
      await sendMessage(
        DEVELOPER_CHAT_ID,
        '⚠️ <b>До конца сессии Claude осталось 30 минут</b>\nНе забудь потратить токены, если они ещё нужны.',
      );
    }
  }
}

export function startSessionWarningCron(): void {
  cron.schedule('* * * * *', () => {
    checkSessionWarning().catch((err) => console.error('[claudeSessions] Cron error:', err));
  });
  console.log('[claudeSessions] Session warning cron started (runs every minute)');
}
```

Вызов в `index.ts` после старта сервера:
```ts
import { startSessionWarningCron } from './services/claudeSessions.js';
// ...
startSessionWarningCron();
```

---

### 5. Telegram-команда `/claude_session` (в `bot.ts`)

Позволяет вручную зарегистрировать сессию из Telegram (только для `DEVELOPER_CHAT_ID`).

```ts
bot.command('claude_session', async (ctx) => {
  if (!DEVELOPER_CHAT_ID || ctx.from?.id.toString() !== DEVELOPER_CHAT_ID) return;
  const { registerSessionStart } = await import('./claudeSessions.js');
  await registerSessionStart({ force: true });
});
```

---

## Переменные окружения (`backend/.env`)

```env
KEEP_ALIVE_SECRET="random_secret"
# Shared Bearer token между keep-alive.mjs и sharedSecretGuard.ts

CLAUDE_SESSION_STATE_PATH="/tmp/claude-session.json"
# Путь к файлу состояния сессии. Дефолт: /tmp/claude-session.json

CLAUDE_CODE_OAUTH_TOKEN="..."
# Long-lived OAuth токен для Claude Code CLI.
# Получается через `claude setup-token` на VPS.
# Без него скрипт упадёт, когда другой инстанс Claude (на ноуте) обновит токены в ~/.claude/.credentials.json

CLAUDE_PROXY="http://127.0.0.1:3128"
# HTTP прокси для Claude CLI. Предпочтительнее SOCKS_PROXY,
# т.к. claude CLI отклоняет socks5:// в HTTPS_PROXY.
# Если не задан, используется SOCKS_PROXY.

DEVELOPER_CHAT_ID="ваш_telegram_id"
# Куда отправлять уведомления о сессии
```

---

## Зависимости бэкенда

Новых npm-зависимостей нет — `node-cron` уже используется в планировщике напоминаний, `fs/promises` встроен в Node.js.

---

## Поток данных

```
VPS cron (каждые 5ч)
  └─► keep-alive.mjs
        ├─► claude -p "привет"   (держит 5-часовое окно)
        └─► POST /api/claude/session-start  (Bearer KEEP_ALIVE_SECRET)
              └─► sharedSecretGuard  (проверяет токен)
                    └─► registerSessionStart()
                          ├─► saveState()  → /tmp/claude-session.json
                          └─► sendMessage(DEVELOPER_CHAT_ID, "🚀 Новая сессия...")

startSessionWarningCron()  (каждую минуту)
  └─► checkSessionWarning()
        ├─► если осталось < 30 мин  → sendMessage("⚠️ 30 минут...")
        └─► если сессия кончилась + 5 мин  → clearState()

Telegram: /claude_session
  └─► registerSessionStart({ force: true })  (принудительно, даже если сессия ещё активна)
```

---

## Настройка на VPS

1. Установить Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Авторизоваться: `claude` (интерактивный логин)
3. Получить long-lived токен: `claude setup-token` → скопировать в `CLAUDE_CODE_OAUTH_TOKEN`
4. Добавить в `backend/.env` переменные `KEEP_ALIVE_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`, и при необходимости `CLAUDE_PROXY`
5. Добавить cron: `crontab -e`
   ```
   0 */5 * * * cd /путь/к/проекту && /usr/bin/node scripts/keep-alive.mjs >> /tmp/keep-alive.log 2>&1
   ```
6. Убедиться, что бэкенд запущен (pm2 или systemd) — скрипт обращается на `http://localhost:3001`
