#!/bin/bash
# CloudPub tunnel sync for HabitTracker (production VPS).
#
# Replaces the old tunnelmole/cloudflared version. CloudPub exposes the backend on a
# STABLE https://<name>.cloudpub.ru subdomain via a persistent systemd service
# (cloudpub.service → `clo run --run-as-service`). Because the URL never rotates this
# script is a ONE-SHOT idempotent sync, NOT a long-running daemon — do NOT register it
# as a perpetually-restarting pm2 process (the old "cf-tunnel" pm2 app was removed).
#
# It: ensures port 3001 is published on CloudPub, reads the stable URL, writes it into
# backend/.env (WEBAPP_URL), points the Telegram menu button at it, and restarts the
# backend only if the URL actually changed.
#
# Run once after deploy, or whenever the CloudPub URL changes:
#     bash scripts/cf-tunnel.sh
#
# Filename kept as cf-tunnel.sh for historical continuity.
set -e

APP_DIR="/habitBot/HabitTracker"
ENV_PATH="$APP_DIR/backend/.env"
PUB_NAME="habit-tracker"          # CloudPub publication name (clo ls label)

PORT="$(grep -oP '^PORT=\K.*' "$ENV_PATH" 2>/dev/null | tr -d '"' || true)"
PORT="${PORT:-3001}"

log() { echo "[cf-tunnel] $*"; }

# 1. Wait for the backend to be healthy (CloudPub upstream must be listening).
for _ in $(seq 1 30); do
    curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
done

# 2. Make sure the CloudPub agent service is running (it serves ALL publications;
#    never restart it here — that would briefly drop sibling apps' tunnels too).
systemctl is-active --quiet cloudpub.service || systemctl start cloudpub.service || true

# 3. Find the stable URL CloudPub assigned to our port; register it if missing.
#    `clo register` activates the publication immediately, no daemon restart needed.
get_url() {
    clo ls 2>/dev/null \
        | grep -oP "localhost:$PORT -> \Khttps://[a-zA-Z0-9.-]+\.cloudpub\.ru" \
        | head -1
}
URL="$(get_url || true)"
if [ -z "$URL" ]; then
    log "Port $PORT not published yet — registering on CloudPub…"
    clo register http "$PORT" -n "$PUB_NAME" >/dev/null 2>&1 || true
    sleep 3
    URL="$(get_url || true)"
fi
URL="${URL%/}"

if [ -z "$URL" ]; then
    log "ERROR: could not obtain a CloudPub URL for port $PORT. Current publications:"
    clo ls || true
    exit 1
fi
log "Stable CloudPub URL: $URL"

# 4. Update WEBAPP_URL only if it changed (idempotent).
CURRENT="$(grep -oP '^WEBAPP_URL="?\K[^"]+' "$ENV_PATH" 2>/dev/null || true)"
if [ "${CURRENT%/}" = "$URL" ]; then
    log "WEBAPP_URL already up to date — nothing to do."
    exit 0
fi
sed -i "s#^WEBAPP_URL=.*#WEBAPP_URL=\"$URL\"#" "$ENV_PATH"
log "WEBAPP_URL updated in .env"

# 5. Telegram credentials + proxy (api.telegram.org is IP-blocked on this host).
BOT_TOKEN="$(grep -oP '^BOT_TOKEN="?\K[^"]+' "$ENV_PATH")"
DEV_CHAT="$(grep -oP '^DEVELOPER_CHAT_ID="?\K[^"]+' "$ENV_PATH" || true)"
PROXY="$(grep -oP '^SOCKS_PROXY="?\K[^"]+' "$ENV_PATH" 2>/dev/null || echo 'socks5://127.0.0.1:1080')"
PROXY_HOST="${PROXY#*://}"

# Build JSON payloads with python3 so Cyrillic is \u-escaped — avoids the bash UTF-8
# quoting pitfall (raw \xHH in double quotes gets mangled by Telegram).
tg() {  # $1 = api method, $2 = json payload
    curl -sf --socks5-hostname "$PROXY_HOST" \
        -H "Content-Type: application/json" \
        -d "$2" \
        "https://api.telegram.org/bot${BOT_TOKEN}/$1" >/dev/null || true
}

# 6. Point the Mini App launch button at the stable URL (global + per-dev cache-bust).
menu_payload() {  # $1 = optional chat_id
    python3 - "$URL" "${1:-}" <<'PY'
import sys, json
url, chat = sys.argv[1], sys.argv[2]
btn = {"menu_button": {"type": "web_app", "text": "Трекер", "web_app": {"url": url}}}
if chat:
    btn["chat_id"] = int(chat)
print(json.dumps(btn))
PY
}
tg setChatMenuButton "$(menu_payload)"
[ -n "$DEV_CHAT" ] && tg setChatMenuButton "$(menu_payload "$DEV_CHAT")"
log "Telegram menu button → $URL"

# 7. Notify the developer.
if [ -n "$DEV_CHAT" ]; then
    tg sendMessage "$(python3 - "$URL" "$DEV_CHAT" <<'PY'
import sys, json
print(json.dumps({"chat_id": int(sys.argv[2]),
                  "text": "✅ HabitTracker (CloudPub) URL: " + sys.argv[1]}))
PY
)"
fi

# 8. Restart the backend so the /start button serves the new WEBAPP_URL
#    (backend loads .env via node --env-file, so a plain restart re-reads it).
pm2 restart habit-backend >/dev/null 2>&1 || true
log "Done — backend restarted with the new WEBAPP_URL."
