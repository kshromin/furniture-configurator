#!/usr/bin/env bash
# Бэкап базы: дамп -> сжатие -> в объектное хранилище S3.
# Запускается по расписанию (cron, см. README). Локально держим неделю, в S3 — сколько скажет
# правило жизненного цикла бакета.
#
# Диск на нашем тарифе локальный, снапшотов провайдера нет — этот скрипт единственное, что стоит
# между нами и потерей всех заказов. Проверка восстановления — в restore-test.sh, она обязательна.

set -euo pipefail

# --- настройки (переопределяются переменными окружения) ---
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/pg}"
KEEP_DAYS="${KEEP_DAYS:-7}"
S3_BUCKET="${S3_BUCKET:-khrom-backup}"
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.ru-6.storage.selcloud.ru}"
S3_PREFIX="${S3_PREFIX:-pg}"

stamp="$(date +%Y%m%d-%H%M)"
file="$LOCAL_DIR/db-$stamp.sql.gz"

mkdir -p "$LOCAL_DIR"

echo "[$(date '+%F %T')] дамп -> $file"
# Без --clean. Он добавляет в начало дампа «DROP ... IF EXISTS» по схемам auth, storage и прочим,
# и при восстановлении в ЧИСТУЮ базу psql падает на «schema storage does not exist»: IF EXISTS
# защищает от отсутствующей таблицы, но не от отсутствующей схемы. Восстанавливаем всегда в новую
# базу, так что --clean не нужен. Поймано проверкой restore-test.sh на живом сервере.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip -9 > "$file"

# пустой или подозрительно маленький дамп — это не бэкап, а иллюзия
size=$(stat -c%s "$file")
if [ "$size" -lt 10000 ]; then
  echo "ОШИБКА: дамп всего $size байт, что-то не так" >&2
  exit 1
fi
echo "[$(date '+%F %T')] размер: $(numfmt --to=iec "$size")"

echo "[$(date '+%F %T')] отправляю в S3"
aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$(basename "$file")" \
  --endpoint-url "$S3_ENDPOINT" --only-show-errors

echo "[$(date '+%F %T')] чищу локальные копии старше $KEEP_DAYS дней"
find "$LOCAL_DIR" -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] готово"
