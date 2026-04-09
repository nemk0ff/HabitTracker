# Habit Tracker — Telegram Mini App

Трекер привычек в формате Telegram Mini App. GitHub-style heatmap, стрики, 4 уровня интенсивности (или бинарный режим), напоминания с повтором, ежедневная аналитика, haptic feedback, адаптация к теме Telegram.

## Стек

**Frontend:** React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion + Zustand  
**Backend:** Node.js + Fastify v5 + Prisma + SQLite (dev) / PostgreSQL (prod)  
**Бот:** grammY + node-cron  
**Интеграция:** Telegram Mini Apps SDK

---

## Как работает проект

### Архитектура

```
Telegram клиент
     │
     │  открывает Mini App (HTTPS URL)
     ▼
Backend (Fastify)
     │  отдаёт index.html из backend/public/
     │
     ▼
React SPA (загружается в WebView)
     │
     │  1. window.Telegram.WebApp.initData → POST /api/auth
     │  2. Backend валидирует HMAC подпись, возвращает JWT
     │  3. Все дальнейшие запросы: Authorization: Bearer <token>
     ▼
REST API /api/*
     │
     ▼
Prisma ORM → SQLite / PostgreSQL
```

### Поток аутентификации

1. Telegram передаёт `initData` — строку с данными пользователя и HMAC-подписью
2. Backend вычисляет HMAC через `BOT_TOKEN` и сравнивает с переданным `hash`
3. При совпадении — upsert пользователя в БД, выдача JWT на 30 дней
4. В dev-режиме (`NODE_ENV !== 'production'`): строка `"dev-mode"` минует проверку → тестовый пользователь `telegramId: 999999`

### Навигация

Нет react-router. `habitsStore.screen` хранит текущий экран (`'home' | 'habit' | 'create' | 'edit'`). `AnimatePresence` в `App.tsx` анимирует переходы. Кнопки «Назад» и «Главная» — нативные кнопки Telegram WebApp.

### Heatmap

- **MiniHeatmap** (на карточке): динамическое количество недель — `useLayoutEffect` измеряет ширину контейнера, вычисляет сколько колонок по 14px (11px ячейка + 3px gap) влезает
- **Heatmap** (страница детали): клик циклически меняет интенсивность 0→1→2→3→0; optimistic update в store
- **Binary mode**: интенсивность отключена — только выполнено/нет; один цвет вместо градиента

### Напоминания и планировщик

`node-cron` каждую минуту (UTC):
1. Находит `Reminder` с `enabled=true`, у которых `time == HH:MM` сейчас и текущий день недели в `days[]`
2. Проверяет, не отмечена ли уже привычка за сегодня
3. Отправляет Telegram-сообщение через grammY
4. При включённом `snooze`: повторяет каждые 5 минут в течение часа, пока привычка не отмечена; удаляет предыдущее сообщение перед отправкой нового

### Аналитика и мониторинг

Все действия пользователей пишутся в таблицу `AnalyticsEvent` (fire-and-forget, никогда не блокирует API):

| Событие | Триггер |
|---|---|
| `user_registered` / `app_open` | Каждый `/api/auth` |
| `habit_created/edited/deleted` | CRUD привычек |
| `entry_checked` / `entry_unchecked` | Отметка привычки |
| `reminder_enabled/disabled/deleted` | Настройка напоминания |
| `command_start` / `command_help` / `message_received` | Сообщения боту |

**Ежедневный отчёт** приходит в личку разработчика в 09:00 UTC (DAU, WAU, новые пользователи, топ-действия).  
**Команда `/stats`** (только для `DEVELOPER_CHAT_ID`) — статистика в реальном времени.

---

## Структура проекта

