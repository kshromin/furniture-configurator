# -*- coding: utf-8 -*-
# Выгрузка цен и ассортимента конфигуратора в Excel (задание «скрипт для цен 18,07»).
# Читает data/materials.json → пишет «для работы/цены.xlsx» (по листу на категорию).
# Правки вносятся в Excel, обратно — скриптом prices_import.py («Загрузить цены.bat»).
#
# Устройство файла:
#  - служебные колонки (_id и т.п.) скрыты — по ним импорт находит позицию, руками не трогать;
#  - листы «только цены» (Направляющие, Сетчатые полки, Корзины, Фурнитура) — менять можно
#    только цену, новые строки запрещены (ассортимент там жёстко связан с кодом конфигуратора);
#  - листы с ассортиментом (ЛДСП, Профили, Цвета профилей, Наполнение дверей, Услуги) — новая
#    строка внизу без служебного id = новая позиция;
#  - первый лист «Справка» — те же правила словами, для пользователя.
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'materials.json')
OUT_DIR = os.path.join(ROOT, 'для работы')
OUT = os.path.join(OUT_DIR, 'цены.xlsx')

SLIDE_TYPES = {'ball': 'Шариковые', 'soft': 'С доводчиком', 'push': 'Push-to-open', 'blum': 'BLUM'}
LDSP_GROUPS = [('korpus', 'ЛДСП корпус'), ('fasad', 'ЛДСП фасад'), ('fill', 'ЛДСП наполнение')]

HELP_TEXT = [
    'Как пользоваться этим файлом',
    '',
    '1. Меняйте цены прямо в жёлтых колонках — числа, без «₽» и пробелов.',
    '2. Листы с ассортиментом (ЛДСП, Профили купе, Цвета профилей, Наполнение дверей, Услуги):',
    '   новая строка внизу таблицы = новая позиция. Заполните все видимые колонки строки.',
    '   На листах ЛДСП новый производитель создаётся сам — просто напишите его имя в строке.',
    '   «Профили купе» — прайс по сочетаниям: на КАЖДУЮ пару профиль+цвет своя строка с ценами.',
    '   Новый цвет профиля: сначала строка на листе «Цвета профилей», затем строки с ценами',
    '   этого цвета для каждого профиля на листе «Профили купе» (загрузка подскажет, каких нет).',
    '   Новый профиль: просто строки с его именем и ценами на «Профили купе» (по всем цветам).',
    '3. Листы только с ценами (Направляющие, Сетчатые полки, Корзины, Фурнитура и разное):',
    '   новые строки добавлять нельзя — только менять цены.',
    '4. Скрытые колонки (_id и похожие) не трогать — по ним загрузка находит позиции.',
    '5. Удалять строки нельзя — вывод позиции из ассортимента будет отдельным скриптом.',
    '6. «Файл текстуры» на листах ЛДСП — задел на будущее: имя jpg-файла из папки data/textures.',
    '   Пока текстур нет — оставляйте пусто, работает цвет из колонки Hex.',
    '7. Цвет (hex) — 6 знаков вида #f4f3f0 (можно скопировать из любого пипетки-сервиса).',
    '8. Когда закончили — сохраните файл и запустите «Загрузить цены.bat».',
    '   Загрузка сначала всё проверит: при любой ошибке ничего не изменится, будет список ошибок.',
]


