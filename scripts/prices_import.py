# -*- coding: utf-8 -*-
# Загрузка цен и ассортимента из «для работы/цены.xlsx» обратно в data/materials.json
# (задание «скрипт для цен 18,07», пара к prices_export.py).
#
# Принцип: сначала ВСЕ проверки — при любой ошибке ничего не меняется, печатается список
# ошибок словами. Только если ошибок нет: бэкап старого materials.json в
# «для работы/бэкапы цен/», запись нового, отчёт что изменилось.
#
# Правила:
#  - существующие позиции находятся по скрытым _id/_key; менять их руками нельзя;
#  - удалять строки нельзя (вывод из ассортимента — отдельный будущий скрипт);
#  - листы «только цены» (Направляющие, Сетчатые полки, Корзины, Фурнитура) новых строк
#    не принимают; листы ассортимента (ЛДСП, Профили, Цвета профилей, Стёкла, Услуги) —
#    строка без _id = новая позиция, id генерируется автоматически;
#  - все прочие поля json (единицы измерения, служебные имена) не трогаются.
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'materials.json')
XLSX = os.path.join(ROOT, 'для работы', 'цены.xlsx')
BACKUP_DIR = os.path.join(ROOT, 'для работы', 'бэкапы цен')

LDSP_GROUPS = {'ЛДСП корпус': 'korpus', 'ЛДСП фасад': 'fasad', 'ЛДСП наполнение': 'fill'}

errors = []
changes = []
_id_counter = [0]


def new_id(prefix):
    _id_counter[0] += 1
    return f'{prefix}{int(time.time())}_{_id_counter[0]}'


def cell_str(v):
    return str(v).strip() if v is not None else ''


def parse_price(v, where, allow_fraction=False):
    if v is None or cell_str(v) == '':
        errors.append(f'{where}: цена не заполнена')
        return None
    try:
        n = float(str(v).replace(',', '.').replace(' ', ''))
    except ValueError:
        errors.append(f'{where}: цена «{v}» — не число')
        return None
    if n <= 0:
        errors.append(f'{where}: цена должна быть больше нуля (сейчас {n})')
        return None
    if not allow_fraction and abs(n - round(n)) < 1e-9:
        n = round(n)
    return n


def parse_hex(v, where, required=True):
    s = cell_str(v)
    if not s:
        if required:
            errors.append(f'{where}: не заполнен цвет (hex)')
        return None
    s = s if s.startswith('#') else '#' + s
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', s):
        errors.append(f'{where}: цвет «{v}» — не hex вида #f4f3f0')
        return None
    return s.lower()


def rows_of(wb, title, ncols):
    if title not in wb.sheetnames:
        errors.append(f'Лист «{title}» не найден в файле')
        return []
    out = []
    for r, row in enumerate(wb[title].iter_rows(min_row=2, values_only=True), start=2):
        vals = list(row[:ncols]) + [None] * (ncols - len(row))
        if all(cell_str(v) == '' for v in vals):
            continue
        out.append((r, vals))
    return out


def set_price(obj, field, val, label):
    if obj[field] != val:
        changes.append(f'{label}: {obj[field]} → {val}')
        obj[field] = val


