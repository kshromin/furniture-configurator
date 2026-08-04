# -*- coding: utf-8 -*-
# Загрузка правок ассортимента/цен из Excel обратно в data/materials.json (Этап 2 плана «первым
# делом»). Пара к catalog_export.py. Модель: находит позицию по скрытому `_key`, применяет цену
# (и доп. поля). БЕЗОПАСНО: сначала всё проверяет на КОПИИ; при любой ошибке файл не меняется —
# печатается список ошибок. Перед записью делает backup materials.json.bak.
#
# Запуск:
#   python catalog_import.py                 → окно выбора xlsx
#   python catalog_import.py --in <path>     → без окна (для тестов/автоматизации)
#
# Умеет: (1) обновлять цены/поля существующих позиций по `_key`; (2) создавать НОВЫЕ позиции из
# строк без `_key` на расширяемых листах (ЛДСП — с автосозданием кромок 16/32, Наполнение дверей —
# стекло, Доп.элементы, Сетчатые полки, Корзины). На фиксированных листах (профили, направляющие,
# фурнитура) новые строки пропускаются. id новых позиций — транслит имени (slugify).
import json
import os
import sys
import copy
import re

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, 'data', 'materials.json')
IN_DIR = os.path.normpath(os.path.join(ROOT, '..', 'Выгрузки'))
MANUAL = 'вручную'

# ЕДИНЫЙ формат колонок — одинаковый на всех листах (см. HEADERS в catalog_export.py), 1-based.
COLS = dict(key=1, producer=2, name=3, color=4, unit=5, price=6, h=7, l=8, w=9,
            dep=10, hex=11, korpus=12, fasad=13, fill=14, texture=15)
SHEET_NAMES = ['ЛДСП', 'Кромка', 'Наполнение дверей', 'Профили купе', 'Цвета профилей',
               'Сетчатые полки', 'Корзины', 'Направляющие', 'Фурнитура', 'Услуги', 'Доп.элементы']
# Поля, которые следуют из самой позиции (в catalogMeta не пишем) — см. DERIVED в catalog_export.py.
try:
    from catalog_export import DERIVED
except Exception:
    DERIVED = {'ldspm': {'h', 'hex'}, 'edge': {'h', 'dep'}, 'dfill': {'hex'}, 'prof': {'hex'},
               'profcol': {'hex'}, 'mesh': {'w'}, 'basket': {'h', 'l', 'w'}, 'slide': {'l'}}
META_FIELDS = ('producer', 'h', 'l', 'w', 'dep', 'hex')
# ключи-шаблоны (ручные/справочные) — не позиции, пропускаем при записи
TEMPLATE_KEYS = {'dfill:special', 'addon:custom:manual'}

REV_SURFACE = {label: key for key, label in [('korpus', 'корпус'), ('fasad', 'фасад'), ('fill', 'наполнение')]}
REV_METAL = {'белый': 'white', 'серебро': 'silver', 'чёрный': 'black', 'черный': 'black'}

_TR = {'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z',
       'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
       'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
       'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'}


def slugify(name, existing, prefix='item'):
    """Стабильный ascii-id из имени (транслит), уникальный среди existing."""
    s = ''.join(_TR.get(ch, ch if (ch.isascii() and ch.isalnum()) else ' ') for ch in str(name).lower())
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')[:24] or prefix
    base, i = s, 2
    while s in existing:
        s = f'{base}_{i}'; i += 1
    return s


