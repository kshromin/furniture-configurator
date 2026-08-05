// Двери-купе: паспорта профилей и расчёт размеров по техкаталогу PML 2026.
//
// ЕДИНЫЙ ИСТОЧНИК ЧИСЕЛ. Все вычеты, прибавки и пределы лежат здесь и только здесь —
// в остальном коде не должно быть литералов вида «- 40» или «+ 30» применительно к
// дверям. Каждое число подписано страницей каталога, чтобы его можно было проверить
// (`.claude/skills/premial/` — разбор каталога, `references/raschet-dverey.md` — вывод
// формул; исходный PDF читается скриптом skills/premial/scripts/catalog.py).
//
// Пять профилей конфигуратора — это ТРИ РАЗНЫЕ системы с разными формулами и разными
// предельными размерами. Общего множителя у них нет, поэтому таблица, а не константа.
//
// Модуль намеренно чистый: без импортов из state/materials, без побочных эффектов.
// Его можно звать и из 3D-сборки, и из сметы, и из тестов. Все размеры — в мм.

// Идентификаторы совпадают с data-profile в index.html и state.profile:
// open | closed | slim | slimbox | widebox
export const DOOR_PROFILES = {
  open: {
    label: 'Открытый',
    catalog: 'Furnial Classic',
    system: 'Furnial',
    symmetric: false,
    faceWidth: 25,      // видимая часть профиля = ширина перекрытия дверей
    heightCut: 36,      // HD = HO - heightCut
    lphCut: 50,         // LPh = WD - lphCut
    railCut: 3,         // NL = WO - railCut
    fill: {             // HF = HD - h, WF = WD - w
      board:  { h: 56, w: 34 },   // ЛДСП / МДФ
      mirror: { h: 58, w: 36 },   // зеркало / стекло
    },
    limits: { minW: 550, maxW: 900, maxH: 2500, maxKg: 40, maxFillThickness: 10 },
    stock: { vertical: [4600, 4800, 5400], horizontal: [5900], rail: [5900] },
    divider: { tie: false, noTie: true },   // какие двусторонние профили есть у системы
    page: 22,
  },

  closed: {
    label: 'Закрытый',
    catalog: 'Furnial Omega',
    system: 'Furnial',
    symmetric: true,
    faceWidth: 31,
    heightCut: 36,
    lphCut: 62,
    railCut: 3,
    fill: {
      board:  { h: 56, w: 48 },
      mirror: { h: 58, w: 50 },
    },
    limits: { minW: 550, maxW: 900, maxH: 2500, maxKg: 40, maxFillThickness: 10 },
    stock: { vertical: [5400], horizontal: [5900], rail: [5900] },
    divider: { tie: false, noTie: true },
    page: 22,
  },

  // Fish и Cat считаются одинаково — отличаются только формой сечения и палитрой.
  slim: {
    label: 'Узкий',
    catalog: 'FISH',
    system: 'Elephant',
    symmetric: false,
    faceWidth: 13,
    heightCut: 40,
    lphCut: 25,
    railCut: 1,         // у Elephant направляющие WO - 1, а не WO - 3
    fill: {
      // У Elephant наполнение заходит в вертикальные профили почти во всю дверь,
      // а не сидит в рамке из горизонталей — отсюда вычеты 3-5 мм вместо 34-107.
      board:  { h: 3, w: 3 },
      mirror: { h: 5, w: 5 },
    },
    limits: { minW: 550, maxW: 1200, maxH: 2700, maxKg: 60, maxFillThickness: 10 },
    stock: { vertical: [5400], horizontal: [5900], rail: [5900] },
    divider: { tie: true, noTie: false },
    page: 29,
  },

  slimbox: {
    label: 'Узкий BOX',
    catalog: 'CAT',
    system: 'Elephant',
    symmetric: false,
    faceWidth: 13,
    heightCut: 40,
    lphCut: 25,
    railCut: 1,
    fill: {
      board:  { h: 3, w: 3 },
      mirror: { h: 5, w: 5 },
    },
    limits: { minW: 550, maxW: 1200, maxH: 2700, maxKg: 60, maxFillThickness: 10 },
    stock: { vertical: [5400], horizontal: [5900], rail: [5900] },
    divider: { tie: true, noTie: false },
    page: 29,
  },

  widebox: {
    label: 'Широкий BOX',
    catalog: 'П',
    system: 'Premial',
    symmetric: true,
    faceWidth: 60,
    heightCut: 40,
    lphCut: 120,
    railCut: 3,
    fill: {
      board:  { h: 58, w: 104 },
      mirror: { h: 61, w: 107 },
    },
    limits: { minW: 550, maxW: 1200, maxH: 2700, maxKg: 60, maxFillThickness: 10 },
    stock: { vertical: [5400], horizontal: [5900], rail: [5900] },
    divider: { tie: true, noTie: true },
    page: 13,
  },
};

