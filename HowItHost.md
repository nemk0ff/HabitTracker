# Как это работает и как хоститься

## Три части системы

| Часть | Где живёт | За что отвечает |
|---|---|---|
| Telegram Bot | Регистрация в @BotFather | Токен, кнопка меню, ссылка на Web App |
| Backend (Node.js + Fastify) | Твой ПК / сервер, порт 3001 | REST API, раздача статики Mini App, бот-polling, напоминания, аналитика |
| Публичный HTTPS-URL | Tunnelmole (для dev) / постоянный домен (прод) | Пробрасывает трафик на localhost:3001 |

Mini App — это React SPA, собранная в `backend/public/`. Её отдаёт тот же Fastify, что и API. Один процесс — и API, и фронт, и бот.

---

## Локальная разработка с Telegram

### Одна команда

```bash
npm run dev   # из корня проекта
```

Скрипт `scripts/dev.mjs` делает всё автоматически:

1. Собирает фронтенд (`frontend/` → `backend/public/`)
2. Запускает туннель Tunnelmole (`npx tunnelmole 3001`)
3. Дожидается публичного URL вида `https://xxxx.tunnelmole.net`
4. Записывает URL в `backend/.env` как `WEBAPP_URL`
5. Обновляет кнопку меню бота через `setChatMenuButton` (глобально + для твоего чата, чтобы сбросить кеш)
6. Присылает тебе в Telegram сообщение с новым URL (если задан `DEVELOPER_CHAT_ID`)
7. Запускает `backend/` с актуальными env-переменными
8. Каждые 2 минуты проверяет `/api/health` — если туннель упал, автоматически заменяет его и перезапускает бэкенд

### Что нужно сделать вручную

**Main App URL в BotFather** — Telegram Bot API не позволяет менять это поле программно. Когда URL меняется, бот присылает тебе сообщение с инструкцией:

```
BotFather → /mybots → Edit Bot → Mini App URL → вставить новый URL
```

---

## Как данные попадают к пользователю

```
Пользователь открывает Mini App в Telegram
        │
        │  GET https://xxxx.tunnelmole.net/
        ▼
Tunnelmole → localhost:3001
        │
        ▼
Fastify отдаёт backend/public/index.html
        │
React SPA загружается в WebView
        │
        │  POST /api/auth  (initData + HMAC подпись от Telegram)
        ▼
Backend проверяет подпись → upsert User → JWT
        │
        │  Authorization: Bearer <token>
        ▼
REST API: /api/habits, /api/habits/:id/entries, и т.д.
        │
        ▼
Prisma → SQLite (dev) / PostgreSQL (prod)
```

---

## Где что лежит

| Данные | Расположение |
|---|---|
| Код | `HabitTracker/backend/`, `frontend/` |
| База данных (dev) | `backend/prisma/dev.db` |
| Секреты | `backend/.env` (не коммитить) |
| Собранный фронтенд | `backend/public/` (генерируется, не коммитить) |

---

## Продакшен-деплой

В репозитории уже есть:

- **`Dockerfile`** — многостадийная сборка: фронт → `backend/public/`, Prisma generate, `node dist/index.js`, порт 3001
- **`fly.toml`** — пример для [Fly.io](https://fly.io) (регион `ams`, том `/data` под SQLite)

### Шаги деплоя на Fly.io

```bash
fly auth login
fly launch   # использует fly.toml
fly secrets set BOT_TOKEN="..." JWT_SECRET="..." DATABASE_URL="..."
fly deploy
```

После деплоя:
1. Скопируй постоянный домен (вида `your-app.fly.dev`)
2. В BotFather: Bot Settings → Menu Button → URL → `https://your-app.fly.dev`
3. В BotFather: Bot Settings → Mini App → URL → `https://your-app.fly.dev`

### PostgreSQL вместо SQLite

Замени в `.env` на сервере:
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname"
```

Prisma и все запросы работают без изменений кода.
