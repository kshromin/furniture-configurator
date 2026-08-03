# -*- coding: utf-8 -*-
# Выгрузка ассортимента/цен конфигуратора в Excel — НОВЫЙ, под схему DATA-SCHEMA v0.2
# (задание «выгрузки 23,07», Этап 2 плана «первым делом»). Заменяет prices_export.py, который
# несовместим со структурой профилей после сессии 56.
#
# Модель: «позиционная» — каждая цена = строка со стабильным служебным ключом `_key` (скрыт; по нему
# импорт находит позицию), человекочитаемыми колонками и ЖЁЛТОЙ колонкой цены. Категории = листы.
# Ручная цена = слово «вручную» (маркер manual). Данные читаются из data/materials.json.
#
# Запуск:
#   python catalog_export.py                 → окно с галочками (какие категории) + окно «куда сохранить»
#   python catalog_export.py --all <path>    → без окон: все категории в <path> (для тестов/автоматизации)
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'materials.json')
OUT_DIR = os.path.normpath(os.path.join(ROOT, '..', 'Выгрузки'))
OUT = os.path.join(OUT_DIR, 'ассортимент.xlsx')

SURFACES = [('korpus', 'корпус'), ('fasad', 'фасад'), ('fill', 'наполнение')]
SLIDE_TYPES = {'ball': 'Шариковые', 'soft': 'С доводчиком', 'push': 'Push-to-open', 'blum': 'BLUM'}
METAL_COLORS = {'white': 'Белый', 'silver': 'Серебро', 'black': 'Чёрный'}
MANUAL = 'вручную'  # маркер ручной цены (DATA-SCHEMA: price = "manual")

HELP_TEXT = [
    'Ассортимент и цены — как пользоваться (схема v0.2)',
    '',
    '1. Каждая строка — одна ценовая позиция. Меняйте числа в ЖЁЛТОЙ колонке цены (без «₽» и пробелов).',
    '2. Скрытые колонки «_key» не трогать — по ним загрузка находит позицию.',
    '3. «вручную» в колонке цены = позиция с ручной ценой (пользователь вводит цену при заказе).',
    '4. Новая строка внизу листа без «_key» = новая позиция (где это разрешено — ЛДСП, кромка,',
    '   наполнение дверей, профили, сетки, корзины, доп.элементы).',
    '5. Листы: ЛДСП (корпус/фасад/наполнение), Кромка, Наполнение дверей, Профили купе, Цвета профилей,',
    '   Сетчатые полки, Корзины, Направляющие, Фурнитура, Доп.элементы. Порядок колонок не менять.',
    '6. ЛДСП: вид задаёт текстура («Файл текстуры» = имя jpg из data/textures); цвет-hex опционален.',
    '7. Кромка привязана к цвету ЛДСП (колонка «Цвет ЛДСП») и толщине плиты (16/32).',
    '8. Когда закончили — сохраните и запустите загрузку (catalog_import.py).',
]


def load():
    with open(SRC, encoding='utf-8') as f:
        return json.load(f)


# ── Построители категорий ──────────────────────────────────────────────────────────────────
# Каждый возвращает dict: title, headers, rows, price_cols(1-based), hidden_cols, widths.
# rows — список списков значений в порядке headers. Ключ `_key` — последняя колонка (скрыта).

def cat_ldsp(d):
    headers = ['Поверхность', 'Производитель', 'Название', 'Толщина, мм', 'Цена ₽/м²', 'Файл текстуры', '_key']
    rows = []
    for key, label in SURFACES:
        for prod in d[key]['producers']:
            for c in prod['colors']:
                rows.append([label, prod['name'], c['name'], c.get('thickness', 16), c['pricePerM2'],
                             c.get('texture', ''), f"ldsp:{key}:{prod['id']}:{c['id']}"])
    return dict(title='ЛДСП', headers=headers, rows=rows, price_cols=[5], hidden_cols=[7],
                widths=[14, 18, 26, 12, 12, 20, 28])


def cat_edge(d):
    headers = ['Цвет ЛДСП', 'Поверхность', 'Плита', 'Цена ₽/пог.м', '_key']
    rows = []
    for key, label in SURFACES:
        for prod in d[key]['producers']:
            for c in prod['colors']:
                for plate, field in ((16, 'edgePerM16'), (32, 'edgePerM32')):
                    if field in c:
                        rows.append([c['name'], label, plate, c[field],
                                     f"edge:{key}:{prod['id']}:{c['id']}:{plate}"])
    return dict(title='Кромка', headers=headers, rows=rows, price_cols=[4], hidden_cols=[5],
                widths=[26, 14, 8, 14, 30])


def cat_door_fill(d):
    headers = ['Вид', 'Название', 'Цена ₽/м²', '_key']
    fills = d['slidingDoor']['fills']
    rows = [['Зеркало', fills['mirror'].get('name', 'Зеркало'), fills['mirror']['pricePerM2'], 'dfill:mirror']]
    for c in fills.get('glass', {}).get('colors', []):
        rows.append(['Стекло', c['name'], c['pricePerM2'], f"dfill:glass:{c['id']}"])
    # шаблон ручной позиции «спеццвет» (единая механика manual)
    rows.append(['Стекло', 'Спеццвет (ручная цена)', MANUAL, 'dfill:special'])
    return dict(title='Наполнение дверей', headers=headers, rows=rows, price_cols=[3], hidden_cols=[4],
                widths=[12, 26, 12, 20])