# ── Создатели НОВЫХ позиций (строка без _key) по имени листа ─────────────────────────────────
def new_ldsp(data, e, ctx):
    # Единый формат: Производитель | Название(«ЛДСП») | Цвет | Ед.изм | Цена | Высота(=толщина) |
    # … | Корпус | Фасад | Наполнение (да/нет) | Файл текстуры. Материал заводится во все «да».
    pname = str(e.get('producer') or '').strip()
    disp = str(e.get('color') or '').strip()
    if not disp:
        return f'{ctx}: пустой цвет (колонка «Цвет»)'
    if not pname:
        return f'{ctx}: пустой производитель'
    cname = ldsp_full_name(e.get('name'), disp)  # имя из «Название»+«Цвет» (ЛДСП только если тип ЛДСП)
    th = int(num(e.get('h')) or 16)
    p = num(e.get('price'))
    if p is None:
        return f'{ctx}: цена не число'
    surfaces = [('korpus', e.get('korpus')), ('fasad', e.get('fasad')), ('fill', e.get('fill'))]
    if not any(is_yes(v) for _, v in surfaces):
        return f'{ctx}: не отмечена ни одна поверхность (Корпус/Фасад/Наполнение)'
    existing = {c.get('gid') for s in ('korpus', 'fasad', 'fill')
                for prod in data[s]['producers'] for c in prod['colors'] if c.get('gid')}
    gid = slugify(f'{pname}_{cname}_{th}', existing, 'ldsp')  # новый стабильный gid
    for surf, flag in surfaces:
        if is_yes(flag):
            create_ldsp_member(data, surf, gid, pname, cname, th, p, e.get('texture'), e.get('hex'))
    return None


def new_dfill(data, e, ctx):
    if str(e.get('name') or '').strip().lower() != 'стекло':
        return f'{ctx}: новые строки допустимы только для стекла (колонка «Название» = Стекло)'
    p = num(e.get('price'))
    if p is None:
        return f'{ctx}: цена не число'
    cname = str(e.get('color') or '').strip()
    if not cname:
        return f'{ctx}: пустое название стекла (колонка «Цвет»)'
    cols = data['slidingDoor']['fills']['glass']['colors']
    cid = slugify(cname, {c['id'] for c in cols}, 'glass')
    cols.append({'id': cid, 'name': cname, 'color': str(e.get('hex') or '#d9ecf0'), 'pricePerM2': p})
    return None


def new_addon(data, e, ctx):
    # «Название» = группа, «Цвет» = позиция (как в шаблоне).
    price = e.get('price')
    manual = isinstance(price, str) and price.strip().lower() == MANUAL
    p = MANUAL if manual else num(price)
    if p is None:
        return f'{ctx}: цена не число'
    grp_name = str(e.get('name') or '').strip()
    item_name = str(e.get('color') or '').strip()
    g = next((x for x in data['extras'] if x['name'] == grp_name), None)
    if g is None:
        return f'{ctx}: группа «{grp_name}» не найдена'
    if not item_name:
        return f'{ctx}: пустое название позиции (колонка «Цвет»)'
    iid = slugify(item_name, {it['id'] for it in g['items']}, 'addon')
    item = {'id': iid, 'name': item_name, 'price': 0 if manual else p}
    if manual:
        item['manual'] = True
    g['items'].append(item)
    return None


def new_mesh(data, e, ctx):
    d, p = num(e.get('w')), num(e.get('price'))  # глубина полки — колонка «Ширина, мм»
    if d is None or p is None:
        return f'{ctx}: глубина (ширина, мм) / цена не число'
    color = REV_METAL.get(str(e.get('color') or '').strip().lower(), e.get('color'))
    data['meshShelf'].append({'depth': int(d), 'color': color,
                              'name': str(e.get('name') or 'Сетчатая полка'), 'pricePerM': p})
    return None


def new_basket(data, e, ctx):
    # Высота | Длинна(=ширина корзины) | Ширина(=глубина корзины) — как в выгрузке.
    n = [num(e.get('l')), num(e.get('w')), num(e.get('h')), num(e.get('price'))]
    if any(x is None for x in n):
        return f'{ctx}: размеры/цена не число'
    color = REV_METAL.get(str(e.get('color') or '').strip().lower(), e.get('color'))
    data['basket'].append({'width': int(n[0]), 'depth': int(n[1]), 'height': int(n[2]),
                           'color': color, 'price': n[3]})
    return None


