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
npm run db:seed-foods # idempotent upsert of the base food catalog (prisma/seed/foods.ru.json)
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
ANTHROPIC_API_KEY="sk-ant-..."        # optional: weekly summary text by Claude; without it the summary uses a template
HERMES_API_URL="http://127.0.0.1:8642" # developer's Hermes agent (OpenAI-compatible, reverse SSH tunnel from their laptop)
HERMES_API_KEY="..."                  # Bearer for Hermes; without it "Добавить текстом" answers "агент не настроен"
NUTRITION_USER_IDS="123,456"          # optional: telegram ids allowed into the nutrition module (defaults to DEVELOPER_CHAT_ID; in dev with neither set, open to all)
```

**Running the backend locally without hijacking the prod bot:** grammY long-polling on a token steals updates from the VPS instance. For local UI work start it with a dummy token (`BOT_TOKEN="0:dummy"`; an empty token throws) — polling fails harmlessly. In a plain browser under `vite dev`, the app falls back to `dev-mode` auth (no Telegram initData). Note framer-motion screen transitions freeze if the browser tab is hidden (rAF paused).

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
Navigation is state-driven via Zustand — there is **no router**. `stores/navStore.ts` holds `screen` (`Screen` union in `frontend/src/types/index.ts`) plus params (`selectedHabitId`, `foodDate`, `foodMeal`, `foodId`); `navigate(screen, params?)` merges params, so ones not passed keep their values. The app starts on `'hub'` (`HubPage`: habits vs nutrition). Adding a screen means extending `Screen` and the `AnimatePresence` switch in `App.tsx`; `food-*` screens are forced back to `'hub'` there when `user.features.nutrition` is false. New pages use `hooks/useTelegramButtons.ts` (`useBackButton`, `useMainButton`, `haptic`) instead of wiring `window.Telegram.WebApp` by hand. `AnimatePresence` in `App.tsx` handles transitions between screens.

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
`startAlerts()` schedules a `node-cron` job at `'0 9 * * *'` (09:00 UTC). Sends an HTML-formatted daily report to `DEVELOPER_CHAT_ID`. The "new users" line appears only when there were new users (the old "0 new users 2 days in a row" alert was removed on request).

`sendQuickStats(chatId)` — called by `/stats` bot command (restricted to `DEVELOPER_CHAT_ID`).

### Admin (developer-only)
"Admin" = the Telegram user whose id equals `DEVELOPER_CHAT_ID`. There is no role column in the DB.
- **API:** `routes/admin.ts` registers `adminGuard` as an `onRequest` hook for the whole plugin, so every route added there is admin-only. `adminGuard` re-verifies the JWT itself (independent of `authGuard`) and returns 401 (bad/missing token), 403 (not the developer), 503 (`DEVELOPER_CHAT_ID` unset).
- **Mini App:** `POST /api/auth` returns `user.isAdmin`; `HomePage` shows the "Все привычки" button only when it's true, navigating to the `'admin'` screen (`AdminPage.tsx`, read-only `HabitCard`s grouped by user, data from `GET /api/admin/habits`).
- **Bot:** developer-only commands `/stats`, `/users`, `/activity`, `/user <id>`, `/claude_session`. The user/activity views are derived from `AnalyticsEvent` via `getUserOverview` / `getRecentActivity` / `getUserDetail` in `analytics.ts` — "last seen" is only as good as the tracked events.

### Hours Habits
`Habit.measure = 'hours'` (set at creation only; entries are not converted on edit) stores **minutes** in `HabitEntry.value` (0–1440, validated in `routes/entries.ts`; level habits stay 0–4). Frontend: `utils/habits.ts` buckets minutes into heatmap levels (<5h / 5–7h / 7h+), `HoursSheet` is the hours+half-hours picker used by `HabitCard` and `HabitDetailPage`. The developer's "sleep" habit was migrated from levels 1/2/3 to 180/300/480 minutes on 2026-09-24. `NutritionGoal.trainingHabitId` / `sleepHabitId` link habits into the nutrition model.

### Entry Value Semantics
`HabitEntry.value` encodes intensity: `1`=light, `2`=medium, `3`=hard, `4`=extra. For **binary habits** (`Habit.binary=true`) the UI only records `value=1` (done) or deletes the entry (not done) — no intensity picker shown. Sending `value=0` to `POST /habits/:id/entries` deletes the entry for that date.

`GET /habits` eagerly loads the last 18 weeks of entries for all habits in one query — no separate pagination.

### Heatmap Interaction
Clicking a cell in `Heatmap.tsx` cycles intensity: `0 → 1 → 2 → 3 → 0`. The change is applied as an optimistic update in `habitsStore.toggleEntry` (store updated before the API call; reverts via full `load()` on error). `MiniHeatmap` is read-only; `HabitCard` wraps it in a flex-grow container and uses a `ResizeObserver` to recompute the `weeks` prop on every container width change (each column = 14px), so the heatmap is responsive to window resizing in desktop Telegram (Mac/Windows).

### Habit Card Layout
Card has two columns: left (heatmap, `flex-1`) and right (checkbox, icon, name, streak). The right column uses `w-fit min-w-14 max-w-[160px]` so its width adapts to the habit name; together with the heatmap's `ResizeObserver`, this means short names give the heatmap more space and long names give the name more space. Habit name is capped at 30 characters — enforced by `maxLength={30}` on the input in `HabitFormPage.tsx` and validated server-side in `routes/habits.ts` (POST and PATCH return 400 for names > 30 chars).

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

### Nutrition Module
Food diary with kcal/macros, goal and weight tracking. MVP is gated to specific users (`utils/features.ts` → `hasNutritionAccess`; `/api/auth` returns `user.features.nutrition`; `nutritionGuard` in `middleware/featureGuard.ts` 403s everyone else). Everyone else sees the hub card as "В разработке".

- **Data:** `Food` is the catalog, macros **per 100 g**: `source` = `seed` (base catalog), `custom` (user's own, `ownerId` set — Пятёрочка/Лавка/restaurant items with `sourceUrl`), `off` (Open Food Facts cache, `externalId`=EAN), `llm` (reserved). `FoodLogEntry` stores a **snapshot** of macros already scaled to `grams`, so editing/deleting a `Food` never rewrites history (`foodId` → SetNull). Diary dates follow the `HabitEntry` convention (client local `YYYY-MM-DD` stored as UTC midnight). `NutritionGoal` is 1:1 with User; `WeightEntry` unique per (user, date).
- **Search (`services/nutrition/foodSearch.ts`):** SQLite `contains` is case-insensitive only for ASCII, so every `Food` has a `searchName` normalized by `normalizeSearch` (lower-case, ё→е) and queries go through `searchStems` (crude ending-strip so "курица" matches "куриная"). Always write `searchName` when creating/renaming foods. If the local catalog yields < 5 hits, it queries Open Food Facts Search-a-licious (`search.openfoodfacts.org`, 3 s timeout), keeps only hits containing every stem, and upserts them as `source='off'`.
- **Claude (`services/claude.ts`):** used only by the weekly summary. Shared `@anthropic-ai/sdk` client, model `claude-opus-5`, routed through `CLAUDE_PROXY` via `undici.ProxyAgent` (api.anthropic.com isn't reachable directly from the VPS). Keep `undici` on v7 — v8 needs Node 22 and prod runs Node 20. Requests use beta `server-side-fallback-2026-07-01` + `fallbacks: "default"`.
- **"Добавить текстом" via Hermes (`services/hermes.ts`, `services/nutrition/textLog.ts`)** — developer only (`hasAgentLogAccess` → `user.features.agentLog`). The agent (`model: "hermes-agent"`, stateless `/v1/chat/completions`, 240 s timeout, often offline — every failure becomes a user-readable `HermesError`) only parses the text and researches КБЖУ per 100 g, returning JSON (`extractJson` tolerates prose/fences). The tracker's code decides "already in DB": agent's `own_food_id` hint → the user's own product with a matching store (`storeMatches`) → a seed food only when no store is named; otherwise it creates `Food(source='llm', ownerId)` keyed by `agent:<name>|<store>` (so repeats reuse it). Entries are written immediately with DB macros. Runs as an in-memory background job (lost on restart): Mini App polls `GET /nutrition/text-log/:id`; the bot handles the developer's plain-text messages without awaiting in the update handler (grammY is sequential) and edits its "⏳" message with the result + "↩️ Отменить" (`tlu:<jobId>` callback). Undo deletes the job's entries and the products it created if unused.
- **Model (`services/nutrition/model.ts`, `GET /nutrition/plan`):** EMA weight trend (α=0.1/day; handles the user's 0.5 kg scale), adaptive TDEE = mean intake of *complete* days (≥60% of median, today excluded) over 28 days − trend slope × 7700, needing ≥10 complete days and ≥7 weigh-ins; otherwise falls back to the manual goal (`mode: 'goal'`). Target = TDEE + delta toward target weight/date (clamped −750…+600). Training days (linked habit) get +150 kcal, rest days give it back so the weekly total holds. Sleep never enters the formula — only `insights`.
- **Weekly summary (`services/nutrition/weeklySummary.ts`):** facts computed in code, text written by Claude (template fallback). Cron Sun 15:00 UTC to every nutrition user with a goal; `/week` bot command on demand.
- **Frontend:** `pages/nutrition/*` (day, add, product form, stats, goal), `components/nutrition/*`, `stores/nutritionStore.ts` (per-date day cache), `utils/nutrition.ts` (goal heat levels, weight forecast via least-squares trend over 28 days, Mifflin–St Jeor goal calculator, 7700 kcal ≈ 1 kg). `Heatmap` has a select mode (`onSelect`) used as the diary calendar. `PortionSheet` resets its inputs whenever the `target` object identity changes — memoize the target. `BottomSheet` portals to `<body>` (a transformed ancestor like an animated card would otherwise break `position: fixed`, and clicks would bubble to the card).
- **Favorites & "Что доесть" (`food-suggest` screen):** `FavoriteFood(userId, foodId)` join table (any visible food, incl. shared seed/OFF — that's why it isn't a column on `Food`); `serializeFood(f, favIds)` adds `favorite`. ☆/★ via `FavoriteStar` in search rows, «Мои продукты», `PortionSheet` (star props live outside `target` so toggling doesn't reset inputs) and the suggest cards. `utils/suggest.ts` (pure): remaining = model target (`plan.todayKcal`/`proteinTarget`, goal fat/carbs) − eaten; per favorite `fits` / `tooCaloric` (one portion > 115% of the gap) / `tooLight` (3 portions < min(25% of gap, 200 kcal)); suggested grams in half-portion steps capped at 3 portions; `bestCombo` brute-forces 1–3 of the top-12 fitting favorites, shown only within ±25% of the kcal gap.
- **Daily report** includes the developer's previous-day kcal/protein line.

### API Routes
All routes require `Authorization: Bearer <jwt>` except `POST /api/auth` and `POST /api/claude/session-start`.
- `POST /api/auth` — validate Telegram initData, return JWT
- `POST /api/claude/session-start` — register a Claude Code session start; requires `Authorization: Bearer <KEEP_ALIVE_SECRET>` (sharedSecretGuard, not authGuard)
- `GET/POST /api/habits` — list (18 weeks entries included) / create
- `PATCH/DELETE /api/habits/:id` — update / hard-delete (ignores the `archived` flag; DELETE removes the row)
- `GET/POST /api/habits/:id/entries` — fetch or upsert entries (POST with `value=0` deletes)
- `GET/PUT/DELETE /api/habits/:id/reminder` — get / upsert / delete reminder config
- `GET /api/admin/habits` — all users' habits (adminGuard, see Admin section)
- `/api/nutrition/*` (nutritionGuard): `plan?date=` (model output), `foods/search?q=`, `foods/recent`, `foods/mine`, `POST/PATCH/DELETE foods[/:id]` (own only); `GET log?date=`, `POST log` (`foodId` or `name`+macros), `PATCH/DELETE log/:id`, `POST log/copy`; `GET favorites`, `PUT/DELETE favorites/:foodId`; `POST text-log` (202 + job) / `GET text-log/:id` / `POST text-log/:id/undo` (developer only); `GET stats?from=&to=`; `GET/PUT goal`; `PUT weight`, `DELETE weight/:date`

### Database Schema (SQLite/PostgreSQL via Prisma)
- `User` — identified by `telegramId` (BigInt)
- `Habit` — belongs to User; has `color`, `icon` (emoji), `binary` flag, `archived` flag (schema only — `DELETE /habits/:id` hard-deletes, doesn't soft-archive)
- `HabitEntry` — one per (habit, date); `value` is 1–4 (intensity levels); unique on `[habitId, date]`
- `Reminder` — one per Habit (1:1); stores `days` as JSON string, `time` as `HH:MM` UTC, `snooze` bool, `lastMessageId` for deletion
- `Food` / `FoodLogEntry` / `NutritionGoal` / `WeightEntry` — nutrition module, see above
- `AnalyticsEvent` — append-only event log; `userId` nullable (SetNull on user delete); `metadata` stored as JSON string; indexed on `[event]`, `[userId]`, `[createdAt]`, `[event, createdAt]`

### Prisma Client Regeneration (Windows caveat)
After `db:push` or `db:migrate`, Prisma tries to replace `query_engine-windows.dll.node`. If the backend is running, this rename fails with EPERM (DLL is locked). Fix: stop the server, run `npm run db:generate`, restart. If this is skipped, `prisma.analyticsEvent` will be `undefined` at runtime — `track()` handles this silently, but other new models would cause 500s.

### Production Deployment
Build frontend → copy `dist/` to `backend/public/` → backend serves it. The backend is the single deployable unit. The live deployment is the VPS + pm2 + CloudPub setup described above. `Dockerfile`, `fly.toml` and `.github/workflows/deploy.yml` (Fly.io deploy on push to `main`) are legacy — the working branch is `master`, so that workflow never fires.

`README.md`, `HowItHost.md` and `REMOTE.md` are older Russian-language docs that still describe the tunnelmole/localtunnel era; trust this file and the scripts over them when they disagree.
