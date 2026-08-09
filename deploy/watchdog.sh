#!/usr/bin/env bash
# Присмотр за площадкой. Раз в пять минут проверяет, что сайт и API отвечают, и если нет —
# пробует поднять упавшее сам, а всё происходящее пишет в журнал.
#
# Чего этот скрипт НЕ умеет: сообщить, если сервер лёг целиком. Он же на этом сервере и живёт.
# Для такого нужен внешний монитор — заводится отдельно, см. deploy/README.md.
#
# Ставится в cron пользователя deploy:
#   */5 * * * * /srv/khrom/watchdog.sh >> /var/log/khrom-watchdog.log 2>&1

set -uo pipefail   # без -e: смысл скрипта в том, чтобы пережить неудачную проверку

SITE_URL="${SITE_URL:-https://mebel.khrom-in.ru/}"
API_URL="${API_URL:-https://api.khrom-in.ru/auth/v1/health}"
APP_DIR="${APP_DIR:-/srv/khrom/app}"

log() { echo "[$(date '+%F %T')] $*"; }

check() {  # url -> код ответа
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo "000"
}

site=$(check "$SITE_URL")
api=$(check "$API_URL")

# 401 у API — это норма: Kong требует ключ, и сам факт ответа означает, что он жив
site_ok=$([ "$site" = "200" ] && echo yes || echo no)
api_ok=$([ "$api" = "200" ] || [ "$api" = "401" ] && echo yes || echo no)

if [ "$site_ok" = yes ] && [ "$api_ok" = yes ]; then
  exit 0   # молчим, когда всё хорошо: журнал не должен зарастать
fi

log "ПРОБЛЕМА: сайт=$site api=$api"

if [ "$api_ok" = no ]; then
  unhealthy=$(cd "$APP_DIR" && docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null \
    | grep -v healthy | head -5)
  [ -n "$unhealthy" ] && log "нездоровые контейнеры: $unhealthy"
  log "перезапускаю стек"
  (cd "$APP_DIR" && sh run.sh restart >/dev/null 2>&1) || (cd "$APP_DIR" && docker compose up -d)
fi

if [ "$site_ok" = no ]; then
  log "перезапускаю Caddy"
  docker restart caddy >/dev/null 2>&1
fi

sleep 30
log "после перезапуска: сайт=$(check "$SITE_URL") api=$(check "$API_URL")"
