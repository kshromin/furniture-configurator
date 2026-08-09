#!/usr/bin/env bash
# Серверная половина выкладки: принимает на вход tar-архив статики (его шлёт deploy.sh с рабочей
# машины), распаковывает и подставляет адрес нашего API.
#
# Отдельным файлом, а не строкой внутри ssh: одинарные и двойные кавычки, проходя через ssh,
# съедаются в самый неподходящий момент, и отладка такого — пустая трата вечера.
#
# Живёт на сервере как /srv/khrom/remote-unpack.sh, обновляется тем же deploy.sh.

set -euo pipefail

TARGET="${TARGET:-/srv/khrom/config}"
ENV_FILE="${ENV_FILE:-/srv/khrom/.site-env}"

mkdir -p "$TARGET"
tar -x -C "$TARGET"

# В репозитории SUPABASE_URL смотрит на облачный Supabase, и трогать его там нельзя: тот же файл
# раздаёт GitHub Pages старому сайту. Поэтому адрес и ключ подставляются здесь, на сервере.
# shellcheck source=/dev/null
. "$ENV_FILE"

cfg="$TARGET/js/core/supabaseConfig.js"
[ -f "$cfg" ] || { echo "ОШИБКА: не нашёл $cfg" >&2; exit 1; }

sed -i "s#^export const SUPABASE_URL = .*#export const SUPABASE_URL = '$SITE_API_URL';#" "$cfg"
sed -i "s#^export const SUPABASE_ANON_KEY = .*#export const SUPABASE_ANON_KEY = '$SITE_ANON_KEY';#" "$cfg"

grep -q "$SITE_API_URL" "$cfg" || { echo "ОШИБКА: адрес API не подставился" >&2; exit 1; }
echo "распаковано, адрес API подставлен: $SITE_API_URL"