def store_meta(data, key, e):
    """Свободные поля (производитель/габариты/зависимость/hex), которых нет в самой базе, храним
    в data['catalogMeta'][key] — так они переживают выгрузку/загрузку. Поля, выводимые из позиции
    (DERIVED), не пишем: их правка в Excel всё равно не имеет смысла."""
    derived = DERIVED.get(str(key).split(':')[0], set())
    vals = {}
    for f in META_FIELDS:
        if f in derived:
            continue
        v = e.get(f)
        if v not in (None, ''):
            vals[f] = v if not isinstance(v, str) else v.strip()
    meta = data.setdefault('catalogMeta', {})
    if vals:
        meta[key] = vals
    else:
        meta.pop(key, None)


CREATORS = {'ЛДСП': new_ldsp, 'Наполнение дверей': new_dfill, 'Доп.элементы': new_addon,
            'Сетчатые полки': new_mesh, 'Корзины': new_basket}


def num(v):
    """Число из ячейки или None, если не число."""
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip().replace(' ', '').replace(' ', '').replace(',', '.')
        try:
            f = float(s)
            return int(f) if f == int(f) else f
        except ValueError:
            return None
    return None


def find_color(data, surface, prodid, colid):
    for p in data.get(surface, {}).get('producers', []):
        if p['id'] == prodid:
            for c in p.get('colors', []):
                if c['id'] == colid:
                    return c
    return None


YES_WORDS = {'да', 'yes', '1', '+', 'true', 'x', 'х', '✓', 'v'}
def is_yes(v):
    return str(v or '').strip().lower() in YES_WORDS


def find_ldsp(data, surface, prod_name, col_name, thickness):
    """Ищет (производитель, цвет) по ЧЕЛОВЕЧЕСКИМ полям — id сохраняется (не пересоздаём). Возвращает
    (producer_dict|None, color_dict|None)."""
    prod = next((p for p in data.get(surface, {}).get('producers', []) if p['name'] == prod_name), None)
    if prod is None:
        return None, None
    col = next((c for c in prod['colors']
                if c['name'] == col_name and int(c.get('thickness', 16)) == int(thickness)), None)
    return prod, col


def upsert_ldsp(data, surface, prod_name, col_name, thickness, price, texture, hexv=None):
    """Обновить цену/текстуру существующего цвета (id сохраняется) или создать новый в этой поверхности."""
    prod, col = find_ldsp(data, surface, prod_name, col_name, thickness)
    if col is not None:
        col['pricePerM2'] = price
        if texture not in (None, ''):
            col['texture'] = str(texture)
        if hexv not in (None, ''):
            col['color'] = str(hexv)
        return
    if prod is None:
        pid = slugify(prod_name or 'prod', {p['id'] for p in data[surface]['producers']}, 'prod')
        prod = {'id': pid, 'name': str(prod_name or pid), 'colors': []}
        data[surface]['producers'].append(prod)
    cid = slugify(col_name, {c['id'] for c in prod['colors']}, 'col')
    col = {'id': cid, 'name': col_name, 'color': '', 'thickness': int(thickness),
           'pricePerM2': price, 'edgePerM16': 0, 'edgePerM32': 0}
    if texture not in (None, ''):
        col['texture'] = str(texture)
    prod['colors'].append(col)


def ldsp_full_name(typ, disp):
    """Собрать имя материала из «Название» (тип) и «Цвет». «ЛДСП» приклеиваем ТОЛЬКО если тип = ЛДСП
    (иначе не-ЛДСП, напр. «Этерно МДФ Белый», получил бы лишний префикс)."""
    disp = str(disp or '').strip()
    if str(typ or '').strip().lower() == 'лдсп' and not disp.lower().startswith('лдсп'):
        return 'ЛДСП ' + disp
    return disp


