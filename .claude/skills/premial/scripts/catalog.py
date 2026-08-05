#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Доступ к техническому каталогу Premial Aluminium Systems 2026.

Шрифты в этом PDF встроены подмножествами без ToUnicode, поэтому обычное
извлечение текста даёт нечитаемую кашу, а цифры теряются совсем (попадают в
управляющие символы). Здесь разобранная кодировка: pdfplumber выдаёт сырые CID,
а порядок глифов в шрифте — сплошной блок кириллицы плюс сдвинутый ASCII.

Команды:
    text [страницы]     разобранный текст (по умолчанию весь каталог)
    render <стр> [масштаб]  отрисовать страницу в PNG — для чертежей, сечений,
                            схем присадки: они векторные и текстом не читаются
    matrix <стр>        восстановить таблицу соответствия декоров (точки в них —
                            векторные кружки, а не символы)

Страницы задаются номерами PDF; страница PDF = страница каталога + 2.
Диапазоны через дефис, перечисление через запятую: 13-15,18

Зависимости: pdfplumber, pypdfium2 (только для render).
"""
import os
import re
import sys

CID_RE = re.compile(r'^\(cid:(\d+)\)$')

# Отдельные глифы, выпадающие из основных диапазонов.
EXTRA = {3: ' ', 154: '–', 343: '•', 490: 'ё', 514: '–', 543: '№', 562: '≥', 918: 'I'}

DEFAULT_NAMES = ['Premial-Aluminium-Systems-Технический-каталог-2026.pdf']


def find_pdf():
    """Каталог лежит в материалах на Яндекс.Диске, вне репозитория."""
    env = os.environ.get('PREMIAL_CATALOG')
    if env and os.path.isfile(env):
        return env
    roots = [
        os.path.expanduser(r'~/YandexDisk/Config/Ассортимент/купе'),
        os.path.expanduser(r'~/Yandex.Disk/Config/Ассортимент/купе'),
        os.path.expanduser(r'~/YandexDisk/Config/Ассортимент'),
    ]
    for root in roots:
        for name in DEFAULT_NAMES:
            path = os.path.join(root, name)
            if os.path.isfile(path):
                return path
    sys.exit(
        'Каталог не найден. Укажи путь через переменную окружения '
        'PREMIAL_CATALOG или подключи папку материалов через /add-dir.'
    )


def decode_cid(n):
    if n in EXTRA:
        return EXTRA[n]
    if 426 <= n <= 457:            # А..Я
        return chr(0x410 + n - 426)
    if 458 <= n <= 489:            # а..я
        return chr(0x430 + n - 458)
    if 4 <= n <= 130:              # ASCII со сдвигом -0x1D
        return chr(n + 0x1D)
    return '�[%d]' % n


def fix(ch):
    """Заменяет символ на настоящий. Часть шрифтов на странице нормальные —
    их символы приходят как есть и трогать их нельзя."""
    t = ch['text']
    m = CID_RE.match(t)
    if m:
        ch['text'] = decode_cid(int(m.group(1)))
    elif len(t) == 1 and 0x03 <= ord(t) <= 0x1F:
        ch['text'] = chr(ord(t) + 0x1D)
    return ch


def parse_pages(spec, total):
    if not spec:
        return list(range(1, total + 1))
    out = []
    for part in spec.split(','):
        if '-' in part:
            a, b = part.split('-')
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [p for p in out if 1 <= p <= total]


def cmd_text(spec):
    import pdfplumber
    from pdfplumber.utils import extract_text
    with pdfplumber.open(find_pdf()) as pdf:
        for pageno in parse_pages(spec, len(pdf.pages)):
            pg = pdf.pages[pageno - 1]
            chars = [fix(dict(c)) for c in pg.chars]
            txt = extract_text(chars, layout=True) if chars else ''
            txt = '\n'.join(l.rstrip() for l in txt.split('\n'))
            txt = re.sub(r'\n{3,}', '\n\n', txt).strip()
            print('=== PDF %d (каталог %d) ===' % (pageno, pageno - 2))
            print(txt)
            print()


def cmd_render(pageno, scale=2.0, out=None):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(find_pdf())
    out = out or 'premial-p%d.png' % pageno
    doc[pageno - 1].render(scale=scale).to_pil().save(out)
    print(out)


def cluster(vals, tol):
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def cmd_matrix(pageno):
    """Точки доступности — маленькие серые кружки в векторе. Собираем их в сетку
    и подписываем ближайшим текстом слева и сверху.

    Подписи колонок собираются грубо (в них попадает соседний текст страницы), а
    на страницах с чертежами в выборку лезут точки самих чертежей. Результат —
    черновик: сверь его с `render` той же страницы, прежде чем куда-то заносить.
    """
    import pdfplumber
    from pdfplumber.utils import extract_words
    with pdfplumber.open(find_pdf()) as pdf:
        pg = pdf.pages[pageno - 1]
        dots = []
        for o in pg.curves:
            w, h = o['x1'] - o['x0'], o['y1'] - o['y0']
            if 3 < w < 9 and 3 < h < 9 and abs(w - h) < 1:
                dots.append(((o['x0'] + o['x1']) / 2, (o['top'] + o['bottom']) / 2))
        if not dots:
            print('точек не найдено — вероятно, на этой странице нет такой таблицы')
            return
        cols = cluster([x for x, _ in dots], 8)
        rows = cluster([y for _, y in dots], 6)
        words = extract_words([fix(dict(c)) for c in pg.chars])
        left, top = min(cols) - 12, min(rows) - 8
        print('PDF %d (каталог %d): %d точек, %d колонок, %d строк'
              % (pageno, pageno - 2, len(dots), len(cols), len(rows)))
        for i, cx in enumerate(cols):
            hdr = [w['text'] for w in words
                   if w['bottom'] < top and abs((w['x0'] + w['x1']) / 2 - cx) < 22]
            print('  col%-2d x=%3.0f : %s' % (i, cx, ' '.join(hdr[-6:])))
        for ry in rows:
            label = [w['text'] for w in words
                     if w['x1'] < left and abs((w['top'] + w['bottom']) / 2 - ry) < 9]
            marks = ['+' if any(abs(x - cx) < 6 and abs(y - ry) < 6 for x, y in dots)
                     else '.' for cx in cols]
            print('  %-34s %s' % (' '.join(label), ' '.join(marks)))


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd, rest = args[0], args[1:]
    if cmd == 'text':
        cmd_text(rest[0] if rest else None)
    elif cmd == 'render':
        cmd_render(int(rest[0]), float(rest[1]) if len(rest) > 1 else 2.0,
                   rest[2] if len(rest) > 2 else None)
    elif cmd == 'matrix':
        cmd_matrix(int(rest[0]))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
