# Переезд на свой сервер — конфиги и порядок

Всё, что нужно для подъёма площадки. Инструкция для владельца — как завести сервер и хранилище —
отдельно: [SELECTEL.md](SELECTEL.md). Здесь техническая часть, её выполняю я.

**Состояние: сервер поднят и стек работает** (Selectel `khrom-app`, Москва, Ubuntu 24.04, Supabase
self-hosted v0.7.2, 11 контейнеров healthy). Не сделано: перенос данных, Caddy, бэкапы, домены.

## Что где

| Файл | Зачем |
|---|---|
| `SELECTEL.md` | Инструкция владельцу: аккаунт, SSH-ключ, сервер, S3 |
| `server-init.sh` | Базовая настройка Ubuntu: пользователь, фаервол, swap, Docker |
| `bind-ports.py` | Прибивает порты Supabase к localhost — на ufw тут полагаться нельзя |
| `Caddyfile` | HTTPS и маршруты: конфигуратор, API, два сайта, панель |
| `env.example` | Образец переменных, настоящий `.env` живёт только на сервере |
| `backup/backup.sh` | Дамп базы → S3, по расписанию |
| `backup/restore-test.sh` | Проверка, что дамп действительно разворачивается |

## Порядок

### 1. Сервер

```bash
scp deploy/server-init.sh root@IP:/root/
ssh root@IP "bash /root/server-init.sh"
```

Дальше проверить вход `ssh deploy@IP` **из другого окна**, не закрывая первое: скрипт отключает
вход по паролю, и если ключ не работает, войти будет уже нечем.

### 2. Supabase

У Supabase есть свой `setup.sh` — он ставит зависимости, тянет **стабильный релизный тег** (а не
HEAD), создаёт проект и генерирует все секреты, включая асимметричные ключи. Пользуемся им:

```bash
sudo apt-get install -y git python3-yaml
cd /srv/khrom
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/supabase/supabase supabase-src
cd supabase-src && git sparse-checkout set --cone docker && git checkout && cd ..
sh supabase-src/docker/setup.sh -y --project-dir app
```

Дальше правим `app/.env` — адреса (`API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL`,
`ADDITIONAL_REDIRECT_URLS`) и запускаем:

```bash
cd /srv/khrom/app
python3 ../bind-ports.py docker-compose.yml
sh run.sh start
```

**Порты трогаем только в compose, через `bind-ports.py`.** Соблазн прописать
`POSTGRES_PORT=127.0.0.1:5432` в `.env` заканчивается тем, что база не встаёт: та же переменная
уходит внутрь контейнера как порт самого Postgres.

Проверка:

```bash
docker compose ps                       # все healthy
sudo ss -tlnp | grep 0.0.0.0            # наружу только SSH
curl -s http://127.0.0.1:8000/auth/v1/health -H "apikey: $(grep ^ANON_KEY= .env | cut -d= -f2-)"
```

Ответ `403 You cannot consume this service` на `/rest/v1/` — это нормально: корневой OpenAPI открыт
только админскому ключу. Проверять надо запросом к таблице, а не к корню.

### 3. Схема и данные из облака

Строку подключения берём в панели Supabase: кнопка **Connect** → вкладка **Direct / Connection
string** → **Session pooler** (порт 5432, хост `pooler.supabase.com`). Именно его, а не Direct:
прямое подключение у Supabase только по IPv6, а на сервере его нет. Transaction pooler (6543) тоже
не подойдёт — `pg_dump` нужна живая сессия.

Строку кладём в файл на сервере (в ней пароль, в командной строке ей не место):

```bash
URL=$(cat /srv/khrom/.cloud-url)     # chmod 600
docker exec supabase-db psql "$URL" -tAc "select version();"   # проверка связи
```

Дамп и восстановление. **Порядок важен**: сначала учётные записи, потом данные приложения —
`profiles` ссылается на `auth.users`, иначе внешний ключ не даст залить.

```bash
docker exec supabase-db pg_dump "$URL" --schema=public --no-owner --no-privileges   --quote-all-identifiers > migrate-public.sql
docker exec supabase-db pg_dump "$URL" --data-only --no-owner   --table=auth.users --table=auth.identities > migrate-auth.sql

sed -i '/^CREATE SCHEMA "public";$/d' migrate-public.sql   # схема public уже есть, иначе psql встанет

docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < migrate-auth.sql
docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < migrate-public.sql
```

Сверить построчно: число таблиц, строки в каждой, количество политик RLS и записей в `auth.users`
должны совпасть с облаком. Файлы Storage переносятся отдельно, если они там появятся.

### 4. Caddy

```bash
cp deploy/Caddyfile /srv/khrom/Caddyfile
docker run -d --name caddy --network host --restart unless-stopped \
  -v /srv/khrom/Caddyfile:/etc/caddy/Caddyfile \
  -v /srv/khrom:/srv/khrom -v caddy_data:/data caddy:2
```

Сертификаты Caddy выпустит сам, но **только для доменов, которые уже указывают на этот сервер**.
Пока A-записи не переключены, лишние имена из `Caddyfile` убрать, иначе он будет биться о них
и упираться в лимиты Let's Encrypt.

### 5. Бэкапы

```bash
sudo apt install -y awscli
aws configure   # ключи из панели Selectel, регион ru-1
cp deploy/backup/*.sh /srv/khrom/ && chmod +x /srv/khrom/*.sh
```

Расписание — каждую ночь в 3:20, с записью в журнал:

```bash
crontab -e
20 3 * * * S3_BUCKET=khrom-files /srv/khrom/backup.sh >> /var/log/khrom-backup.log 2>&1
```

**Сразу после первого бэкапа обязательно прогнать `restore-test.sh`.** Бэкап, который ни разу не
разворачивали, бэкапом не считается.

### 6. Переключение

1. Выложить конфигуратор в `/srv/khrom/config`, сайты — в `/srv/khrom/sites/*`
2. Поменять URL и ключи в модулях-обёртках конфигуратора на `https://api.khrom-in.ru`
3. Проверить живьём: вход, «Мои проекты», «Поделиться», каталог компании, админка
4. Переключить A-записи. **MX, SPF, DKIM, DMARC не трогать** — иначе встанет почта
5. Неделю держать облачный Supabase включённым как путь отката

## Решено: ставим руками, без Coolify

Coolify был в плане, но при написании конфигов выяснилось, что **он поднимает свой обратный прокси
на портах 80 и 443** — то есть он и наш Caddy это два хозяина одних и тех же портов, вместе они не
живут. Выбрали руками: compose плюс Caddy, всё прозрачно, памяти ест меньше, любая правка — текстовый
файл под рукой. Цена решения — выкладка обновлений командой в консоли, а не кнопкой в панели.

Следствие: **стартовый тариф уменьшен до VDS 2-4-50 (650 ₽/мес)**. Без Coolify подрезанный стек
Supabase, Caddy и система занимают около 1,8 ГБ — четыре гигабайта дают нормальный запас. До 4-8-80
вырастем, когда запустим чаты с гостями и ботов; апгрейд у Selectel только вверх и делается
перезагрузкой. К Coolify вернёмся, если сервисов станет много и ручная выкладка начнёт мешать.

## Чего здесь намеренно нет

- **Почтовый сервер.** Не поднимаем принципиально: доставляемость и чёрные списки того не стоят
- **Секреты.** В репозитории только `env.example`. Настоящие ключи — на сервере и в папке
  материалов на Яндексе