def ensure_ldsp_gids(data):
    """Присвоить каждому материалу ЛДСП общий стабильный gid (группа по производитель+имя+толщина
    через все поверхности). Детерминированно = id первого встреченного члена (korpus→fasad→fill),
    поэтому совпадает с тем, что выводит экспорт до первой загрузки. Идемпотентно."""
    order = ('korpus', 'fasad', 'fill')
    gids = {}  # (произв., имя, толщина) -> gid
    for surf in order:  # сперва подхватить уже проставленные gid
        for prod in data.get(surf, {}).get('producers', []):
            for c in prod['colors']:
                k = (prod['name'], c['name'], int(c.get('thickness', 16)))
                if c.get('gid') and k not in gids:
                    gids[k] = c['gid']
    for surf in order:
        for prod in data.get(surf, {}).get('producers', []):
            for c in prod['colors']:
                k = (prod['name'], c['name'], int(c.get('thickness', 16)))
                gids.setdefault(k, f"{prod['id']}__{c['id']}")
                c['gid'] = gids[k]


def find_ldsp_by_gid(data, gid):
    """Все члены материала (по поверхностям) с этим gid: список (surface, prod, color)."""
    out = []
    for surf in ('korpus', 'fasad', 'fill'):
        for prod in data.get(surf, {}).get('producers', []):
            for c in prod['colors']:
                if c.get('gid') == gid:
                    out.append((surf, prod, c))
    return out


def create_ldsp_member(data, surf, gid, pname, cname, th, price, texture, hexv):
    """Завести материал в указанной поверхности с общим gid (когда поставили «да», а члена не было)."""
    prod = next((p for p in data[surf]['producers'] if p['name'] == pname), None)
    if prod is None:
        pid = slugify(pname or 'prod', {p['id'] for p in data[surf]['producers']}, 'prod')
        prod = {'id': pid, 'name': str(pname or pid), 'colors': []}
        data[surf]['producers'].append(prod)
    cid = slugify(cname, {c['id'] for c in prod['colors']}, 'col')
    col = {'id': cid, 'gid': gid, 'name': cname, 'color': str(hexv or ''), 'thickness': int(th),
           'pricePerM2': price, 'edgePerM16': 0, 'edgePerM32': 0}
    if texture not in (None, ''):
        col['texture'] = str(texture)
    prod['colors'].append(col)