def main():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    with open(SRC, encoding='utf-8') as f:
        data = json.load(f)

    wb = Workbook()
    bold = Font(bold=True)
    price_fill = PatternFill('solid', fgColor='FFF6D5')  # жёлтый — редактируемые цены

    def sheet(title, headers, hidden_cols=(), price_cols=(), widths=()):
        ws = wb.create_sheet(title)
        ws.append(headers)
        for c in range(1, len(headers) + 1):
            ws.cell(row=1, column=c).font = bold
        for i, wdt in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = wdt
        for c in hidden_cols:
            ws.column_dimensions[get_column_letter(c)].hidden = True
        ws.freeze_panes = 'A2'
        ws._price_cols = price_cols
        return ws

    def add_row(ws, values):
        ws.append(values)
        r = ws.max_row
        for c in ws._price_cols:
            ws.cell(row=r, column=c).fill = price_fill

    # Справка
    ws = wb.active
    ws.title = 'Справка'
    for line in HELP_TEXT:
        ws.append([line])
    ws.column_dimensions['A'].width = 100
    ws['A1'].font = bold

    # ЛДСП: корпус / фасад / наполнение
    for group, title in LDSP_GROUPS:
        ws = sheet(title,
                   ['Производитель', 'Название цвета', 'Цвет (hex)', 'Цена ₽/м²', 'Файл текстуры', '_id', '_producer'],
                   hidden_cols=(6, 7), price_cols=(4,), widths=(18, 26, 12, 12, 20, 10, 12))
        for prod in data[group]['producers']:
            for col in prod['colors']:
                add_row(ws, [prod['name'], col['name'], col['color'], col['pricePerM2'],
                             col.get('texture', ''), col['id'], prod['id']])

    # Профили купе — полный прайс по сочетаниям профиль×цвет (не коэффициенты, просьба 21.07)
    ws = sheet('Профили купе',
               ['Профиль', 'Цвет', 'Вертикаль ₽/пог.м', 'Горизонт. верх ₽/пог.м', 'Горизонт. низ ₽/пог.м', '_key'],
               hidden_cols=(6,), price_cols=(3, 4, 5), widths=(18, 14, 18, 20, 20, 16))
    prof_names = {p['id']: p['name'] for p in data['slidingDoor']['profiles']}
    col_names = {c['id']: c['name'] for c in data['slidingDoor']['colors']}
    for pp in data['slidingDoor'].get('profilePrices', []):
        add_row(ws, [prof_names.get(pp['profile'], pp['profile']), col_names.get(pp['color'], pp['color']),
                     pp['vertPerM'], pp['horizTopPerM'], pp['horizBottomPerM'],
                     f"{pp['profile']}:{pp['color']}"])

    # Цвета профилей (только ассортимент — цены на листе «Профили купе»)
    ws = sheet('Цвета профилей',
               ['Название', 'Цвет (hex)', '_id'],
               hidden_cols=(3,), price_cols=(), widths=(20, 12, 10))
    for c in data['slidingDoor']['colors']:
        add_row(ws, [c['name'], c['hex'], c['id']])

    # Наполнение дверей: зеркало (только цена) + стёкла (ассортимент)
    ws = sheet('Наполнение дверей',
               ['Тип', 'Название', 'Цвет (hex)', 'Цена ₽/м²', '_id'],
               hidden_cols=(5,), price_cols=(4,), widths=(12, 22, 12, 12, 10))
    fills = data['slidingDoor']['fills']
    add_row(ws, ['Зеркало', fills['mirror'].get('name', 'Зеркало'), '', fills['mirror']['pricePerM2'], 'mirror'])
    for c in fills.get('glass', {}).get('colors', []):
        add_row(ws, ['Стекло', c['name'], c['color'], c['pricePerM2'], c['id']])

    # Направляющие (только цены, размерная сетка фиксирована)
    ws = sheet('Направляющие',
               ['Тип', 'Длина, мм', 'Цена ₽/компл.', '_key'],
               hidden_cols=(4,), price_cols=(3,), widths=(16, 12, 14, 14))
    for s in data['drawerSlide']:
        add_row(ws, [SLIDE_TYPES.get(s['type'], s['type']), s['length'], s['price'], f"{s['type']}:{s['length']}"])

    # Сетчатые полки (только цены)
    ws = sheet('Сетчатые полки',
               ['Название', 'Цена ₽/пог.м', '_key'],
               hidden_cols=(3,), price_cols=(2,), widths=(22, 14, 14))
    for m in data['meshShelf']:
        add_row(ws, [m['name'], m['pricePerM'], f"{m['depth']}:{m['color']}"])

    # Корзины (только цены)
    ws = sheet('Корзины',
               ['Ширина', 'Глубина', 'Высота', 'Цвет', 'Цена ₽', '_key'],
               hidden_cols=(6,), price_cols=(5,), widths=(10, 10, 10, 12, 12, 18))
    for b in data['basket']:
        add_row(ws, [b['width'], b['depth'], b['height'], b['color'], b['price'],
                     f"{b['width']}:{b['depth']}:{b['height']}:{b['color']}"])

    # Фурнитура и разное (только цены, общий лист со скрытым ключом-путём)
    ws = sheet('Фурнитура и разное',
               ['Позиция', 'Цена ₽', '_key'],
               hidden_cols=(3,), price_cols=(2,), widths=(44, 12, 20))
    for it in data['fittings']:
        add_row(ws, [it['name'], it['price'], f"fittings:{it['id']}"])
    add_row(ws, [data['swingDoorHardware']['name'], data['swingDoorHardware']['pricePerDoor'], 'swing'])
    sd = data['slidingDoor']
    add_row(ws, [sd['rollers']['name'], sd['rollers']['pricePerSet'], 'rollers'])
    add_row(ws, [sd['track']['name'], sd['track']['pricePerM'], 'track'])
    add_row(ws, [sd['divider']['name'], sd['divider']['pricePerM'], 'divider'])
    add_row(ws, ['Кромка (за пог. м)', data['edgeBanding']['pricePerM'], 'edge'])

    # Услуги (extras) — ассортимент расширяемый
    ws = sheet('Услуги',
               ['Группа', 'Название', 'Цена ₽', '_group', '_id'],
               hidden_cols=(4, 5), price_cols=(3,), widths=(20, 40, 12, 12, 12))
    for grp in data['extras']:
        for it in grp['items']:
            add_row(ws, [grp['name'], it['name'], it['price'], grp['id'], it['id']])

    os.makedirs(OUT_DIR, exist_ok=True)
    try:
        wb.save(OUT)
    except PermissionError:
        print('ОШИБКА: файл «цены.xlsx» открыт в Excel — закройте его и запустите выгрузку ещё раз.')
        return 1
    print(f'Готово: {OUT}')
    print('Листы: ' + ', '.join(wb.sheetnames))
    print('Правьте цены/ассортимент и запускайте «Загрузить цены.bat».')
    return 0


if __name__ == '__main__':
    code = main()
    input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
