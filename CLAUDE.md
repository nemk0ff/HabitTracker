# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Habit Tracker is a **Telegram Mini App** — a React SPA served inside Telegram's WebView. Users open it via a bot button; the bot also sends reminders and delivers daily analytics reports. The backend serves the frontend as static files from `public/` and exposes a REST API.

**Stack:** React 19, Vite, Tailwind CSS, Framer Motion, Zustand (frontend) · Fastify v5, Prisma, SQLite/PostgreSQL, grammY, node-cron (backend) · date-fns with Russian locale for all date formatting

**Tests:** None. Use `tsc --noEmit` in `frontend/` or `backend/` as the primary correctness check.

## Commands

### Root (single-command dev launcher)
```bash
npm run dev          # build frontend + start tunnel + start backend (scripts/dev.mjs)
```

### Backend (`cd backend`)
```bash
npm run dev          # Start with tsx watch (hot reload)
npm run build        # tsc compile to dist/
npm start            # Run compiled dist/index.js

npm run db:migrate   # prisma migrate dev (creates migration files)
npm run db:push      # prisma db push (sync schema without migration, use in dev)
npm run db:generate  # prisma generate (regenerate client after schema change)
```

### Frontend (`cd frontend`)
```bash
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc + vite build → output goes to backend/public/
npm run preview      # Preview production build
```

## Environment Setup

Create `backend/.env`:
```env
DATABASE_URL="file:./prisma/dev.db"   # SQLite for dev; PostgreSQL URL for prod
BOT_TOKEN="your_telegram_bot_token"
JWT_SECRET="random_secret_key"
PORT=3001
WEBAPP_URL="https://your-domain.com"  # auto-set by dev.mjs; used for menu button + /start button
DEVELOPER_CHAT_ID="your_telegram_id"  # if set: receives daily reports, tunnel URL on restart, /stats command
SOCKS_PROXY="socks5://127.0.0.1:1080" # optional: SOCKS5 proxy for Telegram API (needed if api.telegram.org is blocked by the host)
CLAUDE_PROXY="http://127.0.0.1:3128"  # optional: HTTP proxy (alternative to SOCKS_PROXY; preferred over SOCKS_PROXY if both set)
KEEP_ALIVE_SECRET="random_secret"     # Bearer token for /api/claude/session-start (shared with keep-alive.mjs)
CLAUDE_SESSION_STATE_PATH="/tmp/claude-session.json" # where claudeSessions.ts persists session state (defaults to /tmp/claude-session.json)
CLAUDE_CODE_OAUTH_TOKEN="..."         # long-lived Claude Code OAuth token for keep-alive.mjs on VPS
```

Frontend uses `VITE_API_URL` (optional) — defaults to empty string so API calls go to the same origin (works when backend serves the built frontend).

## Architecture

### Request Flow
1. Telegram opens the Mini App URL → serves `index.html` from `backend/public/`
2. Frontend calls `window.Telegram.WebApp.initData` → POSTs it to `/api/auth`
3. Backend validates initData HMAC against `BOT_TOKEN`, upserts User, returns JWT
4. Frontend stores JWT in memory (`authStore`), attaches it as `Authorization: Bearer` on all subsequent requests
5. All `/api/*` routes (except `/api/auth`) require the JWT via `authGuard` middleware

### Dev Mode Bypass
In development (`NODE_ENV !== 'production'`), sending `initData: "dev-mode"` to `/api/auth` bypasses Telegram validation and returns a test user (`telegramId: 999999`). The frontend sends this automatically when `import.meta.env.DEV` is true.

### Frontend State Management
Navigation is state-driven via Zustand — there is **no router**. `habitsStore` holds a `screen` field (`'home' | 'habit' | 'create' | 'edit'`) and `selectedHabitId`. `AnimatePresence` in `App.tsx` handles transitions between screens.

Telegram's native `BackButton` and `MainButton` (from `window.Telegram.WebApp`) are used for navigation and primary actions instead of custom UI buttons. `HapticFeedback` is used for tactile responses on interactions.

### Dev Launcher (`scripts/dev.mjs`)
ESM Node.js script for local development. CloudPub gives a **stable** URL, so there is no tunnel rotation or health-monitor loop (unlike the old localtunnel/tunnelmole versions):
1. Reads `backend/.env`, validates `BOT_TOKEN`, applies `SOCKS_PROXY` to `process.env`
2. `ensureCloudpubUrl(3001)` — runs `clo ls` to find the `https://<name>.cloudpub.ru` mapped to port 3001; registers it (`clo register http 3001 -n habit-tracker`) if missing. Best-effort: if the `clo` CLI is absent it prints manual instructions and continues
3. Writes `WEBAPP_URL` into `backend/.env` (only if changed) **before** starting the backend, so it boots with the right URL (no restart)
4. Builds frontend synchronously (`spawnSync`), then spawns backend (`npm run dev`)
5. After the backend is healthy, calls `setChatMenuButton` twice — global (default) + per-developer chat (busts Telegram client cache) — and notifies the developer

