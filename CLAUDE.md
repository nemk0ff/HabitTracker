# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Habit Tracker is a **Telegram Mini App** — a React SPA served inside Telegram's WebView. Users open it via a bot button; the bot also sends reminders and delivers daily analytics reports. The backend serves the frontend as static files from `public/` and exposes a REST API.

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

### Dev Launcher (`scripts/dev.mjs`)
ESM Node.js script that acts as a process supervisor for local development:
1. Reads `backend/.env`, validates `BOT_TOKEN` exists
2. Builds frontend synchronously (`spawnSync`)
3. Starts tunnelmole on port 3001, waits for URL in stdout/stderr (regex match, 60s timeout)
4. Writes `WEBAPP_URL` into `backend/.env` via line-by-line parser
5. Calls `setChatMenuButton` twice — global (default) + per-developer chat (busts Telegram client cache)
6. Sends developer a Telegram message with the new URL
7. Spawns backend (`npm run dev`) with updated env vars
8. Every 2 minutes: GET `/api/health` — on failure, replaces tunnel + restarts backend

Module-level variables track `tunnelProcess`, `backendProcess`, `healthCheckTimer` to enable clean shutdown on SIGINT/SIGTERM.

**Windows path note:** Uses `fileURLToPath(new URL(..., import.meta.url))` for cross-platform path resolution.

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

### API Routes
All routes require `Authorization: Bearer <jwt>` except `POST /api/auth`.
- `POST /api/auth` — validate Telegram initData, return JWT
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
