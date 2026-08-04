# -*- coding: utf-8 -*-
# Выгрузка ассортимента/цен конфигуратора в Excel — ЕДИНЫЙ формат колонок (шаблон пользователя
# «Выгрузки/шаблон.xlsx», задание 4.08). Категории = отдельные листы (вариант «А»), но набор и
# порядок колонок ОДИНАКОВЫЙ на всех листах — что не относится к категории, остаётся пустым.
#
# Колонки (см. HEADERS): ключ | производитель | название | цвет | ед.изм | ЦЕНА | высота | длинна |
# ширина | от чего зависит | цвет(hex) | Корпус | Фасад | Наполнение | файл текстуры.
# Ключ теперь ВИДИМЫЙ (первая колонка) — по нему загрузка находит позицию.
# Ручная цена = слово «вручную». Данные — из data/materials.json.
#
# Поля, которых в базе нет (производитель у неплитных категорий, габариты листа/хлыста и т.п.),
# хранятся в data['catalogMeta'][ключ] = {producer,h,l,w,dep,hex}: в первой выгрузке они пустые,
# пользователь заполняет в Excel, загрузка сохраняет обратно. Поля, которые СЛЕДУЮТ из самой
# позиции (толщина плиты, длина направляющей, размеры корзины, глубина сетки, hex профиля…),
# выводятся из базы и в meta не пишутся — см. DERIVED и «Справку» в книге.
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

# Общие для всех листов колонки (порядок менять нельзя — по нему читает catalog_import.py).
HEADERS = ['Артикул/ид/key', 'Производитель', 'Название', 'Цвет', 'Ед.изм', 'Цена',
           'Высота, мм', 'Длинна, мм', 'Ширина, мм', 'От чего зависит', 'Цвет (hex)',
           'Корпус', 'Фасад', 'Наполнение', 'Файл текстуры']
WIDTHS = [34, 16, 24, 24, 10, 10, 12, 12, 12, 30, 12, 8, 8, 12, 18]
PRICE_COL = 6

# Единицы измерения
U_M2, U_M, U_PC, U_SET, U_PART = 'кв.м', 'пог.м', 'шт', 'комплект', 'деталь'
PER_UNIT = {'item': 'изделие', 'shelf': 'полка', 'rod': 'штанга', 'rodFlange': 'фланец',
            'set': U_SET, 'door': 'дверь', 'drawer': 'ящик'}
# Названия «общих» элементов профиля (вертикальные берут имя из каталога профилей)
ELEMENT_LABELS = {'horizTop': 'Горизонт верхний', 'horizBottom': 'Горизонт нижний',
                  'divider': 'Перемычка', 'track': 'Направляющая'}

# Какие поля СЛЕДУЮТ из самой позиции (не из catalogMeta): их правка в Excel не сохраняется —
# позиция задаётся ключом. Ключ таблицы — тег ключа (часть до первого «:»).
DERIVED = {
    'ldsp':   {'h', 'hex', 'dep', 'producer'},  # толщина/hex/производитель пишутся в саму позицию; в meta — длина/ширина (макс. размер детали)
    'ldspm':  {'h', 'hex', 'producer'},  # высота = толщина плиты, hex/производитель — из базы
    'edge':   {'h', 'dep'},          # высота = плита 16/32, «от чего зависит» = ключ ЛДСП
    'dfill':  {'hex'},
    'prof':   {'hex'},               # hex — из каталога цветов профиля
    'profcol': {'hex'},
    'mesh':   {'w'},                 # ширина = глубина полки
    'basket': {'h', 'l', 'w'},       # высота/длина/ширина — размеры корзины из ключа
    'slide':  {'l'},                 # длина направляющей
}

HELP_TEXT = [
    'Ассортимент и цены — как пользоваться (единый формат, 4.08)',
    '',
    '1. Колонки ОДИНАКОВЫЕ на всех листах; что не относится к категории — пустое. Порядок не менять.',
    '2. Каждая строка — одна позиция. «Артикул/ид/key» — по нему загрузка находит позицию, не менять.',
    '3. Цена — ЖЁЛТАЯ колонка (числом, без «₽» и пробелов). «вручную» = цену вводит пользователь при заказе.',
    '4. Пустые «Производитель», габариты (высота/длинна/ширина), «От чего зависит» — заполняйте:',
    '   они сохранятся при загрузке (в базе таких полей раньше не было).',
    '5. Габариты, которые СЛЕДУЮТ из самой позиции, менять здесь бесполезно (вернутся при выгрузке):',
    '   толщина плиты ЛДСП и кромки, длина направляющей, размеры корзины, глубина сетчатой полки.',
    '   Такие размеры задаются самой позицией — заведите новую строку с нужным размером.',
    '6. Новая строка внизу листа без ключа = новая позиция (ЛДСП, наполнение дверей, сетки, корзины,',
    '   доп.элементы). На остальных листах новые строки пропускаются.',
    '7. ЛДСП: одна строка = один материал; «Корпус/Фасад/Наполнение» — да/нет, где он доступен.',
    '   «да» без записи — заведётся, «нет» с записью — уберётся. Вид задаёт «Файл текстуры».',
    '8. Кромка привязана к материалу ЛДСП — см. «От чего зависит» (ключ ЛДСП) и высоту (плита 16/32).',
    '9. Когда закончили — сохраните файл и запустите загрузку («Загрузить цены.bat»).',
]