def cat_profile(d):
    headers = ['Профиль', 'Цвет', 'Цена ₽/пог.м', '_key']
    prof = {p['id']: p['name'] for p in d['slidingDoor']['profiles']}
    col = {c['id']: c['name'] for c in d['slidingDoor']['colors']}
    rows = []
    for pp in d['slidingDoor'].get('profilePrices', []):
        rows.append([prof.get(pp['element'], pp['element']), col.get(pp['color'], pp['color']),
                     pp['pricePerM'], f"prof:{pp['element']}:{pp['color']}"])
    return dict(title='Профили купе', headers=headers, rows=rows, price_cols=[3], hidden_cols=[4],
                widths=[18, 14, 14, 24])


def cat_profile_colors(d):
    headers = ['Название', 'Цвет (hex)', '_key']
    rows = [[c['name'], c.get('hex', ''), f"profcol:{c['id']}"] for c in d['slidingDoor']['colors']]
    return dict(title='Цвета профилей', headers=headers, rows=rows, price_cols=[], hidden_cols=[3],
                widths=[20, 12, 16])


def cat_mesh(d):
    headers = ['Название', 'Глубина, мм', 'Цвет', 'Цена ₽/пог.м', '_key']
    rows = [[m['name'], m['depth'], METAL_COLORS.get(m['color'], m['color']), m['pricePerM'],
             f"mesh:{m['depth']}:{m['color']}"] for m in d['meshShelf']]
    return dict(title='Сетчатые полки', headers=headers, rows=rows, price_cols=[4], hidden_cols=[5],
                widths=[22, 12, 12, 14, 18])


def cat_basket(d):
    headers = ['Ширина', 'Глубина', 'Высота', 'Цвет', 'Цена ₽/шт', '_key']
    rows = [[b['width'], b['depth'], b['height'], METAL_COLORS.get(b['color'], b['color']), b['price'],
             f"basket:{b['width']}:{b['depth']}:{b['height']}:{b['color']}"] for b in d['basket']]
    return dict(title='Корзины', headers=headers, rows=rows, price_cols=[5], hidden_cols=[6],
                widths=[10, 10, 10, 12, 12, 22])


def cat_slide(d):
    headers = ['Тип', 'Длина, мм', 'Цена ₽/компл.', '_key']
    rows = [[SLIDE_TYPES.get(s['type'], s['type']), s['length'], s['price'], f"slide:{s['type']}:{s['length']}"]
            for s in d['drawerSlide']]
    return dict(title='Направляющие', headers=headers, rows=rows, price_cols=[3], hidden_cols=[4],
                widths=[16, 12, 14, 18])


def cat_hardware(d):
    # Фурнитура и авто-комплекты: единица зависит от `per` (за штуку/изделие/дверь…) — показываем колонкой.
    per_label = {'item': 'за изделие', 'shelf': 'за полку', 'rod': 'за штангу', 'rodFlange': 'за фланец',
                 'set': 'за комплект', 'door': 'за дверь'}
    headers = ['Позиция', 'За что', 'Цена ₽', '_key']
    rows = []
    for it in d['fittings']:
        rows.append([it['name'], per_label.get(it.get('per'), it.get('per', 'за шт')), it['price'], f"fit:{it['id']}"])
    sw = d['swingDoorHardware']
    rows.append([sw['name'], 'за дверь', sw['pricePerDoor'], 'swing'])
    ro = d['slidingDoor']['rollers']
    rows.append([ro['name'], 'за дверь', ro['pricePerSet'], 'rollers'])
    # Штанга, доводчик, ручка ящика, крепёж, встройка — тоже редактируемые позиции (цена меняется
    # выгрузкой/загрузкой, как и всё остальное; крепёж/встройка — услуги в data['services']).
    rod = d.get('rod')
    if rod:
        rows.append([rod['name'], 'за пог.м', rod['pricePerM'], 'rod'])
    sc = d.get('doorSoftClose')
    if sc:
        rows.append([sc['name'], 'за дверь', sc['pricePerDoor'], 'softclose'])
    dh = d.get('drawerHandle')
    if dh:
        rows.append([dh['name'], 'за ящик', dh['pricePerDrawer'], 'handle'])
    for sid in ('fastener', 'embed'):
        sv = d.get('services', {}).get(sid)
        if sv:
            rows.append([sv['name'], 'за деталь', sv['price'], f'service:{sid}'])
    return dict(title='Фурнитура', headers=headers, rows=rows, price_cols=[3], hidden_cols=[4],
                widths=[44, 14, 12, 18])


