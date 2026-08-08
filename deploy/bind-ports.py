#!/usr/bin/env python3
"""Прибивает опубликованные порты Supabase к localhost.

Зачем. По умолчанию compose публикует Kong (8000/8443) и пулер Postgres (5432/6543) на всех
адресах. Наружу их пускать нельзя — снаружи должен быть только Caddy. И на ufw тут полагаться
НЕЛЬЗЯ: Docker пишет свои правила в цепочку DOCKER-USER в обход ufw, так что «фаервол включён» и
«порт закрыт» — разные вещи. Проверено на живом сервере: при включённом ufw Postgres слушал
0.0.0.0:5432.

Почему правим compose, а не переменные. Напрашивается `POSTGRES_PORT=127.0.0.1:5432` в .env, но эта
же переменная уходит внутрь контейнера как порт самого Postgres, и база не поднимается:
`FATAL: invalid value for parameter "port"`. Тоже проверено, на этом стек и упал в первый раз.

Запуск в каталоге проекта (там, где docker-compose.yml):

    python3 bind-ports.py docker-compose.yml
"""

import re
import shutil
import sys

PATTERN = re.compile(r"^(\s*)- (\$\{[A-Z0-9_]+\}:\d+(?:/tcp)?)\s*$", re.M)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Использование: python3 bind-ports.py <путь к docker-compose.yml>")

    path = sys.argv[1]
    text = open(path, encoding="utf-8").read()

    new, count = PATTERN.subn(lambda m: f"{m.group(1)}- 127.0.0.1:{m.group(2)}", text)
    if count == 0:
        print("Ничего не изменено — либо порты уже прибиты, либо формат файла другой.")
        return

    shutil.copyfile(path, path + ".orig")
    open(path, "w", encoding="utf-8").write(new)

    print(f"Прибито портов: {count} (исходник — {path}.orig)")
    for line in new.splitlines():
        if "- 127.0.0.1:$" in line:
            print("  ", line.strip())
    print("\nПроверить после перезапуска:  sudo ss -tlnp | grep 0.0.0.0")
    print("Наружу должен слушать только SSH.")


if __name__ == "__main__":
    main()
