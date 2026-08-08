# -*- coding: utf-8 -*-
# Создание элементов материала из папки с текстурами (задание 7.08).
# Раньше «Загрузить текстуры.bat» на незнакомый файл писал «нет такого материала» — и всё. Теперь
# есть второй шаг: указываешь ту же папку, скрипт показывает, каких материалов ещё нет, спрашивает
# недостающие поля ПАЧКОЙ (производитель, тип, толщина, цена, поверхности, кромка, габарит листа) —
# и заводит материалы сам: с текстурой, посчитанным из картинки цветом и пустыми кромками 16/32.
# Дальше обычный путь: «Выгрузить цены.bat» → проверить/поправить/удалить в Excel → загрузить.
#
# Названия берутся из ИМЁН ФАЙЛОВ (префикс производителя отбрасывается): «ТОМСК Акация Светлая.bmp»
# → материал «Акация Светлая» производителя ТОМСК. Перед записью список показывается на проверку.
#
# Запуск:
#   python materials_new.py                  → окно выбора папки
#   python materials_new.py --dir <папка>     → взять подпапку «Текстуры» рядом (как батник)
#   python materials_new.py --from <папка>    → без окон (для тестов)
import json
import os
import sys
import copy

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
# Отвечают на вопросы кириллицей — консольный ввод тоже читаем в utf-8, иначе «да» приходит
# кракозябрами и ответ понимается как «нет».
try:
    sys.stdin.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from textures_import import (                      # noqa: E402  — общий код заливки текстур
    DST, TEX_DIR, EXTS, SRC_SUBDIR, norm, slug, prepare,
    all_materials, material_keys, has_images, pick_folder,
)
from catalog_import import slugify, create_ldsp_member   # noqa: E402

SURFACES = (('korpus', 'корпус'), ('fasad', 'фасад'), ('fill', 'наполнение'))


def ask(prompt, default=''):
    """Вопрос с подсказкой значения по умолчанию (Enter = принять его)."""
    suffix = f' [{default}]' if default != '' else ''
    try:
        v = input(f'{prompt}{suffix}: ').strip()
    except EOFError:
        v = ''
    return v or str(default)


def ask_num(prompt, default, allow_empty=False):
    while True:
        v = ask(prompt, default)
        if allow_empty and v == '':
            return None
        try:
            f = float(str(v).replace(',', '.'))
            return int(f) if f == int(f) else f
        except ValueError:
            print('  нужно число, попробуйте ещё раз')


def ask_yes(prompt, default='да'):
    return ask(prompt + ' (да/нет)', default).strip().lower() in ('да', 'yes', 'y', '1', '+')


def existing_keys(data):
    """Все имена уже заведённых материалов в нормализованном виде — чтобы не заводить повторно."""
    keys = set()
    for _surf, prod, c in all_materials(data):
        keys |= material_keys(c, prod.get('name'))
    return keys


def strip_producer(stem, producer):
    """Убрать имя производителя из начала имени файла: «ТОМСК Акация» → «Акация»."""
    s, p = str(stem).strip(), str(producer or '').strip()
    if p and s.lower().startswith(p.lower()):
        return s[len(p):].strip(' _-') or s
    return s