def cat_addon(d):
    headers = ['Группа', 'Название', 'Цена ₽/шт', '_key']
    rows = []
    for grp in d['extras']:
        for it in grp['items']:
            rows.append([grp['name'], it['name'], it['price'], f"addon:{grp['id']}:{it['id']}"])
    # шаблон ручной «заказной» позиции
    rows.append(['Доп. элементы', 'Заказная позиция (ручная цена)', MANUAL, 'addon:custom:manual'])
    return dict(title='Доп.элементы', headers=headers, rows=rows, price_cols=[3], hidden_cols=[4],
                widths=[20, 40, 12, 22])


# Порядок = порядок в диалоге и в книге. (key, человекочитаемое имя, builder)
CATEGORIES = [
    ('ldsp', 'ЛДСП (корпус/фасад/наполнение)', cat_ldsp),
    ('edge', 'Кромка', cat_edge),
    ('door_fill', 'Наполнение дверей', cat_door_fill),
    ('profile', 'Профили купе', cat_profile),
    ('profile_colors', 'Цвета профилей', cat_profile_colors),
    ('mesh', 'Сетчатые полки', cat_mesh),
    ('basket', 'Корзины', cat_basket),
    ('slide', 'Направляющие', cat_slide),
    ('hardware', 'Фурнитура', cat_hardware),
    ('addon', 'Доп.элементы', cat_addon),
]


def choose_categories():
    """Окно с галочками: какие категории выгрузить. Возвращает список ключей или None (отмена)."""
    try:
        import tkinter as tk
    except Exception:
        return [k for k, _, _ in CATEGORIES]
    root = tk.Tk()
    root.title('Что выгрузить')
    root.attributes('-topmost', True)
    tk.Label(root, text='Отметьте категории для выгрузки:', font=('Segoe UI', 10, 'bold')).pack(anchor='w', padx=12, pady=(12, 4))
    vars_ = {}
    for k, label, _ in CATEGORIES:
        v = tk.BooleanVar(value=True)
        vars_[k] = v
        tk.Checkbutton(root, text=label, variable=v).pack(anchor='w', padx=18)
    result = {'ok': False}
    def ok():
        result['ok'] = True; root.quit()
    tk.Button(root, text='Выгрузить', width=16, command=ok).pack(pady=12)
    root.protocol('WM_DELETE_WINDOW', root.quit)
    root.mainloop()
    chosen = [k for k, _, _ in CATEGORIES if vars_[k].get()] if result['ok'] else None
    root.destroy()
    return chosen


def pick_save_path():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
        os.makedirs(OUT_DIR, exist_ok=True)
        path = filedialog.asksaveasfilename(title='Куда сохранить выгрузку?', initialdir=OUT_DIR,
                                            initialfile=os.path.basename(OUT), defaultextension='.xlsx',
                                            filetypes=[('Excel', '*.xlsx')])
        root.destroy()
        return path or None
    except Exception:
        return OUT


def build_workbook(data, chosen_keys):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    bold = Font(bold=True)
    price_fill = PatternFill('solid', fgColor='FFF6D5')
    # Справка
    ws = wb.active; ws.title = 'Справка'
    for line in HELP_TEXT:
        ws.append([line])
    ws.column_dimensions['A'].width = 105
    ws['A1'].font = bold
    # Категории
    for k, _, builder in CATEGORIES:
        if k not in chosen_keys:
            continue
        spec = builder(data)
        ws = wb.create_sheet(spec['title'])
        ws.append(spec['headers'])
        for c in range(1, len(spec['headers']) + 1):
            ws.cell(row=1, column=c).font = bold
        for i, wdt in enumerate(spec['widths'], start=1):
            ws.column_dimensions[get_column_letter(i)].width = wdt
        for c in spec['hidden_cols']:
            ws.column_dimensions[get_column_letter(c)].hidden = True
        ws.freeze_panes = 'A2'
        for row in spec['rows']:
            ws.append(row)
            r = ws.max_row
            for c in spec['price_cols']:
                ws.cell(row=r, column=c).fill = price_fill
    return wb


def main():
    global OUT, OUT_DIR
    args = sys.argv[1:]
    if args and args[0] == '--all':
        chosen = [k for k, _, _ in CATEGORIES]
        OUT = args[1] if len(args) > 1 else OUT
    else:
        # --dir <папка>: куда по умолчанию сохранять (батник передаёт Config\Выгрузки)
        if len(args) >= 2 and args[0] == '--dir':
            OUT_DIR = args[1]
            OUT = os.path.join(OUT_DIR, 'ассортимент.xlsx')
        chosen = choose_categories()
        if not chosen:
            print('Выгрузка отменена.'); return 1
        picked = pick_save_path()
        if not picked:
            print('Выгрузка отменена — путь не выбран.'); return 1
        OUT = picked
    data = load()
    wb = build_workbook(data, chosen)
    os.makedirs(os.path.dirname(os.path.abspath(OUT)) or '.', exist_ok=True)
    try:
        wb.save(OUT)
    except PermissionError:
        print(f'ОШИБКА: файл «{os.path.basename(OUT)}» открыт в Excel — закройте и повторите.'); return 1
    print(f'Готово: {OUT}')
    print('Листы: ' + ', '.join(wb.sheetnames))
    return 0


if __name__ == '__main__':
    code = main()
    if not (len(sys.argv) > 1 and sys.argv[1] == '--all'):
        input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
