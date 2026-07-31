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

# лист → индексы колонок (1-based): key_col, price_col (None если нет), extra {поле: колонка}
SHEETS = {
    'ЛДСП':              dict(key=6, price=4, extra={'texture': 5}),
    'Кромка':            dict(key=5, price=4),
    'Наполнение дверей': dict(key=4, price=3),
    'Профили купе':      dict(key=4, price=3),
    'Цвета профилей':    dict(key=3, price=None, extra={'name': 1, 'hex': 2}),
    'Сетчатые полки':    dict(key=5, price=4),
    'Корзины':           dict(key=6, price=5),
    'Направляющие':      dict(key=4, price=3),
    'Фурнитура':         dict(key=4, price=3),
    'Доп.элементы':      dict(key=4, price=3),
}
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
def new_ldsp(data, vals, ctx):
    surf = REV_SURFACE.get(str(vals[0] or '').strip().lower())
    if not surf:
        return f'{ctx}: неизвестная поверхность «{vals[0]}»'
    name = str(vals[2] or '').strip()
    if not name:
        return f'{ctx}: пустое название цвета'
    p = num(vals[3])
    if p is None:
        return f'{ctx}: цена не число'
    prods = data[surf]['producers']
    prod = next((x for x in prods if x['name'] == vals[1]), None)
    if prod is None:
        pid = slugify(vals[1] or 'prod', {x['id'] for x in prods}, 'prod')
        prod = {'id': pid, 'name': str(vals[1] or pid), 'colors': []}
        prods.append(prod)
    cid = slugify(name, {c['id'] for c in prod['colors']}, 'col')
    color = {'id': cid, 'name': name, 'color': '', 'pricePerM2': p,
             'edgePerM16': 0, 'edgePerM32': 0}  # кромки заводятся пустыми (автосоздание §1.2)
    if vals[4]:
        color['texture'] = str(vals[4])
    prod['colors'].append(color)
    return None


def new_dfill(data, vals, ctx):
    if str(vals[0] or '').strip().lower() != 'стекло':
        return f'{ctx}: новые строки допустимы только для стекла'
    p = num(vals[2])
    if p is None:
        return f'{ctx}: цена не число'
    cols = data['slidingDoor']['fills']['glass']['colors']
    cid = slugify(vals[1], {c['id'] for c in cols}, 'glass')
    cols.append({'id': cid, 'name': str(vals[1]), 'color': '#d9ecf0', 'pricePerM2': p})
    return None


def new_addon(data, vals, ctx):
    manual = isinstance(vals[2], str) and vals[2].strip().lower() == MANUAL
    p = MANUAL if manual else num(vals[2])
    if p is None:
        return f'{ctx}: цена не число'
    g = next((x for x in data['extras'] if x['name'] == vals[0]), None)
    if g is None:
        return f'{ctx}: группа «{vals[0]}» не найдена'
    iid = slugify(vals[1], {it['id'] for it in g['items']}, 'addon')
    item = {'id': iid, 'name': str(vals[1]), 'price': 0 if manual else p}
    if manual:
        item['manual'] = True
    g['items'].append(item)
    return None


def new_mesh(data, vals, ctx):
    d, p = num(vals[1]), num(vals[3])
    if d is None or p is None:
        return f'{ctx}: глубина/цена не число'
    color = REV_METAL.get(str(vals[2] or '').strip().lower(), vals[2])
    data['meshShelf'].append({'depth': int(d), 'color': color, 'name': str(vals[0]), 'pricePerM': p})
    return None


def new_basket(data, vals, ctx):
    n = [num(vals[0]), num(vals[1]), num(vals[2]), num(vals[4])]
    if any(x is None for x in n):
        return f'{ctx}: размеры/цена не число'
    color = REV_METAL.get(str(vals[3] or '').strip().lower(), vals[3])
    data['basket'].append({'width': int(n[0]), 'depth': int(n[1]), 'height': int(n[2]),
                           'color': color, 'price': n[3]})
    return None


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
        if tag == 'ldsp':
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
                return f'{errctx}: не найден цвет ЛДСП для кромки {key}'
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
            if extra.get('name'):
                hit['name'] = str(extra['name'])
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

    wb = openpyxl.load_workbook(path, data_only=True)
    errors, applied, created, skipped_new = [], 0, 0, 0

    for name, cfg in SHEETS.items():
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        for ri, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if row is None or all(v in (None, '') for v in row):
                continue
            key = row[cfg['key'] - 1] if len(row) >= cfg['key'] else None
            if not key:
                # новая строка (без _key) — создать позицию, если лист это допускает
                creator = CREATORS.get(name)
                if not creator:
                    skipped_new += 1
                    continue
                vals = list(row) + [None] * 10
                err = creator(data, vals, f'{name}, строка {ri} (новая)')
                if err:
                    errors.append(err)
                else:
                    created += 1
                continue
            price = row[cfg['price'] - 1] if cfg['price'] and len(row) >= cfg['price'] else None
            extra = {f: (row[c - 1] if len(row) >= c else None) for f, c in cfg.get('extra', {}).items()}
            err = apply_row(data, str(key), price, extra, f'{name}, строка {ri}')
            if err:
                errors.append(err)
            else:
                applied += 1

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
