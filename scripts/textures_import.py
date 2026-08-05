# -*- coding: utf-8 -*-
# Заливка текстур материалов (задание «текстуры 17,07» + «закладка материалы» п.6).
# Пользователь кладёт ГОТОВЫЕ файлы текстур в папку и запускает скрипт («Загрузить текстуры.bat»).
# Скрипт сам: проверяет → сжимает → кладёт в data/textures → привязывает к материалам в каталоге.
#
# ДВА ПРАВИЛА ПРИВЯЗКИ (работают вместе, задание 5.08):
#   (А) по колонке «Файл текстуры» — если у материала она заполнена, ищем файл с таким именем;
#   (Б) по имени файла = названию материала — «Белый альпийский.jpg» сам найдёт свой материал
#       и ПРОСТАВИТ колонку. Сравнение нестрогое: регистр, пробелы/знаки и «ё» не важны,
#       слово-тип («ЛДСП», «МДФ») можно и писать, и опускать.
# Что не совпало — печатается списком (материалы без текстуры и лишние файлы), чтобы дозаполнить
# колонку в Excel вручную (правило А).
#
# ПРОИЗВОДИТЕЛЬНОСТЬ (правила из задания): текстура — повторяющийся рисунок, не фото. Файлы
# ужимаются до 1024 px по большей стороне и пересохраняются в jpg — это единственный реальный
# способ не посадить fps. В заказы/базу картинки НЕ пишутся: в материале хранится только имя файла.
#
# Запуск:
#   python textures_import.py                 → окно выбора папки с текстурами
#   python textures_import.py --from <папка>  → без окна (для тестов)
#   доп. флаг --dry — только показать, что будет сделано, ничего не менять
import json
import os
import re
import sys
import copy

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, 'data', 'materials.json')
TEX_DIR = os.path.join(ROOT, 'data', 'textures')
MAX_SIDE = 1024          # больше для повторяющегося рисунка не нужно (см. задание)
JPEG_QUALITY = 82
EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp')

_TR = {'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z',
       'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
       'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
       'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'}


def slug(name):
    """Имя файла в ascii — чтобы путь в браузере не зависел от кодировки."""
    s = ''.join(_TR.get(ch, ch if (ch.isascii() and ch.isalnum()) else ' ') for ch in str(name).lower())
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')[:40] or 'texture'


def norm(s):
    """Нестрогое сравнение имён: без регистра, знаков и «ё»."""
    s = str(s or '').lower().replace('ё', 'е')
    return re.sub(r'[^0-9a-zа-я]+', '', s)


def load():
    with open(DST, encoding='utf-8') as f:
        return json.load(f)


def all_materials(data):
    """Все материалы каталога: (поверхность, производитель, запись цвета)."""
    for surf in ('korpus', 'fasad', 'fill'):
        for prod in data.get(surf, {}).get('producers', []):
            for c in prod.get('colors', []):
                yield surf, prod, c


# Слово-тип в начале имени можно и писать, и опускать: «ЛДСП Белый альпийский» найдётся файлом
# «Белый альпийский.jpg» и наоборот. Только известные типы — чтобы не отрезать «Дуб» у «Дуб Сонома».
KIND_WORDS = ('лдсп', 'мдф', 'дсп', 'хдф', 'массив', 'фанера', 'стекло', 'зеркало', 'пластик')


def material_keys(c):
    """Варианты имени материала, по которым ищем файл (правило Б)."""
    name = str(c.get('name') or '').strip()
    kind = str(c.get('kind') or '').strip()
    variants = {name}
    if kind:
        variants.add(kind + ' ' + name)
        if name.lower().startswith(kind.lower()):
            variants.add(name[len(kind):].strip())
    # у старых записей тип ещё внутри имени («ЛДСП Белый альпийский») — вариант без него
    low = name.lower()
    for kw in KIND_WORDS:
        if low.startswith(kw + ' '):
            variants.add(name[len(kw):].strip())
            break
    return {norm(v) for v in variants if norm(v)}


SRC_SUBDIR = 'Текстуры'   # рабочая папка пользователя для исходных картинок (рядом с батником)


def has_images(path):
    return bool(path) and os.path.isdir(path) and any(
        f.lower().endswith(EXTS) for f in os.listdir(path))


def pick_folder(initial=None):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
        path = filedialog.askdirectory(title='Папка с подготовленными текстурами',
                                       initialdir=initial if initial and os.path.isdir(initial) else None)
        root.destroy()
        return path or None
    except Exception as e:
        print(f'Не открылось окно выбора папки ({e}).')
        print('Положите картинки в папку «Текстуры» рядом с батником — тогда окно не нужно.')
        return None