def load():
    with open(SRC, encoding='utf-8') as f:
        return json.load(f)


def meta_of(d, key):
    return (d.get('catalogMeta') or {}).get(key, {})


def row(d, key, name='', color='', unit='', price='', producer='', h='', l='', w='',
        dep='', hexv='', korpus='', fasad='', fill='', texture=''):
    """Строка в едином формате. Пустые «свободные» поля добираются из catalogMeta по ключу."""
    m = meta_of(d, key)
    return [key,
            producer or m.get('producer', ''),
            name, color, unit, price,
            h if h != '' else m.get('h', ''),
            l if l != '' else m.get('l', ''),
            w if w != '' else m.get('w', ''),
            dep or m.get('dep', ''),
            hexv or m.get('hex', ''),
            korpus, fasad, fill, texture]


# ── Построители категорий: возвращают dict(title, rows) ─────────────────────────────────────

def ldsp_gid_of(prod, c):
    """Стабильный id материала (НЕ из имени): свой gid, иначе детерминированно из id первого члена."""
    return c.get('gid') or f"{prod['id']}__{c['id']}"


def ldsp_color_disp(name):
    """В столбце «Цвет» — без слова «ЛДСП» (оно и так в «Названии»)."""
    n = str(name or '')
    return n[5:].strip() if n.lower().startswith('лдсп ') else n


def cat_ldsp(d):
    # Одна строка на материал (группа по производитель+имя+толщина через все поверхности);
    # поверхности — столбцы да/нет. Ключ = стабильный gid (не из имени) → правка имени = обновление
    # той же позиции, без дублей. «Название» = ЛДСП, «Цвет» = название цвета без слова «ЛДСП».
    groups = {}  # (произв., имя, толщина) -> {gid, price, texture, hex, cname, surf:set(), order}
    seq = 0
    for surf, _lbl in SURFACES:
        for prod in d[surf]['producers']:
            for c in prod['colors']:
                k = (prod['name'], c['name'], c.get('thickness', 16))
                g = groups.get(k)
                if g is None:
                    g = {'gid': ldsp_gid_of(prod, c), 'price': c['pricePerM2'],
                         'texture': c.get('texture', ''), 'hex': c.get('color', ''),
                         'cname': c['name'], 'surf': set(), 'order': seq}
                    seq += 1
                    groups[k] = g
                elif c.get('gid'):
                    g['gid'] = c['gid']  # сохранённый gid приоритетнее выведенного
                g['surf'].add(surf)
    yn = lambda s, g: 'да' if s in g['surf'] else 'нет'
    rows = []
    for (pname, cname, th), g in sorted(groups.items(), key=lambda kv: kv[1]['order']):
        key = f"ldsp:{g['gid']}"
        rows.append(row(d, key, name='ЛДСП', color=ldsp_color_disp(cname), unit=U_M2, price=g['price'],
                        producer=pname, h=th, hexv=g['hex'], korpus=yn('korpus', g),
                        fasad=yn('fasad', g), fill=yn('fill', g), texture=g['texture']))
    return dict(title='ЛДСП', rows=rows)


def cat_edge(d):
    rows = []
    for surf, _label in SURFACES:
        for prod in d[surf]['producers']:
            for c in prod['colors']:
                th = c.get('thickness', 16)
                for plate, field in ((16, 'edgePerM16'), (32, 'edgePerM32')):
                    if field in c:
                        key = f"edge:{surf}:{prod['id']}:{c['id']}:{plate}"
                        rows.append(row(d, key, name='Кромка', color=c['name'], unit=U_M,
                                        price=c[field], h=plate,
                                        dep=f"ldspm:{prod['name']}|{c['name']}|{th}"))
    return dict(title='Кромка', rows=rows)


def cat_door_fill(d):
    fills = d['slidingDoor']['fills']
    rows = [row(d, 'dfill:mirror', name='Зеркало', color=fills['mirror'].get('name', 'Зеркало'),
                unit=U_M2, price=fills['mirror']['pricePerM2'])]
    for c in fills.get('glass', {}).get('colors', []):
        rows.append(row(d, f"dfill:glass:{c['id']}", name='Стекло', color=c['name'], unit=U_M2,
                        price=c['pricePerM2'], hexv=c.get('color', '')))
    # шаблон ручной позиции «спеццвет» (единая механика manual)
    rows.append(row(d, 'dfill:special', name='Стекло', color='Спеццвет (ручная цена)',
                    unit=U_M2, price=MANUAL))
    return dict(title='Наполнение дверей', rows=rows)