**Windows path note:** Uses `fileURLToPath(new URL(..., import.meta.url))` for cross-platform path resolution.

**SOCKS proxy note:** If `SOCKS_PROXY` is set in `backend/.env`, dev.mjs applies it to `process.env` at startup so all Telegram API calls (`setChatMenuButton`, `sendMessage`) route through the proxy via `socks-proxy-agent`. Needed on hosts where `api.telegram.org` is blocked (e.g. VPS providers that share Telegram's IP range `149.154.0.0/16`).

### Reminder Scheduler
`startScheduler()` runs a `node-cron` job every minute (UTC). It checks for reminders matching current UTC time and day, sends Telegram messages via `bot.api.sendMessage`, and handles snooze (re-sends every 5 min for up to 1 hour if the habit isn't checked).

### Analytics (`src/services/analytics.ts`)
`track(opts)` is **void/fire-and-forget** — wraps `prisma.analyticsEvent.create()` in both a synchronous try/catch and a `.catch()` so analytics failures never propagate to API handlers or bot handlers.

Events tracked automatically:

| Event | Source |
|---|---|
| `user_registered` / `app_open` | `routes/auth.ts` |
| `habit_created/edited/deleted` | `routes/habits.ts` |
| `entry_checked` / `entry_unchecked` | `routes/entries.ts` |
| `reminder_enabled/disabled/deleted` | `routes/reminders.ts` |
| `command_start` / `command_help` / `message_received` | `services/bot.ts` |

Aggregate helpers: `getDau()`, `getWau()`, `getNewUsersCount()`, `getTopEvents()` — use Prisma `findMany + distinct` and `groupBy` for SQLite/PostgreSQL compatibility (no raw SQL).

### Alerts (`src/services/alerts.ts`)
`startAlerts()` schedules a `node-cron` job at `'0 9 * * *'` (09:00 UTC). Sends an HTML-formatted daily report to `DEVELOPER_CHAT_ID`. Includes an anomaly alert if 0 new users 2 days in a row.

`sendQuickStats(chatId)` — called by `/stats` bot command (restricted to `DEVELOPER_CHAT_ID`).

### Entry Value Semantics
`HabitEntry.value` encodes intensity: `1`=light, `2`=medium, `3`=hard, `4`=extra. For **binary habits** (`Habit.binary=true`) the UI only records `value=1` (done) or deletes the entry (not done) — no intensity picker shown. Sending `value=0` to `POST /habits/:id/entries` deletes the entry for that date.

`GET /habits` eagerly loads the last 18 weeks of entries for all habits in one query — no separate pagination.

### Heatmap Interaction
Clicking a cell in `Heatmap.tsx` cycles intensity: `0 → 1 → 2 → 3 → 0`. The change is applied as an optimistic update in `habitsStore.toggleEntry` (store updated before the API call; reverts via full `load()` on error). `MiniHeatmap` is read-only; `HabitCard` wraps it in a flex-grow container and uses a `ResizeObserver` to recompute the `weeks` prop on every container width change (each column = 14px), so the heatmap is responsive to window resizing in desktop Telegram (Mac/Windows).

### Habit Card Layout
Card has two columns: left (heatmap, `flex-1`) and right (checkbox, icon, name, streak). The right column uses `w-fit min-w-14 max-w-[160px]` so its width adapts to the habit name; together with the heatmap's `ResizeObserver`, this means short names give the heatmap more space and long names give the name more space. Habit name is capped at 20 characters — enforced by `maxLength={20}` on the input in `HabitFormPage.tsx` and validated server-side in `routes/habits.ts` (POST and PATCH return 400 for names > 20 chars).

### Frontend Utilities
- `frontend/src/utils/dates.ts` — `getWeeksGrid`, `calculateStreak`, `getMonthCompletionRate`, `toDateString`, `WEEKDAY_LABELS`; uses `date-fns/locale/ru` for Russian month names
- `frontend/src/utils/colors.ts` — `HABIT_COLORS` palette, `getHeatmapColor(baseColor, value)` (opacity levels: 0.3 / 0.6 / 1.0 for values 1–3), `getEmptyColor(isDark)` for empty cells

### Reminder Time Picker
Reminder time is set via `NotificationSheet.tsx` (bottom sheet, opened from `HabitDetailPage`), which uses a custom iOS-style `WheelPicker.tsx` for hours/minutes. The wheel uses `mask-image` (not gradient overlays) for the fade effect and a border-only selection indicator so digits stay visible — see the recent commit history before changing its CSS, as z-index/mask layering has been a recurring source of bugs.

### Bot Transport
grammY uses **long-polling** (not webhooks). The bot starts with `bot.start()` inside `startBot()` in `services/bot.ts` after the Fastify server is listening.

### Claude Session Management
Keeps Claude Code's 5-hour usage window alive on VPS production so the session doesn't expire between uses.

- **`scripts/keep-alive.mjs`** — run every 5 hours via VPS cron: `0 */5 * * * cd /habitBot/HabitTracker && /usr/bin/node scripts/keep-alive.mjs`. Reads `backend/.env`, executes `claude -p "привет"` (minimal prompt to hold the session open), then POSTs to `/api/claude/session-start` with `Authorization: Bearer <KEEP_ALIVE_SECRET>`. Supports both `CLAUDE_PROXY` (HTTP) and `SOCKS_PROXY` (SOCKS5) — HTTP preferred when both are set. Requires `CLAUDE_CODE_OAUTH_TOKEN` for a stable long-lived auth token.
- **`backend/src/middleware/sharedSecretGuard.ts`** — validates the Bearer token on `/api/claude/session-start` against `KEEP_ALIVE_SECRET`; returns 401 if wrong, 503 if `KEEP_ALIVE_SECRET` is not configured.
- **`backend/src/services/claudeSessions.ts`** — persists session state (start time, warning-sent flag) to a JSON file at `CLAUDE_SESSION_STATE_PATH`. `registerSessionStart()` records a new 5-hour window and notifies `DEVELOPER_CHAT_ID` via Telegram. `startSessionWarningCron()` (called at startup) checks every minute and sends a 30-min-before-expiry warning; cleans up the state file 5 minutes after session ends.
- **Bot command `/claude_session`** — developer-only; calls `registerSessionStart({ force: true })` to manually register a session from Telegram.

### Production Tunnel — CloudPub (`scripts/cf-tunnel.sh`)
The VPS exposes the backend via **CloudPub**, not the dev launcher. CloudPub runs as a persistent systemd service (`cloudpub.service` → `clo run --run-as-service`) that serves all registered publications on **stable** `https://<name>.cloudpub.ru` subdomains. The habit tracker's URL is fixed (`feverishly-warranted-mandrill.cloudpub.ru` → port 3001).

Because the URL never rotates, `cf-tunnel.sh` is now a **one-shot idempotent sync** (filename kept for continuity), NOT a long-running pm2 daemon — the old crash-looping `cf-tunnel` pm2 app was removed. Run it once after deploy or when the URL changes:
1. Waits for `/api/health`, ensures `cloudpub.service` is running (never restarts it — that would drop sibling apps' tunnels)
2. Reads the stable URL from `clo ls`; registers the publication (`clo register http 3001 -n habit-tracker`) if missing — registration activates immediately, no daemon restart
3. Updates `WEBAPP_URL` in `backend/.env` **only if changed**; exits early if already current
4. Sets the Telegram menu button (global + per-developer chat) and notifies the developer. JSON payloads are built with `python3 json.dumps` so Cyrillic is `\u`-escaped (avoids the bash UTF-8 quoting pitfall)
5. `pm2 restart habit-backend` so the `/start` button serves the new URL (backend loads `.env` via `node --env-file`)

**Backend runs the compiled build in production:** `pm2 start dist/index.js --name habit-backend --node-args="--env-file=.../backend/.env"` (like the sibling bots), NOT `tsx watch` — the watcher's server child can die while pm2 still shows "online", leaving port 3001 dead.

### API Routes
All routes require `Authorization: Bearer <jwt>` except `POST /api/auth` and `POST /api/claude/session-start`.
- `POST /api/auth` — validate Telegram initData, return JWT
- `POST /api/claude/session-start` — register a Claude Code session start; requires `Authorization: Bearer <KEEP_ALIVE_SECRET>` (sharedSecretGuard, not authGuard)
- `GET/POST /api/habits` — list (18 weeks entries included) / create
- `PATCH/DELETE /api/habits/:id` — update / hard-delete (ignores the `archived` flag; DELETE removes the row)
- `GET/POST /api/habits/:id/entries` — fetch or upsert entries (POST with `value=0` deletes)
- `GET/PUT/DELETE /api/habits/:id/reminder` — get / upsert / delete reminder config

### Database Schema (SQLite/PostgreSQL via Prisma)
- `User` — identified by `telegramId` (BigInt)
- `Habit` — belongs to User; has `color`, `icon` (emoji), `binary` flag, `archived` flag (schema only — `DELETE /habits/:id` hard-deletes, doesn't soft-archive)
- `HabitEntry` — one per (habit, date); `value` is 1–4 (intensity levels); unique on `[habitId, date]`
- `Reminder` — one per Habit (1:1); stores `days` as JSON string, `time` as `HH:MM` UTC, `snooze` bool, `lastMessageId` for deletion
- `AnalyticsEvent` — append-only event log; `userId` nullable (SetNull on user delete); `metadata` stored as JSON string; indexed on `[event]`, `[userId]`, `[createdAt]`, `[event, createdAt]`

### Prisma Client Regeneration (Windows caveat)
After `db:push` or `db:migrate`, Prisma tries to replace `query_engine-windows.dll.node`. If the backend is running, this rename fails with EPERM (DLL is locked). Fix: stop the server, run `npm run db:generate`, restart. If this is skipped, `prisma.analyticsEvent` will be `undefined` at runtime — `track()` handles this silently, but other new models would cause 500s.

### Production Deployment
Build frontend → copy `dist/` to `backend/public/` → backend serves it. The backend is the single deployable unit. See `Dockerfile` and `fly.toml` for production setup.