```
HabitTracker/
├── scripts/
│   └── dev.mjs                    # Одна команда запуска: сборка + туннель + бэкенд
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # User, Habit, HabitEntry, Reminder, AnalyticsEvent
│   ├── public/                    # Собранный фронтенд (vite build output)
│   │   └── assets/
│   └── src/
│       ├── index.ts               # Fastify сервер, статика, graceful shutdown
│       ├── db.ts                  # Prisma client singleton
│       ├── middleware/
│       │   └── auth.ts            # JWT sign/verify, authGuard hook
│       ├── routes/
│       │   ├── auth.ts            # POST /api/auth
│       │   ├── habits.ts          # CRUD /api/habits
│       │   ├── entries.ts         # POST /api/habits/:id/entries (upsert/delete)
│       │   └── reminders.ts       # GET/PUT/DELETE /api/habits/:id/reminder
│       ├── services/
│       │   ├── bot.ts             # grammY Bot: /start, /help, /stats, on('message')
│       │   ├── scheduler.ts       # node-cron: напоминания + snooze каждую минуту
│       │   ├── analytics.ts       # track() (fire-and-forget) + агрегаты DAU/WAU
│       │   └── alerts.ts          # Ежедневный отчёт + sendQuickStats()
│       └── utils/
│           └── telegram.ts        # validateInitData (HMAC проверка)
│
└── frontend/
    └── src/
        ├── App.tsx                # AnimatePresence, auth init, screen router
        ├── main.tsx               # React root, Telegram.WebApp.ready()
        ├── index.css              # Tailwind + CSS переменные --tg-theme-*
        ├── api/
        │   ├── client.ts          # fetch wrapper (JWT, Content-Type guard)
        │   └── habits.ts          # типизированные вызовы API
        ├── stores/
        │   ├── authStore.ts       # Zustand: аутентификация, JWT в памяти
        │   └── habitsStore.ts     # Zustand: habits[], screen, optimistic updates
        ├── pages/
        │   ├── HomePage.tsx       # список привычек, MainButton «Добавить»
        │   ├── HabitDetailPage.tsx# статистика, полный heatmap, удаление
        │   └── HabitFormPage.tsx  # создание/редактирование, color/emoji/binary
        ├── components/
        │   ├── HabitCard.tsx      # карточка: динамический MiniHeatmap + чекбокс
        │   ├── Heatmap.tsx        # интерактивная тепловая карта (4 мес.)
        │   ├── MiniHeatmap.tsx    # компактная карта для карточки
        │   ├── ColorPicker.tsx    # выбор цвета привычки
        │   ├── EmojiPicker.tsx    # выбор эмодзи иконки
        │   ├── WheelPicker.tsx    # iOS-style колесо для времени в напоминании
        │   ├── NotificationSheet.tsx # bottom sheet: настройка напоминания
        │   ├── StatCard.tsx       # карточка статистики (стрик, %)
        │   └── LoadingScreen.tsx  # анимация загрузки
        ├── types/
        │   └── index.ts           # Habit, HabitEntry, User, Reminder, Screen
        └── utils/
            ├── dates.ts           # getWeeksGrid, calculateStreak, getMonthCompletionRate
            └── colors.ts          # HABIT_COLORS, getHeatmapColor (rgba с opacity)
```

---

## База данных

```prisma
User            — telegramId (BigInt, unique)
Habit           — userId, name, color, icon?, binary, archived
HabitEntry      — habitId + date (уникальный составной ключ), value 1–4
Reminder        — habitId (1:1), days (JSON), time "HH:MM" UTC, snooze, lastMessageId
AnalyticsEvent  — userId?, event, category, label?, metadata (JSON), createdAt
```

---

## Быстрый старт

### Требования

- Node.js 18+
- Telegram Bot Token (через [@BotFather](https://t.me/BotFather))
- [Tunnelmole](https://tunnelmole.com) (`npm install -g tunnelmole` или через `npx`)

### Установка

```bash
cd backend && npm install
cd ../frontend && npm install
```

### Окружение

Создайте `backend/.env`:

```env
DATABASE_URL="file:./prisma/dev.db"
BOT_TOKEN="ваш_токен_бота"
JWT_SECRET="случайная_строка"
PORT=3001
DEVELOPER_CHAT_ID="ваш_telegram_id"   # опционально: ID для отчётов и /stats
```

### База данных

```bash
cd backend
npx prisma db push
```

### Запуск (одной командой)

```bash
npm run dev   # из корня проекта
```

Скрипт автоматически:
1. Собирает фронтенд (`frontend/` → `backend/public/`)
2. Запускает туннель Tunnelmole на порту 3001
3. Записывает новый URL в `backend/.env` (`WEBAPP_URL`)
4. Обновляет кнопку меню бота в Telegram
5. Запускает бэкенд с актуальными env-переменными
6. Каждые 2 минуты проверяет работоспособность туннеля; при сбое — автоматически заменяет и перезапускает всё

Если `DEVELOPER_CHAT_ID` задан, при каждом изменении URL бот пришлёт вам сообщение с новой ссылкой.

### Альтернативный запуск (два терминала)

```bash
# Терминал 1 — Backend
cd backend && npm run dev

# Терминал 2 — Frontend dev server
cd frontend && npm run dev
```

Frontend: http://localhost:5173 (dev-mode, без Telegram)  
Backend: http://localhost:3001

### Сборка и деплой

```bash
cd frontend && npm run build   # собирает в backend/public/
cd ../backend && npm start     # отдаёт и API, и статику
```

Настройте Mini App URL через [@BotFather](https://t.me/BotFather): Bot Settings → Menu Button → URL вашего бэкенда.

---

## Деплой в продакшен

В репозитории есть задел:

- **`Dockerfile`** — многостадийная сборка: фронт → `backend/public/`, Prisma generate, `node dist/index.js`, порт 3001
- **`fly.toml`** — пример для [Fly.io](https://fly.io) (регион `ams`, том под SQLite `/data`)

Для продакшена замените `DATABASE_URL` на PostgreSQL и выставьте постоянный HTTPS-домен.
