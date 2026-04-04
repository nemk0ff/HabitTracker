# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Habit Tracker is a **Telegram Mini App** — a React SPA served inside Telegram's WebView. Users open it via a bot button; the bot also sends reminders. The backend serves the frontend as static files from `public/` and exposes a REST API.

## Commands

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
npm run build        # tsc + vite build
npm run preview      # Preview production build
```

## Environment Setup

Create `backend/.env`:
```env
DATABASE_URL="file:./prisma/dev.db"   # SQLite for dev; PostgreSQL URL for prod
BOT_TOKEN="your_telegram_bot_token"
JWT_SECRET="random_secret_key"
PORT=3001
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

### Reminder Scheduler
`startScheduler()` runs a `node-cron` job every minute (UTC). It checks for reminders matching current UTC time and day, sends Telegram messages via `bot.api.sendMessage`, and handles snooze (re-sends every 5 min for up to 1 hour if the habit isn't checked).

### Database Schema (SQLite/PostgreSQL via Prisma)
- `User` — identified by `telegramId` (BigInt)
- `Habit` — belongs to User; has `color`, `icon` (emoji), `archived` flag
- `HabitEntry` — one per (habit, date); `value` is 1–4 (intensity levels); unique on `[habitId, date]`
- `Reminder` — one per Habit (1:1); stores `days` as JSON string, `time` as `HH:MM` UTC, `snooze` bool, `lastMessageId` for deletion

### Production Deployment
Build frontend → copy `dist/` to `backend/public/` → backend serves it. The backend is the single deployable unit.