export const DEFAULT_PROFILE = 'closed';

export function profileSpec(id) {
  return DOOR_PROFILES[id] || DOOR_PROFILES[DEFAULT_PROFILE];
}

// Ширина перекрытия соседних дверей. Заменяет прежнюю глобальную DOOR_OVERLAP = 30:
// у реальных профилей она от 13 (Elephant) до 60 (Premial П), то есть расходится
// с прежней константой в 2-4 раза, и от неё зависит ширина каждой двери.
export function doorOverlap(id) {
  return profileSpec(id).faceWidth;
}

// Количество мест перекрытия дверей (QO в каталоге). В классической раздвижной
// раскладке — где двери идут по очереди на переднюю и заднюю рельсу и каждая
// соседняя пара заходит внахлёст — это doorCount - 1. Именно такую раскладку строит
// buildDoorRow, поэтому она здесь и зашита. Схемы, где внутренние двери сходятся
// встык (Aluforce Adjust на 4 двери), дали бы меньше — если такие появятся,
// overlapCount надо будет передавать снаружи, а не считать тут.
export function overlapCount(doorCount) {
  return Math.max(0, doorCount - 1);
}

/**
 * Габарит одной двери и длины профилей на неё.
 *
 * openingW/openingH — проём (WO/HO), то есть тот же spanW, что уже считает
 * wardrobe-sizing. Возвращает нерокруглённые мм: округление — забота отображения,
 * в расчётах промежуточные округления копят ошибку.
 */
export function doorSizes({ profile, openingW, openingH, doorCount, overlaps }) {
  const p = profileSpec(profile);
  const qo = overlaps == null ? overlapCount(doorCount) : overlaps;

  const height = openingH - p.heightCut;                       // HD
  const width = (openingW + p.faceWidth * qo) / doorCount;     // WD

  return {
    width,
    height,
    verticalLen: height,          // LPv — вертикаль режется во всю высоту двери
    horizontalLen: width - p.lphCut,  // LPh — горизонтали встают между вертикалями
    railLen: openingW - p.railCut,    // NL — на весь шкаф, не на дверь
    overlaps: qo,
  };
}

/**
 * Размер вставки. material: 'board' (ЛДСП/МДФ) или 'mirror' (зеркало/стекло).
 * Считается от габарита двери, а не от проёма.
 *
 * Для двери с ОДНОЙ вставкой во всю высоту. Многосекционные (зеркало сверху,
 * ЛДСП снизу) каталог формулой не покрывает: сечения разделителей известны
 * (28 мм со стяжкой, 19.2 мм без), а глубина посадки наполнения в паз — нет.
 * См. splitFillHeights ниже.
 */
export function fillSizes({ profile, doorWidth, doorHeight, material = 'board' }) {
  const p = profileSpec(profile);
  const cut = p.fill[material] || p.fill.board;
  return { width: doorWidth - cut.w, height: doorHeight - cut.h };
}

// Сечения двусторонних (разделительных) профилей, каталог стр. 9.
export const DIVIDERS = {
  tie:   { label: 'со стяжкой', section: 28, groove: 10.1 },
  noTie: { label: 'без стяжки', section: 19.2, groove: 10.1 },
};

/**
 * Высоты вставок для двери с разделителями.
 *
 * ВНИМАНИЕ: `eaten` — сколько высоты съедает один разделитель — в каталоге НЕ ДАНО.
 * Вывести его из сечения нельзя, не зная глубины посадки наполнения в паз. Его надо
 * один раз замерить на пробной двери, после чего он станет константой здесь.
 * Пока не замерено — функция возвращает null, чтобы вызывающий код показал
 * «уточняется», а не выдал правдоподобное, но выдуманное число.
 */
export function splitFillHeights({ profile, doorHeight, sections, material = 'board', eaten = null }) {
  if (eaten == null || sections < 2) return null;
  const p = profileSpec(profile);
  const total = doorHeight - p.fill[material].h - eaten * (sections - 1);
  return Array.from({ length: sections }, () => total / sections);
}

