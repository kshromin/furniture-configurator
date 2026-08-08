#!/usr/bin/env bash
# Проверка, что бэкап действительно восстанавливается.
#
# Смысл: дамп, который никто не разворачивал, бэкапом не является — он может оказаться обрезанным,
# пустым или несовместимым, и узнается это ровно в тот день, когда он понадобится. Скрипт берёт
# свежий дамп, разворачивает его в ОТДЕЛЬНУЮ базу рядом, считает таблицы и строки, потом эту базу
# удаляет. Рабочая база не затрагивается.
#
# Запуск:  bash restore-test.sh [путь к дампу]
# Без аргумента берётся самый свежий из /var/backups/pg.

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_USER="${DB_USER:-postgres}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/pg}"
TEST_DB="${TEST_DB:-restore_check}"

dump="${1:-$(ls -t "$LOCAL_DIR"/db-*.sql.gz 2>/dev/null | head -1)}"
if [ -z "${dump:-}" ] || [ ! -f "$dump" ]; then
  echo "Не нашёл дамп для проверки" >&2
  exit 1
fi
echo "Проверяю: $dump"

psql_run() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" "$@"; }

cleanup() {
  psql_run -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
psql_run -d postgres -c "CREATE DATABASE $TEST_DB;" >/dev/null
echo "Временная база $TEST_DB создана"

# ошибки восстановления не глотаем: ON_ERROR_STOP заставит psql упасть на первой же
gunzip -c "$dump" | docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$TEST_DB" -v ON_ERROR_STOP=1 --quiet >/dev/null

tables=$(psql_run -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
echo "Таблиц в public: $tables"

if [ "$tables" -lt 1 ]; then
  echo "ОШИБКА: в восстановленной базе нет таблиц — бэкап негодный" >&2
  exit 1
fi

# несколько ключевых таблиц: если их нет, дамп не тот
for t in companies profiles; do
  if psql_run -d "$TEST_DB" -tAc "SELECT to_regclass('public.$t');" | grep -q "$t"; then
    rows=$(psql_run -d "$TEST_DB" -tAc "SELECT count(*) FROM public.$t;")
    echo "  $t: $rows строк"
  else
    echo "  $t: нет такой таблицы (проверьте, тот ли это дамп)"
  fi
done

echo "Восстановление прошло. Временная база удаляется."