def prepare(src, dst):
    """Проверить → сжать → сохранить. Возвращает (ok, сообщение)."""
    try:
        from PIL import Image
    except ImportError:
        return False, 'нет библиотеки Pillow (установите: python -m pip install Pillow)'
    try:
        im = Image.open(src)
        im.load()
        w, h = im.size
        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')
        note = f'{w}×{h}'
        if max(w, h) > MAX_SIDE:
            k = MAX_SIDE / max(w, h)
            im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
            note += f' → {im.size[0]}×{im.size[1]}'
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        return True, note + f', {os.path.getsize(dst) // 1024} КБ'
    except Exception as e:
        return False, f'не читается как картинка ({e})'


def main():
    args = sys.argv[1:]
    dry = '--dry' in args
    src_dir = None
    if '--from' in args:
        i = args.index('--from')
        src_dir = args[i + 1] if len(args) > i + 1 else None
    # --dir <папка Config> — батник передаёт свою папку (как «--dir» у выгрузок). Рабочее место
    # для картинок — `Config\Текстуры`: если они уже там, берём их молча и НЕ открываем окно.
    # Имя подпапки держим здесь, а не в батнике: кириллица в .bat ломается о кодировку консоли.
    default_dir = None
    if '--dir' in args:
        i = args.index('--dir')
        base = args[i + 1] if len(args) > i + 1 else None
        if base:
            sub = os.path.join(base, SRC_SUBDIR)
            default_dir = sub if (has_images(sub) or not has_images(base)) else base
    if not src_dir and has_images(default_dir):
        src_dir = default_dir
        print(f'Беру текстуры из папки: {src_dir}')
    if not src_dir:
        if default_dir and os.path.isdir(default_dir):
            print(f'В папке «{default_dir}» картинок нет — выберите папку в открывшемся окне.')
        src_dir = pick_folder(default_dir)
    if not src_dir or not os.path.isdir(src_dir):
        print('Отменено — папка с текстурами не выбрана.')
        return 1

    files = [f for f in sorted(os.listdir(src_dir))
             if os.path.splitext(f)[1].lower() in EXTS and os.path.isfile(os.path.join(src_dir, f))]
    if not files:
        print(f'В папке нет картинок ({", ".join(EXTS)}): {src_dir}')
        return 1

    original = load()
    data = copy.deepcopy(original)
    by_stem = {norm(os.path.splitext(f)[0]): f for f in files}   # нормализованное имя файла → файл

    used, bound_a, bound_b, copied, errors, no_tex = set(), 0, 0, [], [], []
    prepared = {}   # исходный файл → готовое имя (один материал лежит в 3 поверхностях — готовим раз)

    for surf, prod, c in all_materials(data):
        chosen = None
        rule = ''
        # (А) колонка «Файл текстуры» уже заполнена — ищем такой файл
        col = str(c.get('texture') or '').strip()
        if col:
            stem = norm(os.path.splitext(os.path.basename(col.replace('\\', '/')))[0])
            if stem in by_stem:
                chosen, rule = by_stem[stem], 'А'
        # (Б) имя файла = название материала
        if not chosen:
            for k in material_keys(c):
                if k in by_stem:
                    chosen, rule = by_stem[k], 'Б'
                    break
        if not chosen:
            no_tex.append(f"{prod['name']} · {c.get('kind','')} {c.get('name','')}".strip())
            continue

        used.add(chosen)
        target_name = slug(os.path.splitext(chosen)[0]) + '.jpg'
        if chosen not in prepared:
            src = os.path.join(src_dir, chosen)
            dst = os.path.join(TEX_DIR, target_name)
            if dry:
                copied.append(f'{chosen} → data/textures/{target_name} (правило {rule})')
            else:
                ok, note = prepare(src, dst)
                if ok:
                    copied.append(f'{chosen} → {target_name} ({note}, правило {rule})')
                else:
                    errors.append(f'{chosen}: {note}')
                    continue
            prepared[chosen] = target_name
        c['texture'] = prepared[chosen]
        if rule == 'А':
            bound_a += 1
        else:
            bound_b += 1

    if errors:
        print('ОШИБКИ — ничего не записано:')
        for e in errors:
            print('  • ' + e)
        return 1

    print(f'Файлов в папке: {len(files)}; подготовлено: {len(copied)}')
    for line in copied[:40]:
        print('  • ' + line)
    print(f'Привязано к материалам: по колонке «Файл текстуры» — {bound_a}, по имени файла — {bound_b}')
    extra = [f for f in files if f not in used]
    if extra:
        print(f'Не пригодились (нет такого материала) — {len(extra)}:')
        for f in extra[:20]:
            print('  • ' + f)
    if no_tex:
        uniq = sorted(set(no_tex))
        print(f'Материалы БЕЗ текстуры — {len(uniq)} (впишите имя файла в колонку «Файл текстуры»):')
        for m in uniq[:20]:
            print('  • ' + m)

    if dry:
        print('\n(--dry: ничего не записано)')
        return 0

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
    print(f'\nГотово. Текстуры: data/textures, каталог обновлён (бэкап: {os.path.basename(DST)}.bak)')
    return 0


if __name__ == '__main__':
    code = main()
    if '--from' not in sys.argv:
        input('\nНажмите Enter, чтобы закрыть...')
    sys.exit(code)
