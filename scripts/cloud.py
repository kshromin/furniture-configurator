# -*- coding: utf-8 -*-
# Каталог КОМПАНИИ в облаке (Supabase) для скриптов выгрузки/загрузки — ключ `--company <slug>`
# (задание сессии 77, п.1). Тот же Excel-цикл, что и с локальным файлом, только каталог берётся из
# `companies.materials` и туда же возвращается.
#
# Права: писать в `companies` по RLS может ТОЛЬКО супер-админ (policy companies_all_superadmin,
# supabase/saas-01-schema.sql). Поэтому скрипт спрашивает почту и пароль супер-админа; пароль
# читается скрытым вводом, никуда не сохраняется и не печатается. Токен живёт только в памяти
# процесса.
#
# Без сторонних библиотек (urllib из стандартной поставки): скрипты запускаются двойным кликом по
# .bat на машине пользователя, ставить туда пакеты нечем.
import json
import os
import re
import sys
import getpass
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# URL и публичный ключ берём из того же файла, что и сайт, — чтобы при переезде (смена URL/ключей,
# см. DEVLOG сессия 76) правилось одно место, а не ещё и скрипты.
CONF_JS = os.path.join(ROOT, 'js', 'core', 'supabaseConfig.js')
# Куда кладём снимок каталога компании ПЕРЕД записью — путь отката, если загрузка испортила данные.
BACKUP_DIR = os.path.join(ROOT, 'data')


def config():
    with open(CONF_JS, encoding='utf-8') as f:
        txt = f.read()
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", txt)
    key = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", txt)
    if not url or not key:
        raise RuntimeError(f'Не читается {CONF_JS}: нет SUPABASE_URL / SUPABASE_ANON_KEY')
    return url.group(1).rstrip('/'), key.group(1)


def _request(method, path, apikey, token=None, body=None, extra_headers=None):
    url, _ = config()
    headers = {'apikey': apikey, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    headers.update(extra_headers or {})
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode('utf-8')
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'{method} {path} → {e.code}: {detail}')
    except urllib.error.URLError as e:
        raise RuntimeError(f'Нет связи с базой ({e.reason}). Проверьте интернет.')


def login():
    """Вход супер-админом. Возвращает (token, apikey). Пароль — скрытым вводом, не сохраняется."""
    _, apikey = config()
    print('\nВход в базу (нужны права супер-администратора).')
    email = input('  Почта/логин: ').strip()
    password = getpass.getpass('  Пароль (не отображается): ')
    if not email or not password:
        raise RuntimeError('Вход отменён — пусто.')
    res = _request('POST', '/auth/v1/token?grant_type=password', apikey,
                   body={'email': email, 'password': password})
    token = (res or {}).get('access_token')
    if not token:
        raise RuntimeError('Не удалось войти: база не вернула токен.')
    return token, apikey


def companies(token, apikey):
    """Список компаний (без каталога — он тяжёлый): id, name, slug и размер каталога."""
    rows = _request('GET', '/rest/v1/companies?select=id,name,slug,is_active&order=name', apikey, token)
    return rows or []


def find_company(token, apikey, slug):
    rows = _request('GET', f'/rest/v1/companies?slug=eq.{slug}&select=id,name,slug,materials',
                    apikey, token)
    if not rows:
        raise RuntimeError(f'Компания со slug «{slug}» не найдена.')
    return rows[0]


def choose_company(token, apikey):
    """Выбор компании списком — когда slug не задан (батник передаёт просто --company)."""
    rows = companies(token, apikey)
    if not rows:
        raise RuntimeError('В базе нет ни одной компании.')
    print('\nКомпании:')
    for i, c in enumerate(rows, 1):
        mark = '' if c.get('is_active') else '  (заблокирована)'
        print(f'  {i}. {c["name"]} [{c["slug"]}]{mark}')
    while True:
        v = input('Номер компании (пусто — отмена): ').strip()
        if not v:
            raise RuntimeError('Отменено.')
        if v.isdigit() and 1 <= int(v) <= len(rows):
            return rows[int(v) - 1]['slug']
        print('  нет такого номера')


def catalog_is_empty(materials):
    """Каталог считается пустым по тем же правилам, что и в приложении (main.js/loadMaterials):
    нет производителей корпуса или фасада — компания работает на общем файле репозитория."""
    if not isinstance(materials, dict):
        return True
    return not ((materials.get('korpus') or {}).get('producers')
                and (materials.get('fasad') or {}).get('producers'))


def connect(slug=None):
    """Вход + выбор компании. Возвращает (token, apikey, company-словарь с materials)."""
    token, apikey = login()
    if not slug:
        slug = choose_company(token, apikey)
    company = find_company(token, apikey, slug)
    print(f'Компания: {company["name"]} [{company["slug"]}]')
    return token, apikey, company


def backup_path(slug):
    return os.path.join(BACKUP_DIR, f'company-{slug}.bak.json')


def save_catalog(token, apikey, company, materials):
    """Записать каталог компании. Прежний сохраняем рядом файлом — путь отката (правило сессии 74:
    рабочий каталог целиком не откатывать, но копию иметь)."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(backup_path(company['slug']), 'w', encoding='utf-8') as f:
        json.dump(company.get('materials') or {}, f, ensure_ascii=False, indent=2)
    _request('PATCH', f'/rest/v1/companies?id=eq.{company["id"]}', apikey, token,
             body={'materials': materials}, extra_headers={'Prefer': 'return=minimal'})
    return backup_path(company['slug'])


def take_company_arg(args):
    """Достаёт `--company [slug]` из списка аргументов. Возвращает (slug|'', args-без-ключа, был_ли_ключ).
    Значение необязательное: `--company` без slug = выбрать компанию списком."""
    if '--company' not in args:
        return '', args, False
    i = args.index('--company')
    rest = args[:i] + args[i + 1:]
    slug = ''
    if len(args) > i + 1 and not args[i + 1].startswith('--'):
        slug = args[i + 1]
        rest = args[:i] + args[i + 2:]
    return slug, rest, True


def fail(msg):
    print('ОШИБКА: ' + msg)
    return 1