def apply_row(data, key, price, extra, errctx):
    """Применить одну строку к data (мутирует). Возвращает текст ошибки или None."""
    if key in TEMPLATE_KEYS:
        return None
    parts = key.split(':')
    tag = parts[0]

    # цена (кроме листов без цены)
    need_price = tag not in ('profcol',)
    pval = None
    if need_price:
        if isinstance(price, str) and price.strip().lower() == MANUAL:
            return None  # ручная позиция — числом не пишем
        pval = num(price)
        if pval is None:
            return f'{errctx}: цена не число («{price}»)'
        if pval < 0:
            return f'{errctx}: отрицательная цена'

    try:
        if tag == 'ldsp' and len(parts) == 2:
            # НОВЫЙ формат: ldsp:<gid> — правка по СТАБИЛЬНОМУ id. Правка ЛЮБОГО столбца (имя/цвет/
            # цена/толщина/hex/да-нет) = обновление ТОЙ ЖЕ позиции, без дублей (задание «формат
            # выгрузки»). «Цвет» — без слова «ЛДСП», возвращаем префикс в имя.
            gid = parts[1]
            pname = str(extra.get('producer') or '').strip()
            disp = str(extra.get('color') or '').strip()
            if not disp:
                return f'{errctx}: пустой цвет ЛДСП (колонка «Цвет»)'
            cname = ldsp_full_name(extra.get('name'), disp)
            th = int(num(extra.get('h')) or 16)
            tex, hexv = extra.get('texture'), extra.get('hex')
            members = find_ldsp_by_gid(data, gid)
            for surf, prod, c in members:            # обновляем ВСЕ поля существующих членов
                c['name'] = cname
                c['pricePerM2'] = pval
                c['thickness'] = th
                if hexv not in (None, ''):
                    c['color'] = str(hexv)
                if tex not in (None, ''):
                    c['texture'] = str(tex)
            present = {s for s, _, _ in members}
            for surf in ('korpus', 'fasad', 'fill'):  # да/нет по поверхностям
                want = is_yes(extra.get(surf))
                if want and surf not in present:
                    create_ldsp_member(data, surf, gid, pname, cname, th, pval, tex, hexv)
                elif not want and surf in present:
                    sp, sc = next((p, c) for s, p, c in members if s == surf)
                    sp['colors'].remove(sc)
        elif tag == 'ldspm':
            # ЛЕГАСИ (выгрузка сессии 67): одна строка = материал, поиск по имени. Оставлено для
            # загрузки прежних файлов; новые выгрузки идут форматом ldsp:<gid> выше.
            pname = str(extra.get('producer') or '').strip()
            cname = str(extra.get('color') or '').strip()
            if not pname or not cname:
                return f'{errctx}: пустой производитель/цвет ЛДСП'
            th = int(num(extra.get('h')) or 16)
            tex = extra.get('texture')
            for surf in ('korpus', 'fasad', 'fill'):
                if is_yes(extra.get(surf)):
                    upsert_ldsp(data, surf, pname, cname, th, pval, tex, extra.get('hex'))
                else:
                    prod, col = find_ldsp(data, surf, pname, cname, th)
                    if col is not None:
                        prod['colors'].remove(col)
        elif tag == 'ldsp':
            # очень старый формат (одна строка на поверхность): ldsp:surface:prodid:colid
            _, surface, prodid, colid = parts
            c = find_color(data, surface, prodid, colid)
            if c is None:
                return f'{errctx}: не найдена позиция ЛДСП {key}'
            c['pricePerM2'] = pval
            if extra.get('texture') not in (None, ''):
                c['texture'] = str(extra['texture'])
        elif tag == 'edge':
            _, surface, prodid, colid, plate = parts
            c = find_color(data, surface, prodid, colid)
            if c is None:
                return None  # цвет мог быть убран с этой поверхности через да/нет в листе ЛДСП —
                             # кромка для него больше не нужна (кромка хранится в самом цвете), пропускаем
            c['edgePerM16' if plate == '16' else 'edgePerM32'] = pval
        elif tag == 'dfill':
            fills = data['slidingDoor']['fills']
            if parts[1] == 'mirror':
                fills['mirror']['pricePerM2'] = pval
            elif parts[1] == 'glass':
                cid = parts[2]
                hit = next((g for g in fills['glass']['colors'] if g['id'] == cid), None)
                if hit is None:
                    return f'{errctx}: не найдено стекло {cid}'
                hit['pricePerM2'] = pval
        elif tag == 'prof':
            _, el, colr = parts
            hit = next((p for p in data['slidingDoor']['profilePrices']
                        if p['element'] == el and p['color'] == colr), None)
            if hit is None:
                return f'{errctx}: не найден профиль {el}×{colr}'
            hit['pricePerM'] = pval
        elif tag == 'profcol':
            cid = parts[1]
            hit = next((c for c in data['slidingDoor']['colors'] if c['id'] == cid), None)
            if hit is None:
                return f'{errctx}: не найден цвет профиля {cid}'
            if extra.get('color'):        # название цвета профиля — в колонке «Цвет»
                hit['name'] = str(extra['color'])
            if extra.get('hex'):
                hit['hex'] = str(extra['hex'])
        elif tag == 'mesh':
            _, depth, colr = parts
            hit = next((m for m in data['meshShelf']
                        if str(m['depth']) == depth and m['color'] == colr), None)
            if hit is None:
                return f'{errctx}: не найдена сетчатая полка {key}'
            hit['pricePerM'] = pval
        elif tag == 'basket':
            _, w, dep, h, colr = parts
            hit = next((b for b in data['basket'] if str(b['width']) == w and str(b['depth']) == dep
                        and str(b['height']) == h and b['color'] == colr), None)
            if hit is None:
                return f'{errctx}: не найдена корзина {key}'
            hit['price'] = pval
        elif tag == 'slide':
            _, typ, length = parts
            hit = next((s for s in data['drawerSlide']
                        if s['type'] == typ and str(s['length']) == length), None)
            if hit is None:
                return f'{errctx}: не найдена направляющая {key}'
            hit['price'] = pval
        elif tag == 'fit':
            fid = parts[1]
            hit = next((it for it in data['fittings'] if it['id'] == fid), None)
            if hit is None:
                return f'{errctx}: не найдена фурнитура {fid}'
            hit['price'] = pval
        elif tag == 'swing':
            data['swingDoorHardware']['pricePerDoor'] = pval
        elif tag == 'rollers':
            data['slidingDoor']['rollers']['pricePerSet'] = pval
        elif tag == 'rod':
            data['rod']['pricePerM'] = pval
        elif tag == 'softclose':
            data['doorSoftClose']['pricePerDoor'] = pval
        elif tag == 'handle':
            data['drawerHandle']['pricePerDrawer'] = pval
        elif tag == 'service':
            sv = data.setdefault('services', {}).setdefault(parts[1], {})
            sv['price'] = pval
            if extra.get('name'):
                sv['name'] = str(extra['name'])
        elif tag == 'addon':
            _, grp, item = parts
            g = next((x for x in data['extras'] if x['id'] == grp), None)
            it = next((y for y in g['items'] if y['id'] == item), None) if g else None
            if it is None:
                return f'{errctx}: не найден доп.элемент {key}'
            it['price'] = pval
        else:
            return f'{errctx}: неизвестный тип ключа «{tag}»'
    except (KeyError, ValueError, IndexError) as e:
        return f'{errctx}: сбой применения {key} ({e})'
    return None


