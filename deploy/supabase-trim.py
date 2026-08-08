#!/usr/bin/env python3
"""Подгонка официального docker-compose Supabase под наш сервер.

Официальная сборка рассчитана на машину пожирнее и на то, что наружу торчит сама. Нам нужно два
изменения:

1. Убрать сбор логов (`analytics` + `vector`). Это самая прожорливая часть стека, а логи мы и так
   видим через `docker logs`. Заодно убираются ссылки на них в `depends_on`, иначе остальные
   контейнеры будут ждать несуществующий сервис.
2. Прибить порты к localhost. По умолчанию Kong и Studio слушают на всех адресах — то есть база
   доступна из интернета мимо Caddy. Нам нужно, чтобы снаружи был только Caddy.

Запуск на сервере, в каталоге с docker-compose.yml из supabase/docker:

    python3 supabase-trim.py docker-compose.yml

Рядом останется docker-compose.yml.orig — исходник, если что-то пойдёт не так.
"""

import shutil
import sys

try:
    import yaml
except ImportError:
    sys.exit("Нужен модуль yaml:  sudo apt install -y python3-yaml")

DROP_SERVICES = ["analytics", "vector"]
# порт -> адрес, к которому его прибиваем
BIND_LOCAL = "127.0.0.1"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Использование: python3 supabase-trim.py <путь к docker-compose.yml>")

    path = sys.argv[1]
    with open(path, encoding="utf-8") as fh:
        compose = yaml.safe_load(fh)

    services = compose.get("services", {})
    if not services:
        sys.exit("В файле нет секции services — это точно compose от Supabase?")

    shutil.copyfile(path, path + ".orig")

    dropped = []
    for name in DROP_SERVICES:
        if services.pop(name, None) is not None:
            dropped.append(name)

    # вычищаем ссылки на убранные сервисы
    cleaned_links = 0
    for name, svc in services.items():
        depends = svc.get("depends_on")
        if isinstance(depends, dict):
            for gone in DROP_SERVICES:
                if depends.pop(gone, None) is not None:
                    cleaned_links += 1
            if not depends:
                svc.pop("depends_on")
        elif isinstance(depends, list):
            before = len(depends)
            svc["depends_on"] = [d for d in depends if d not in DROP_SERVICES]
            cleaned_links += before - len(svc["depends_on"])
            if not svc["depends_on"]:
                svc.pop("depends_on")

    # порты — только на localhost
    bound = []
    for name, svc in services.items():
        ports = svc.get("ports")
        if not ports:
            continue
        new_ports = []
        for port in ports:
            text = str(port)
            # уже с адресом (1.2.3.4:80:80) — не трогаем
            if text.count(":") >= 2:
                new_ports.append(port)
                continue
            new_ports.append(f"{BIND_LOCAL}:{text}")
            bound.append(f"{name} {text}")
        svc["ports"] = new_ports

    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(compose, fh, allow_unicode=True, sort_keys=False)

    print(f"Убрано сервисов: {', '.join(dropped) if dropped else 'нет'}")
    print(f"Почищено ссылок depends_on: {cleaned_links}")
    print("Порты прибиты к localhost:")
    for item in bound:
        print(f"  - {item}")
    print(f"\nИсходник сохранён: {path}.orig")
    print("Проверить результат:  docker compose config >/dev/null && echo OK")


if __name__ == "__main__":
    main()