def cat_profile(d):
    prof = {p['id']: p['name'] for p in d['slidingDoor']['profiles']}
    cols = {c['id']: c for c in d['slidingDoor']['colors']}
    rows = []
    for pp in d['slidingDoor'].get('profilePrices', []):
        el = pp['element']
        label = ELEMENT_LABELS.get(el) or (prof.get(el, el) + ' вертикальный')
        c = cols.get(pp['color'], {})
        rows.append(row(d, f"prof:{el}:{pp['color']}", name=label, color=c.get('name', pp['color']),
                        unit=U_M, price=pp['pricePerM'], hexv=c.get('hex', '')))
    return dict(title='Профили купе', rows=rows)


def cat_profile_colors(d):
    rows = [row(d, f"profcol:{c['id']}", name='Цвет профиля', color=c['name'], hexv=c.get('hex', ''))
            for c in d['slidingDoor']['colors']]
    return dict(title='Цвета профилей', rows=rows)


def cat_mesh(d):
    rows = [row(d, f"mesh:{m['depth']}:{m['color']}", name=m['name'],
                color=METAL_COLORS.get(m['color'], m['color']), unit=U_M, price=m['pricePerM'],
                w=m['depth']) for m in d['meshShelf']]
    return dict(title='Сетчатые полки', rows=rows)


def cat_basket(d):
    rows = [row(d, f"basket:{b['width']}:{b['depth']}:{b['height']}:{b['color']}", name='Корзина',
                color=METAL_COLORS.get(b['color'], b['color']), unit=U_PC, price=b['price'],
                h=b['height'], l=b['width'], w=b['depth']) for b in d['basket']]
    return dict(title='Корзины', rows=rows)


def cat_slide(d):
    rows = [row(d, f"slide:{s['type']}:{s['length']}",
                name=SLIDE_TYPES.get(s['type'], s['type']) + ' направляющие', unit=U_PC,
                price=s['price'], l=s['length']) for s in d['drawerSlide']]
    return dict(title='Направляющие', rows=rows)


def cat_hardware(d):
    rows = []
    for it in d['fittings']:
        rows.append(row(d, f"fit:{it['id']}", name=it['name'],
                        unit=PER_UNIT.get(it.get('per'), U_PC), price=it['price']))
    sw = d['swingDoorHardware']
    rows.append(row(d, 'swing', name=sw['name'], unit='дверь', price=sw['pricePerDoor']))
    ro = d['slidingDoor']['rollers']
    rows.append(row(d, 'rollers', name=ro['name'], unit=U_SET, price=ro['pricePerSet']))
    rod = d.get('rod')
    if rod:
        rows.append(row(d, 'rod', name=rod['name'], unit=U_M, price=rod['pricePerM']))
    sc = d.get('doorSoftClose')
    if sc:
        rows.append(row(d, 'softclose', name=sc['name'], unit='дверь', price=sc['pricePerDoor']))
    dh = d.get('drawerHandle')
    if dh:
        rows.append(row(d, 'handle', name=dh['name'], unit='ящик', price=dh['pricePerDrawer']))
    return dict(title='Фурнитура', rows=rows)


def cat_service(d):
    # Услуги — отдельным листом (в шаблоне «Далее УСЛУГИ»): считаются автоматически по правилам
    # приложения, единица — за что берётся плата.
    rows = []
    for sid, sv in (d.get('services') or {}).items():
        rows.append(row(d, f'service:{sid}', name=sv.get('name', sid), unit=U_PART, price=sv.get('price', 0)))
    return dict(title='Услуги', rows=rows)


def cat_addon(d):
    # «Название» = группа (Доставка/Монтаж/…), «Цвет» = конкретная позиция (как в шаблоне).
    rows = []
    for grp in d['extras']:
        for it in grp['items']:
            key = f"addon:{grp['id']}:{it['id']}"
            price = MANUAL if it.get('manual') else it['price']
            rows.append(row(d, key, name=grp['name'], color=it['name'], unit=U_PC, price=price))
    # шаблон ручной «заказной» позиции
    rows.append(row(d, 'addon:custom:manual', name='Доп. элементы',
                    color='Заказная позиция (ручная цена)', unit=U_PC, price=MANUAL))
    return dict(title='Доп.элементы', rows=rows)


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
    ('service', 'Услуги', cat_service),
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
    # Категории — единые колонки на всех листах
    for k, _, builder in CATEGORIES:
        if k not in chosen_keys:
            continue
        spec = builder(data)
        ws = wb.create_sheet(spec['title'])
        ws.append(HEADERS)
        for c in range(1, len(HEADERS) + 1):
            ws.cell(row=1, column=c).font = bold
        for i, wdt in enumerate(WIDTHS, start=1):
            ws.column_dimensions[get_column_letter(i)].width = wdt
        ws.freeze_panes = 'B2'
        for r in spec['rows']:
            ws.append(r)
            ws.cell(row=ws.max_row, column=PRICE_COL).fill = price_fill
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