def guess_producer(stems):
    """Подсказка: первое слово, общее для большинства имён файлов (обычно это производитель)."""
    first = {}
    for s in stems:
        w = str(s).split()[0] if str(s).split() else ''
        if w:
            first[w] = first.get(w, 0) + 1
    if not first:
        return ''
    w, n = max(first.items(), key=lambda kv: kv[1])
    return w if n >= max(2, len(stems) // 2) else ''


def main():
    args = sys.argv[1:]
    src = None
    if '--from' in args:
        i = args.index('--from')
        src = args[i + 1] if len(args) > i + 1 else None
    elif '--dir' in args:
        i = args.index('--dir')
        base = args[i + 1] if len(args) > i + 1 else ''
        cand = os.path.join(base, SRC_SUBDIR)
        src = cand if has_images(cand) else pick_folder(cand if os.path.isdir(cand) else base)
    else:
        src = pick_folder()
    if not src or not os.path.isdir(src):
        print('Отменено — папка не выбрана.')
        return 1

    files = [f for f in sorted(os.listdir(src))
             if os.path.splitext(f)[1].lower() in EXTS and os.path.isfile(os.path.join(src, f))]
    if not files:
        print(f'В папке нет картинок: {src}')
        return 1

    with open(DST, encoding='utf-8') as f:
        original = json.load(f)
    data = copy.deepcopy(original)

    have = existing_keys(data)
    stems = [os.path.splitext(f)[0] for f in files]
    # уже заведённые пропускаем: файл привязывает «Загрузить текстуры.bat»
    new_files = [(f, st) for f, st in zip(files, stems) if norm(st) not in have]
    known = len(files) - len(new_files)
    print(f'Папка: {src}')
    print(f'Картинок: {len(files)}; уже есть в каталоге: {known}; НОВЫХ: {len(new_files)}')
    if not new_files:
        print('Заводить нечего — все материалы уже в каталоге.')
        return 0

    # ── вопросы пачкой ────────────────────────────────────────────────────────────────────────
    print('\nОтветьте на несколько вопросов — они применятся ко ВСЕМ новым материалам.')
    producer = ask('Производитель', guess_producer(stems))
    # с учётом производителя часть имён может совпасть с уже заведёнными — пересчитываем
    new_files = [(f, st) for f, st in new_files if norm(strip_producer(st, producer)) not in have]
    if not new_files:
        print('После отбрасывания имени производителя новых материалов не осталось.')
        return 0
    kind = ask('Тип материала (ЛДСП / МДФ / …)', 'ЛДСП')
    thickness = ask_num('Толщина, мм', 16)
    price = ask_num('Цена ₽/м² (0 — заполню потом в Excel)', 0)
    surf_flags = [(key, ask_yes(f'Доступен в разделе «{label}»?', 'да')) for key, label in SURFACES]
    if not any(on for _k, on in surf_flags):
        print('Не выбран ни один раздел — нечего заводить.')
        return 1
    edge16 = ask_num('Цена кромки на 16, ₽/пог.м (0 — потом)', 0)
    edge32 = ask_num('Цена кромки на 32, ₽/пог.м (0 — потом)', 0)
    # Габарит ЛИСТА (решение пользователя 8.08): деталь конфигуратор режет на 10 мм меньше —
    # обзол при пилении, см. js/core/part-limits.js. Поля исторически зовутся maxPart*.
    max_l = ask_num('Длина ЛИСТА, мм (Enter — без ограничения)', '', allow_empty=True)
    max_w = ask_num('Ширина ЛИСТА, мм (Enter — без ограничения)', '', allow_empty=True)

    names = [(f, strip_producer(st, producer)) for f, st in new_files]
    print(f'\nБудет заведено {len(names)} материалов ({producer}, {kind}, {thickness} мм):')
    for _f, nm in names[:30]:
        print('  • ' + nm)
    if len(names) > 30:
        print(f'  … и ещё {len(names) - 30}')
    if not ask_yes('\nЗаводить?', 'да'):
        print('Отменено — ничего не записано.')
        return 0

    # ── создание ──────────────────────────────────────────────────────────────────────────────
    created, errors = [], []
    used_gids = {c.get('gid') for _s, _p, c in all_materials(data) if c.get('gid')}
    for fname, mname in names:
        target = slug(f'{producer}_{mname}') + '.jpg'
        # prepare(): проверка → сжатие → сохранение; третьим отдаёт средний цвет картинки
        ok, note, hexv = prepare(os.path.join(src, fname), os.path.join(TEX_DIR, target))
        if not ok:
            errors.append(f'{fname}: {note}')
            continue
        hexv = hexv or ''
        gid = slugify(f'{producer}_{mname}_{thickness}', used_gids, 'ldsp')
        used_gids.add(gid)
        maxp = (max_l, max_w)
        for surf, on in surf_flags:
            if not on:
                continue
            create_ldsp_member(data, surf, gid, producer, mname, thickness, price,
                               target, hexv, maxp, kind)
            # кромки заводятся вместе с материалом (create_ldsp_member ставит 0) — проставим цены
            col = data[surf]['producers'][-1]['colors'][-1]
            for prod in data[surf]['producers']:
                for c in prod['colors']:
                    if c.get('gid') == gid:
                        col = c
            col['edgePerM16'] = edge16
            col['edgePerM32'] = edge32
            if hexv:
                col['colorAuto'] = True     # цвет посчитан из картинки, ручной не затирался
        created.append(f'{mname} ({note})')

    if errors:
        print('\nОШИБКИ — ничего не записано:')
        for e in errors:
            print('  • ' + e)
        return 1

    try:
        with open(DST + '.bak', 'w', encoding='utf-8') as f:
            json.dump(original, f, ensure_ascii=False, indent=2)
        tmp = DST + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DST)
    except Exception as e:
        print(f'ОШИБКА записи каталога: {e}')
        return 1

    print(f'\nЗаведено материалов: {len(created)} (с текстурой, цветом из картинки и кромками 16/32)')
    for line in created[:30]:
        print('  • ' + line)
    if len(created) > 30:
        print(f'  … и ещё {len(created) - 30}')
    print(f'\nБэкап прежней версии: {os.path.basename(DST)}.bak')
    print('Дальше: «Выгрузить цены.bat» — проверьте цены и названия, поправьте или удалите лишнее.')
    return 0


if __name__ == '__main__':
    code = main()
    if '--from' not in sys.argv:
        input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