// Длина разделителя. Для систем Felix, где стоит тот же двусторонний профиль Premial,
// каталог задаёт LMh = LPh + 2. Для Furnial/Elephant/Premial такой формулы нет —
// значение обоснованное, но не подтверждённое, поэтому вынесено отдельным флагом.
export const DIVIDER_LEN_DELTA = 2;
export const DIVIDER_LEN_CONFIRMED = false;

export function dividerLen(horizontalLen) {
  return horizontalLen + DIVIDER_LEN_DELTA;
}

/**
 * Проверка габаритов двери против паспорта системы.
 * Проверять можно только ПОСЛЕ расчёта: лимит стоит на дверь, а не на долю проёма.
 * Возвращает массив проблем (пустой = всё в допуске) — вызывающий решает, показать
 * их предупреждением или заблокировать вариант.
 */
export function limitIssues({ profile, doorWidth, doorHeight }) {
  const p = profileSpec(profile), L = p.limits, out = [];
  if (doorWidth > L.maxW) out.push({ field: 'width', kind: 'max', limit: L.maxW, value: doorWidth,
    text: `Ширина двери ${Math.round(doorWidth)} мм больше допустимых ${L.maxW} мм для профиля «${p.label}» (${p.system}) — добавьте дверь` });
  if (doorWidth < L.minW) out.push({ field: 'width', kind: 'min', limit: L.minW, value: doorWidth,
    text: `Ширина двери ${Math.round(doorWidth)} мм меньше допустимых ${L.minW} мм для профиля «${p.label}» — уберите дверь` });
  if (doorHeight > L.maxH) out.push({ field: 'height', kind: 'max', limit: L.maxH, value: doorHeight,
    text: `Высота двери ${Math.round(doorHeight)} мм больше допустимых ${L.maxH} мм для профиля «${p.label}» (${p.system})` });
  return out;
}

// Сколько дверей укладывается в проём по габаритам выбранного профиля.
// Заменяет прежние глобальные DOOR_MIN_W/DOOR_MAX_W = 500/1100, одинаковые для всех:
// у Furnial реальный коридор 550-900, у Elephant и Premial 550-1200.
export function doorCountOptionsFor(profile, openingW, maxDoors = 6) {
  const out = [];
  for (let n = 1; n <= maxDoors; n++) {
    const w = doorSizes({ profile, openingW, openingH: 2500, doorCount: n }).width;
    const L = profileSpec(profile).limits;
    if (w >= L.minW && w <= L.maxW) out.push({ n, w });
  }
  return out;
}

/**
 * Раскрой: сколько палок профиля нужно. Профиль продаётся хлыстами фиксированной
 * длины, поэтому считается делением с округлением вверх, а не метражом.
 * Припуск на рез каталог не закладывает — kerf задаётся снаружи, если нужен.
 */
export function stockBars({ pieceLen, pieces, barLen, kerf = 0 }) {
  const perBar = Math.floor(barLen / (pieceLen + kerf));
  if (perBar < 1) return { bars: Infinity, perBar: 0, fits: false };
  return { bars: Math.ceil(pieces / perBar), perBar, fits: true };
}

/**
 * Полная сводка на дверной ряд: габарит двери, наполнение, длины и расход профиля.
 * Это та функция, которую стоит звать из UI и из сметы, чтобы не собирать цепочку
 * вручную в каждом месте.
 */
export function doorRowSummary({ profile, openingW, openingH, doorCount, material = 'board', overlaps }) {
  const p = profileSpec(profile);
  const d = doorSizes({ profile, openingW, openingH, doorCount, overlaps });
  const fill = fillSizes({ profile, doorWidth: d.width, doorHeight: d.height, material });

  return {
    profile: { id: profile, label: p.label, catalog: p.catalog, system: p.system },
    door: d,
    fill,
    issues: limitIssues({ profile, doorWidth: d.width, doorHeight: d.height }),
    cuts: {
      vertical:   { len: d.verticalLen,   count: doorCount * 2 },
      horizontal: { len: d.horizontalLen, count: doorCount * 2 },
      railTop:    { len: d.railLen,       count: 1 },
      railBottom: { len: d.railLen,       count: 1 },
    },
    bars: {
      vertical:   stockBars({ pieceLen: d.verticalLen,   pieces: doorCount * 2, barLen: p.stock.vertical[p.stock.vertical.length - 1] }),
      horizontal: stockBars({ pieceLen: d.horizontalLen, pieces: doorCount * 2, barLen: p.stock.horizontal[0] }),
    },
  };
}
