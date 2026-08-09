#!/usr/bin/env bash
# Выкладка обычного сайта (не конфигуратора) на наш сервер.
#
#     bash deploy/deploy-site.sh <папка-с-сайтом> <имя-на-сервере>
#
# Пример:
#     bash deploy/deploy-site.sh ~/arch-project project
#
# Кладёт содержимое папки в /srv/khrom/sites/<имя>. Оттуда его раздаёт Caddy — имя площадки
# в Caddyfile должно совпадать с <имя-на-сервере>.
#
# Отличие от deploy.sh (конфигуратора): там уезжает содержимое КОММИТА и подставляется адрес API,
# здесь — просто файлы как есть. Сайты лежат в своих репозиториях, и лишний раз лезть в их
# устройство незачем.

set -euo pipefail

SERVER="${SERVER:-deploy@135.106.181.182}"

src="${1:?укажите папку с сайтом}"
name="${2:?укажите имя на сервере, например project}"
target="/srv/khrom/sites/$name"

[ -d "$src" ] || { echo "Нет такой папки: $src" >&2; exit 1; }

echo "Выкладываю $src → $SERVER:$target"

# --delete нет намеренно: файлы на сервере не удаляются. Так безопаснее — случайно пустая
# локальная папка не сотрёт живой сайт. Мусор, если накопится, чистим руками.
tar --exclude=.git --exclude=.github -cz -C "$src" . \
  | ssh -o BatchMode=yes "$SERVER" "mkdir -p '$target' && tar -xz -C '$target'"

ssh -o BatchMode=yes "$SERVER" "du -sh '$target'; ls '$target' | head -10"
echo "Готово."
