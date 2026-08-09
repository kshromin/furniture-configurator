#!/usr/bin/env bash
# Выкладка конфигуратора на наш сервер. Запускается НА РАБОЧЕЙ МАШИНЕ (компе или ноуте),
# из корня репозитория:
#
#     bash deploy/deploy.sh
#
# Что делает: берёт последний КОММИТ (не рабочую копию — чтобы на сервер не уехали случайные
# правки), пакует статику, распаковывает на сервере и подставляет адрес нашего API.
#
# Почему выкладка идёт с ноутбука, а не «git pull» на сервере: репозиторий приватный, и серверу
# понадобился бы отдельный ключ доступа к GitHub. Лишний секрет на машине, смотрящей в интернет,
# ради задачи, которая прекрасно решается локально. Когда репозиторий переедет на GitVerse,
# можно будет пересмотреть.

set -euo pipefail

SERVER="${SERVER:-deploy@135.106.181.182}"
TARGET="${TARGET:-/srv/khrom/config}"
# что именно составляет сайт
PATHS="index.html admin.html css js assets data"

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain -- $PATHS)" ]; then
  echo "ВНИМАНИЕ: есть незакоммиченные правки — на сервер уедет последний коммит, без них:"
  git status --short -- $PATHS
  echo
fi

commit=$(git rev-parse --short HEAD)
echo "Выкладываю коммит $commit на $SERVER:$TARGET"

# Серверная половина живёт отдельным файлом — обновляем её тем же заходом
# tr -d вместо sed: рабочая копия на Windows может быть с CRLF, а bash на сервере спотыкается
# о них с невнятным «$'': command not found»
tr -d '' < deploy/remote-unpack.sh | ssh -o BatchMode=yes "$SERVER" 'cat > /srv/khrom/remote-unpack.sh'

# git archive отдаёт ровно то, что в коммите: ни .git, ни мусора, ни забытых черновиков
git archive HEAD $PATHS | ssh -o BatchMode=yes "$SERVER" 'bash /srv/khrom/remote-unpack.sh'

echo "Готово. Проверка:"
curl -s -o /dev/null -w "  mebel.khrom-in.ru: HTTP %{http_code}\n" https://mebel.khrom-in.ru/