def main():
    from openpyxl import load_workbook

    if not os.path.exists(XLSX):
        print(f'Файл не найден: {XLSX}\nСначала запустите «Выгрузить цены.bat».')
        return 1
    with open(SRC, encoding='utf-8') as f:
        data = json.load(f)
    wb = load_workbook(XLSX, data_only=True)

    # ── ЛДСП (3 листа): правки по _id, новые строки = новые цвета ──
    for title, group in LDSP_GROUPS.items():
        producers = data[group]['producers']
        by_id = {c['id']: c for p in producers for c in p['colors']}
        prod_by_name = {p['name'].strip().lower(): p for p in producers}
        seen = set()
        for r, (prod_name, name, hexv, price, texture, cid, _pid) in rows_of(wb, title, 7):
            where = f'«{title}», строка {r}'
            if cell_str(cid) in by_id:
                seen.add(cell_str(cid))  # строка на месте, даже если в ней ошибка — без каскада «удалено»
            price = parse_price(price, where)
            hx = parse_hex(hexv, where)
            name = cell_str(name)
            texture = cell_str(texture)
            if not name:
                errors.append(f'{where}: не заполнено название цвета')
            if price is None or hx is None or not name:
                continue
            cid = cell_str(cid)
            if cid:
                if cid not in by_id:
                    errors.append(f'{where}: служебный id «{cid}» не найден — колонку _id менять нельзя')
                    continue
                seen.add(cid)
                col = by_id[cid]
                set_price(col, 'pricePerM2', price, f'{title} / {name}')
                if col['name'] != name:
                    changes.append(f'{title}: «{col["name"]}» переименован в «{name}»')
                    col['name'] = name
                if col['color'] != hx:
                    changes.append(f'{title} / {name}: цвет {col["color"]} → {hx}')
                    col['color'] = hx
                if texture:
                    if col.get('texture') != texture:
                        changes.append(f'{title} / {name}: текстура → {texture}')
                        col['texture'] = texture
                elif 'texture' in col:
                    changes.append(f'{title} / {name}: текстура убрана')
                    del col['texture']
            else:
                prod = prod_by_name.get(cell_str(prod_name).lower())
                if not prod:
                    errors.append(f'{where}: производитель «{prod_name}» не найден '
                                  f'(есть: {", ".join(p["name"] for p in producers)})')
                    continue
                col = {'id': new_id(group[0]), 'name': name, 'color': hx, 'pricePerM2': price}
                if texture:
                    col['texture'] = texture
                prod['colors'].append(col)
                changes.append(f'{title}: добавлен цвет «{name}» ({prod["name"]}, {price} ₽/м²)')
        missing = set(by_id) - seen
        if missing:
            errors.append(f'«{title}»: удалены строки ({", ".join(sorted(missing))}) — '
                          f'удаление через этот файл запрещено')

    # ── Профили купе ──
    profiles = data['slidingDoor']['profiles']
    by_id = {p['id']: p for p in profiles}
    seen = set()
    for r, (name, vert, top, bottom, pid) in rows_of(wb, 'Профили купе', 5):
        where = f'«Профили купе», строка {r}'
        if cell_str(pid) in by_id:
            seen.add(cell_str(pid))
        name = cell_str(name)
        vert, top, bottom = (parse_price(v, where) for v in (vert, top, bottom))
        if not name:
            errors.append(f'{where}: не заполнено название')
        if None in (vert, top, bottom) or not name:
            continue
        pid = cell_str(pid)
        if pid:
            if pid not in by_id:
                errors.append(f'{where}: служебный id «{pid}» не найден')
                continue
            seen.add(pid)
            p = by_id[pid]
            set_price(p, 'vertPerM', vert, f'Профиль {name}, вертикаль')
            set_price(p, 'horizTopPerM', top, f'Профиль {name}, гориз. верх')
            set_price(p, 'horizBottomPerM', bottom, f'Профиль {name}, гориз. низ')
            if p['name'] != name:
                changes.append(f'Профиль «{p["name"]}» переименован в «{name}»')
                p['name'] = name
        else:
            profiles.append({'id': new_id('prof'), 'name': name, 'vertPerM': vert,
                             'horizTopPerM': top, 'horizBottomPerM': bottom})
            changes.append(f'Профили купе: добавлен «{name}» (рамка в 3D — стандартной ширины)')
    if set(by_id) - seen:
        errors.append('«Профили купе»: часть строк удалена — удаление запрещено')

    # ── Цвета профилей ──
    colors = data['slidingDoor']['colors']
    by_id = {c['id']: c for c in colors}
    seen = set()
    for r, (name, hexv, mul, cid) in rows_of(wb, 'Цвета профилей', 4):
        where = f'«Цвета профилей», строка {r}'
        if cell_str(cid) in by_id:
            seen.add(cell_str(cid))
        name = cell_str(name)
        hx = parse_hex(hexv, where)
        mul = parse_price(mul, where, allow_fraction=True)
        if not name:
            errors.append(f'{where}: не заполнено название')
        if hx is None or mul is None or not name:
            continue
        cid = cell_str(cid)
        if cid:
            if cid not in by_id:
                errors.append(f'{where}: служебный id «{cid}» не найден')
                continue
            seen.add(cid)
            c = by_id[cid]
            if c['priceMul'] != mul:
                changes.append(f'Цвет профиля {name}: множитель {c["priceMul"]} → {mul}')
                c['priceMul'] = mul
            if c['hex'] != hx:
                changes.append(f'Цвет профиля {name}: {c["hex"]} → {hx}')
                c['hex'] = hx
            if c['name'] != name:
                changes.append(f'Цвет профиля «{c["name"]}» переименован в «{name}»')
                c['name'] = name
        else:
            colors.append({'id': new_id('pcol'), 'name': name, 'hex': hx, 'priceMul': mul})
            changes.append(f'Цвета профилей: добавлен «{name}»')
    if set(by_id) - seen:
        errors.append('«Цвета профилей»: часть строк удалена — удаление запрещено')

    # ── Наполнение дверей: зеркало (цена) + стёкла (ассортимент) ──
    fills = data['slidingDoor']['fills']
    glass = fills.setdefault('glass', {'name': 'Стекло', 'colors': []})
    by_id = {c['id']: c for c in glass['colors']}
    seen = set()
    for r, (typ, name, hexv, price, cid) in rows_of(wb, 'Наполнение дверей', 5):
        where = f'«Наполнение дверей», строка {r}'
        if cell_str(cid) in by_id:
            seen.add(cell_str(cid))
        price = parse_price(price, where)
        if price is None:
            continue
        cid = cell_str(cid)
        if cid == 'mirror':
            set_price(fills['mirror'], 'pricePerM2', price, 'Зеркало')
            continue
        name = cell_str(name)
        hx = parse_hex(hexv, where)
        if not name:
            errors.append(f'{where}: не заполнено название')
        if hx is None or not name:
            continue
        if cid:
            if cid not in by_id:
                errors.append(f'{where}: служебный id «{cid}» не найден')
                continue
            seen.add(cid)
            c = by_id[cid]
            set_price(c, 'pricePerM2', price, f'Стекло {name}')
            if c['color'] != hx:
                changes.append(f'Стекло {name}: цвет {c["color"]} → {hx}')
                c['color'] = hx
            if c['name'] != name:
                changes.append(f'Стекло «{c["name"]}» переименовано в «{name}»')
                c['name'] = name
        else:
            glass['colors'].append({'id': new_id('gl'), 'name': name, 'color': hx, 'pricePerM2': price})
            changes.append(f'Наполнение дверей: добавлено стекло «{name}» ({price} ₽/м²)')
    if set(by_id) - seen:
        errors.append('«Наполнение дверей»: часть строк стёкол удалена — удаление запрещено')

    # ── Только цены: направляющие / сетчатые полки / корзины ──
    def price_only(title, items, key_fn, label_fn, field, key_col, price_col, ncols):
        by_key = {key_fn(it): it for it in items}
        for r, vals in rows_of(wb, title, ncols):
            where = f'«{title}», строка {r}'
            key = cell_str(vals[key_col])
            if not key or key not in by_key:
                errors.append(f'{where}: новая или изменённая строка — на этом листе можно менять только цены')
                continue
            price = parse_price(vals[price_col], where)
            if price is not None:
                set_price(by_key[key], field, price, label_fn(by_key[key]))

    price_only('Направляющие', data['drawerSlide'], lambda s: f"{s['type']}:{s['length']}",
               lambda s: f"Направляющие {s['type']} {s['length']}мм", 'price', 3, 2, 4)
    price_only('Сетчатые полки', data['meshShelf'], lambda m: f"{m['depth']}:{m['color']}",
               lambda m: f"Сетчатая полка {m['name']}", 'pricePerM', 2, 1, 3)
    price_only('Корзины', data['basket'], lambda b: f"{b['width']}:{b['depth']}:{b['height']}:{b['color']}",
               lambda b: f"Корзина {b['width']}×{b['depth']}×{b['height']} {b['color']}", 'price', 5, 4, 6)

    # ── Фурнитура и разное (общий лист, ключ-путь) ──
    sd = data['slidingDoor']
    flat = {f'fittings:{it["id"]}': (it, 'price', it['name']) for it in data['fittings']}
    flat['swing'] = (data['swingDoorHardware'], 'pricePerDoor', 'Петли распашных')
    flat['rollers'] = (sd['rollers'], 'pricePerSet', 'Ролики купе')
    flat['track'] = (sd['track'], 'pricePerM', 'Направляющая купе')
    flat['divider'] = (sd['divider'], 'pricePerM', 'Перемычка купе')
    flat['edge'] = (data['edgeBanding'], 'pricePerM', 'Кромка')
    for r, (name, price, key) in rows_of(wb, 'Фурнитура и разное', 3):
        where = f'«Фурнитура и разное», строка {r}'
        key = cell_str(key)
        if key not in flat:
            errors.append(f'{where}: новая строка — на этом листе можно менять только цены')
            continue
        price = parse_price(price, where)
        if price is not None:
            obj, field, label = flat[key]
            set_price(obj, field, price, label)

    # ── Услуги (extras) — расширяемые в рамках существующих групп ──
    groups_by_id = {g['id']: g for g in data['extras']}
    groups_by_name = {g['name'].strip().lower(): g for g in data['extras']}
    by_id = {it['id']: (g, it) for g in data['extras'] for it in g['items']}
    seen = set()
    for r, (grp_name, name, price, gid, iid) in rows_of(wb, 'Услуги', 5):
        where = f'«Услуги», строка {r}'
        if cell_str(iid) in by_id:
            seen.add(cell_str(iid))
        name = cell_str(name)
        price = parse_price(price, where)
        if not name:
            errors.append(f'{where}: не заполнено название')
        if price is None or not name:
            continue
        iid = cell_str(iid)
        if iid:
            if iid not in by_id:
                errors.append(f'{where}: служебный id «{iid}» не найден')
                continue
            seen.add(iid)
            _, it = by_id[iid]
            set_price(it, 'price', price, f'Услуга «{name}»')
            if it['name'] != name:
                changes.append(f'Услуга «{it["name"]}» переименована в «{name}»')
                it['name'] = name
        else:
            grp = groups_by_id.get(cell_str(gid)) or groups_by_name.get(cell_str(grp_name).lower())
            if not grp:
                errors.append(f'{where}: группа «{grp_name}» не найдена '
                              f'(есть: {", ".join(g["name"] for g in data["extras"])})')
                continue
            grp['items'].append({'id': new_id('ex'), 'name': name, 'price': price})
            changes.append(f'Услуги / {grp["name"]}: добавлена «{name}» ({price} ₽)')
    if set(by_id) - seen:
        errors.append('«Услуги»: часть строк удалена — удаление запрещено')

    # ── Итог ──
    if errors:
        print(f'НИЧЕГО НЕ ЗАГРУЖЕНО — найдено ошибок: {len(errors)}\n')
        for e in errors:
            print(' •', e)
        print('\nИсправьте файл «цены.xlsx» и запустите загрузку ещё раз.')
        return 1

    if not changes:
        print('Изменений не найдено — файл совпадает с текущим каталогом, ничего не менялось.')
        return 0

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, f'materials-{datetime.now():%Y%m%d-%H%M%S}.json')
    shutil.copy2(SRC, backup)
    with open(SRC, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'Загружено изменений: {len(changes)}\n')
    for c in changes:
        print(' •', c)
    print(f'\nСтарый каталог сохранён: {backup}')
    print('Обновите страницу конфигуратора, чтобы увидеть новые цены.')
    return 0


if __name__ == '__main__':
    code = main()
    input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