def main():
    global IN_DIR
    import openpyxl
    args = sys.argv[1:]
    path = None
    if args and args[0] == '--in':
        path = args[1]
    else:
        if len(args) >= 2 and args[0] == '--dir':  # папка, где искать файл (батник: Config\Выгрузки)
            IN_DIR = args[1]
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
            path = filedialog.askopenfilename(title='Выберите файл выгрузки для загрузки',
                                              initialdir=IN_DIR, filetypes=[('Excel', '*.xlsx')])
            root.destroy()
        except Exception:
            pass
    if not path or not os.path.exists(path):
        print('Загрузка отменена — файл не выбран.'); return 1

    with open(DST, encoding='utf-8') as f:
        original = json.load(f)
    data = copy.deepcopy(original)
    ensure_ldsp_gids(data)  # проставить стабильные gid материалам (для правки по ключу)

    wb = openpyxl.load_workbook(path, data_only=True)
    errors, applied, created, skipped_new = [], 0, 0, 0

    for name in SHEET_NAMES:
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        for ri, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if row is None or all(v in (None, '') for v in row):
                continue
            # Единый формат: колонки одинаковы на всех листах (см. COLS).
            extra = {f: (row[c - 1] if len(row) >= c else None) for f, c in COLS.items()}
            key = extra['key']
            if not key:
                # новая строка (без ключа) — создать позицию, если лист это допускает
                creator = CREATORS.get(name)
                if not creator:
                    skipped_new += 1
                    continue
                err = creator(data, extra, f'{name}, строка {ri} (новая)')
                if err:
                    errors.append(err)
                else:
                    created += 1
                continue
            err = apply_row(data, str(key), extra['price'], extra, f'{name}, строка {ri}')
            if err:
                errors.append(err)
            else:
                applied += 1
                store_meta(data, str(key), extra)

    if errors:
        print(f'ЗАГРУЗКА ОТМЕНЕНА — {len(errors)} ошибок, файл НЕ изменён:')
        for e in errors[:50]:
            print('  • ' + e)
        return 1

    # backup + атомарная запись
    try:
        with open(DST + '.bak', 'w', encoding='utf-8') as f:
            json.dump(original, f, ensure_ascii=False, indent=2)
        tmp = DST + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DST)
    except Exception as e:
        print(f'ОШИБКА записи: {e}'); return 1

    msg = f'Готово: обновлено {applied}, добавлено новых {created}'
    if skipped_new:
        msg += f', пропущено новых строк на нерасширяемых листах {skipped_new}'
    print(msg + '.')
    print(f'Бэкап прежней версии: {os.path.basename(DST)}.bak')
    return 0


if __name__ == '__main__':
    code = main()
    if not (len(sys.argv) > 1 and sys.argv[1] == '--in'):
        input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
