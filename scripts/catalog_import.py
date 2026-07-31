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
# Что умеет СЕЙЧАС: обновление цен/полей существующих позиций по `_key`. Новые строки (без `_key`)
# пока пропускаются с предупреждением — добавление новых позиций будет следующим шагом.
import json
import os
import sys
import copy

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
    import openpyxl
    args = sys.argv[1:]
    path = None
    if args and args[0] == '--in':
        path = args[1]
    else:
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
    errors, applied, skipped_new = [], 0, 0

    for name, cfg in SHEETS.items():
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        for ri, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if row is None or all(v in (None, '') for v in row):
                continue
            key = row[cfg['key'] - 1] if len(row) >= cfg['key'] else None
            if not key:
                skipped_new += 1
                continue  # новая строка без _key — пока не поддерживаем (следующий шаг)
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

    print(f'Готово: применено {applied} позиц., пропущено новых строк {skipped_new}.')
    print(f'Бэкап прежней версии: {os.path.basename(DST)}.bak')
    return 0


if __name__ == '__main__':
    code = main()
    if not (len(sys.argv) > 1 and sys.argv[1] == '--in'):
        input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
