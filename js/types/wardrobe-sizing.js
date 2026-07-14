import { state, PANEL_THICKNESS } from '../core/state.js';
import { DOOR_DEPTH_ZONE, DOOR_OVERLAP, DOOR_MIN_W, DOOR_MAX_W, MESH_DEPTHS, VALET_LENGTHS, BASKET_WIDTHS, BASKET_DEPTHS_BY_WIDTH } from './wardrobe-constants.js';

// Хелперы размеров/цены: сколько места реально доступно под тот или иной элемент наполнения
// (ящик/сетка/вешало/корзина) при текущих габаритах шкафа, и балансировка ширины секций.
// Ничего не строит в 3D и не трогает коллизии между уже расставленными элементами (см.
// wardrobe-items.js) — эти два модуля сознательно разделены, geometry опирается на оба.

// Все допустимые варианты количества дверей купе для данного пролёта: ширина одной двери
// (пролёт + нахлёсты) / n должна попасть в конструктивный допуск 500–1100мм.
export function doorCountOptions(spanW) {
  const opts = [];
  for (let n = 2; n <= 10; n++) {
    const w = (spanW + (n - 1) * DOOR_OVERLAP) / n;
    if (w >= DOOR_MIN_W && w <= DOOR_MAX_W) opts.push({ n, w: Math.round(w) });
  }
  return opts;
}

// Количество дверей: выбор пользователя (state.doorCount, вкладка «Фасад»), если он допустим
// для текущего пролёта; иначе — авто: вариант с шириной двери, ближайшей к 800мм.
// Если допустимых вариантов нет вовсе (пролёт < 970мм — даже 2 двери уже дадут < 500мм),
// рисуем 2 двери: купе из одной двери не бывает, узость видна и продавцу, и клиенту.
export function getDoorCount(spanW) {
  const opts = doorCountOptions(spanW);
  if (opts.length === 0) return 2;
  if (state.doorCount && opts.some(o => o.n === state.doorCount)) return state.doorCount;
  return opts.reduce((best, o) => Math.abs(o.w - 800) < Math.abs(best.w - 800) ? o : best).n;
}

// Вычисляет ширину/высоту дверного пролёта с учётом стоек/крыши/коробов/планок.
// "планка" = та же толщина что и панель (пролёт не меняется относительно варианта "со стойкой").
// "короб" = занимает boxW/boxH из габарита изделия → пролёт уменьшается на размер короба.
// "ничего" (убрана без замены) → пролёт расширяется на толщину убранной панели.
// Выравнивающий элемент — планка у переднего края рядом со стойкой/крышей (та же толщина,
// что и панель, но шириной/высотой по умолчанию 50мм). Сдвигает стойку/крышу вглубь на свой
// размер, поэтому дверной пролёт (и цена) должны знать про него так же, как про планку/короб.
export function effectiveDoorSpan() {
  const { width, noSideLeft, noSideRight, noCeiling, noBottom,
          leftReplace, rightReplace, topReplace, bottomReplace,
          leftBoxW, rightBoxW, topBoxH, bottomBoxH,
          alignerLeft, alignerLeftW, alignerRight, alignerRightW, alignerTop, alignerTopH } = state;
  const t = PANEL_THICKNESS;

  function off(noPanel, replace, boxSize, alignerOn, alignerSize) {
    let base;
    if (!noPanel)                   base = t;     // панель на месте
    else if (replace === 'planka')  base = t;     // планка = та же толщина
    else if (replace === 'box')     base = boxSize;
    else                             base = 0;     // ничего
    return base + (alignerOn ? alignerSize : 0);
  }

  const leftOff   = off(noSideLeft,  leftReplace,   leftBoxW,   alignerLeft,  alignerLeftW);
  const rightOff  = off(noSideRight, rightReplace,  rightBoxW,  alignerRight, alignerRightW);
  const topOff    = off(noCeiling,   topReplace,    topBoxH,    alignerTop,   alignerTopH);
  const bottomOff = off(noBottom,    bottomReplace, bottomBoxH, false,        0);

  // Стойки/задняя стенка/перегородки/выравниватели/наполнение идут во всю глубину короба, а
  // планка/короб — только декоративная накладка в передней дверной зоне (см. drawSideElem).
  // Поэтому их размер должен знать только про РЕАЛЬНУЮ крышу/дно/стойку, а не про декоративную
  // замену — иначе они не дотягиваются до стены, хотя должны стоять вплотную к ней независимо
  // от замены. Дверной пролёт (spanW/leftOff/rightOff/topOff/bottomOff) — отдельно, без изменений
  // (плаka намеренно не меняет ширину дверного проёма).
  const stojkaTopOff    = noCeiling  ? 0 : t + (alignerTop   ? alignerTopH   : 0);
  const stojkaBottomOff = noBottom   ? 0 : t;
  const stojkaLeftOff   = noSideLeft  ? 0 : t + (alignerLeft  ? alignerLeftW  : 0);
  const stojkaRightOff  = noSideRight ? 0 : t + (alignerRight ? alignerRightW : 0);

  return {
    spanW:     width - leftOff - rightOff,
    leftOff,
    rightOff,
    topOff,
    bottomOff,
    stojkaTopOff,
    stojkaBottomOff,
    stojkaLeftOff,
    stojkaRightOff,
    innerSpanW: width - stojkaLeftOff - stojkaRightOff,
  };
}

// Секции наполнения имеют произвольную ширину, но сумма их ширин + перегородки между ними
// обязана совпадать с реальной внутренней шириной короба (effectiveDoorSpan().innerSpanW —
// доходит до стены независимо от планки/короба, в отличие от дверного пролёта spanW). Эта
// функция восстанавливает баланс после любого изменения, которое сдвигает границы короба
// (ширина изделия, стойки/выравниватели) или состав секций (добавили/убрали секцию).
// editedIndex — если пользователь только что руками поправил ширину одной секции, её значение
// не трогаем, остальные пропорционально ужимаются/растягиваются под освободившееся место.
// Секции с корзинами (есть хотя бы одна в sec.items) — ширина у них ЗАФИКСИРОВАНА всегда, даже
// когда они не editedIndex: корзина завязана на конкретный проём (basketFits), и любое
// авто-сжатие/растяжение от соседних действий (добавили секцию, изменили ширину другой секции)
// немедленно ломало бы её (см. basketFits) — гуляет только ширина секций БЕЗ корзин.
// Дополнительно секцию можно зафиксировать вручную галочкой (sec.widthLocked) даже без корзины —
// тот же эффект.
export const MIN_SECTION_WIDTH = 150;
export function isSectionWidthLocked(sec) { return sec.items.some(it => it.type === 'basket') || sec.widthLocked; }

export function rebalanceSections(editedIndex = null) {
  const sections = state.sections;
  const n = sections.length;
  if (n === 0) return;
  const t = PANEL_THICKNESS;
  const { innerSpanW } = effectiveDoorSpan();
  const available = innerSpanW - (n - 1) * t;

  if (n === 1) { sections[0].width = available; return; }

  if (editedIndex !== null) {
    const maxForEdited = available - (n - 1) * MIN_SECTION_WIDTH;
    sections[editedIndex].width = Math.min(Math.max(sections[editedIndex].width, MIN_SECTION_WIDTH), maxForEdited);
  }

  const fixedIdx = new Set(editedIndex !== null ? [editedIndex] : []);
  sections.forEach((sec, i) => { if (isSectionWidthLocked(sec)) fixedIdx.add(i); });

  const otherIdx = sections.map((_, i) => i).filter(i => !fixedIdx.has(i));
  // Если гулять уже нечему (все секции зафиксированы — либо editedIndex, либо корзины везде) —
  // подгонять нечего, оставляем ширины как есть (сумма может разойтись с available, это уже
  // ловит basketFits/toast на стороне UI при попытке действия, вызвавшего этот случай).
  if (otherIdx.length === 0) return;

  const fixedW = [...fixedIdx].reduce((s, i) => s + sections[i].width, 0);
  const remaining = Math.max(otherIdx.length * MIN_SECTION_WIDTH, available - fixedW);
  const otherTotal = otherIdx.reduce((s, i) => s + sections[i].width, 0);

  otherIdx.forEach(i => {
    // если у всех «остальных» секций ширина 0 (например, только что собраны из пресета) —
    // делим доступное место поровну, иначе доля 0/0 обнулила бы всех, кроме последней
    const share = otherTotal > 0 ? sections[i].width / otherTotal : 1 / otherIdx.length;
    sections[i].width = Math.max(MIN_SECTION_WIDTH, Math.round(remaining * share));
  });

  // компенсируем накопленное округление (и подъём до MIN_SECTION_WIDTH там, где доля вышла
  // меньше минимума), чтобы сумма ширин точно совпала с available. Раньше остаток всегда
  // добавлялся в ПОСЛЕДНЮЮ гибкую секцию — если это была только что добавленная минимальная
  // секция (150мм), отрицательный остаток от чужого подъёма до минимума мог увести её ниже
  // MIN_SECTION_WIDTH. Теперь остаток забирает секция с наибольшим запасом ширины — там разница
  // в несколько мм не может пробить минимум.
  const total = sections.reduce((s, sec) => s + sec.width, 0);
  const diff = available - total;
  if (diff !== 0) {
    const target = otherIdx.reduce((best, i) => sections[i].width > sections[best].width ? i : best, otherIdx[0]);
    sections[target].width = Math.max(MIN_SECTION_WIDTH, sections[target].width + diff);
  }
}

// Можно ли сейчас добавить ещё одну секцию: у зафиксированных секций (корзина или ручная
// галочка) ширина не меняется (см. выше), поэтому под новую секцию должно хватить места
// ТОЛЬКО за счёт "свободных" секций — каждой из них (и старым, и новой) нужно хотя бы
// MIN_SECTION_WIDTH.
export function canAddSection() {
  const sections = state.sections;
  const t = PANEL_THICKNESS;
  const { innerSpanW } = effectiveDoorSpan();
  const newN = sections.length + 1;
  const availableNew = innerSpanW - (newN - 1) * t;
  const lockedTotal = sections.reduce((s, sec) => s + (isSectionWidthLocked(sec) ? sec.width : 0), 0);
  const flexibleCount = sections.filter(sec => !isSectionWidthLocked(sec)).length + 1; // +1 — новая секция
  return availableNew - lockedTotal >= flexibleCount * MIN_SECTION_WIDTH;
}

// Можно ли удалить секцию idx: освободившуюся от неё ширину должна забрать хотя бы одна
// НЕзафиксированная секция среди оставшихся (rebalanceSections умеет двигать только их — см.
// otherIdx.length === 0 там же). Если после удаления все оставшиеся секции окажутся
// зафиксированы (корзиной или галочкой), место останется "дырой" — так что удалять нельзя.
export function canRemoveSection(idx) {
  const sections = state.sections;
  if (sections.length <= 1) return false;
  return sections.some((sec, i) => i !== idx && !isSectionWidthLocked(sec));
}

// Направляющие ящика/корзины крепятся к тому, что реально стоит по обе стороны секции — крайняя
// левая опирается на левую боковую стойку короба, крайняя правая — на правую, а любая другая
// (и вообще каждая секция со стороны соседней секции) — на перегородку между секциями, которая
// строится всегда, независимо от noSideLeft/noSideRight (см. buildWardrobeBox). Поэтому "нет
// боковой стойки" физически мешает крепежу ТОЛЬКО в САМОЙ КРАЙНЕЙ секции с той стороны, где
// стойку убрали — не во всех секциях сразу, как было раньше.
export function sectionMissingSideSupport(sections, idx) {
  const isFirst = idx === 0;
  const isLast = idx === sections.length - 1;
  return (isFirst && state.noSideLeft) || (isLast && state.noSideRight);
}

// Габариты короба ящика (дно/боковины/задняя стенка) — чуть меньше фасада (10мм с каждой
// стороны по ширине/высоте), а глубина ограничена, чтобы не вылезти за заднюю стенку короба
// шкафа. Вынесено отдельно, т.к. одна и та же формула нужна и в геометрии, и в расчёте площади.
export function drawerBoxSize(sw, dh, drawerDepth, depth) {
  const t = PANEL_THICKNESS;
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  // Ящик анкерится от фасада (переда), не от задней стенки — поэтому саму его позицию двигать
  // не нужно, достаточно урезать максимально допустимую глубину на толщину задней стенки, если
  // она есть (иначе короб дотягивался бы до самой стенки и протыкал её насквозь).
  const boxDepthMax = Math.max(100, frontZ - t + depth / 2 - backWallClearance());
  return { boxW: sw - 20, boxH: dh - 20, boxDepth: Math.min(drawerDepth, boxDepthMax) };
}

// Максимальная глубина короба ящика, которую можно выбрать в UI: реальный физический предел
// (см. drawerBoxSize) минус обязательный запас 10мм от задней стенки, округлённый вниз до 50мм —
// так пользователь не может ввести значение, которое физически не влезет. Всегда в границах
// 250-600: если короб мельче — потолок снижается до влезающего (но не ниже 250), если короб
// глубже — потолок всё равно не растёт выше 600.
export function maxDrawerDepth(depth) {
  const t = PANEL_THICKNESS;
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  const physicalMax = frontZ - t + depth / 2 - backWallClearance();
  const rounded = Math.floor((physicalMax - 10) / 50) * 50;
  return Math.min(600, Math.max(250, rounded));
}

export function availableMeshDepths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE - backWallClearance();
  return MESH_DEPTHS.filter(d => d <= innerDepth);
}

// Толщина самой задней стенки (ЛДСП — та же панель, что и корпус, ХДФ — тонкая накладка, см.
// wardrobe-geometry.js). Если стенка есть, она физически занимает часть глубины короба у спинки —
// рабочая глубина под направляющие ящиков/корзин/вешала (и сетчатой полки) должна уменьшаться
// на эту толщину, иначе они визуально протыкают заднюю стенку насквозь (backZ = -depth/2 у этих
// элементов совпадает с местом, где рисуется стенка). Без стенки ('none') — 0.
export const HDF_THICKNESS = 4;
export function backWallClearance() {
  if (state.backWall === 'ldsp') return PANEL_THICKNESS;
  if (state.backWall === 'hdf') return HDF_THICKNESS;
  return 0;
}

// Если сзади стоит планка жёсткости (не ЛДСП задняя стенка), крепление вешала не может занимать
// её место — глубина, доступная под вешало, уменьшается на 16мм (толщина панели/запас). Это
// ОТДЕЛЬНО от backWallClearance() (толщина самой стенки) — жёсткость висит у верхней полки
// (см. STIFFENER_HEIGHT в wardrobe-geometry.js), а не по всей высоте секции, но обе величины
// отнимают место по глубине в одной и той же задней зоне, поэтому вешало учитывает и то, и другое.
export function valetBackClearance() {
  return state.backWall !== 'ldsp' ? PANEL_THICKNESS : 0;
}

export function availableValetLengths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  return VALET_LENGTHS.filter(v => v <= innerDepth - valetBackClearance() - backWallClearance());
}

// Сетчатые корзины — реальный типоразмерный ряд (не параметрический): ширина (поперёк секции)
// жёстко определяет набор допустимых глубин (в шкаф) и обязательный проём (реальную ширину
// секции) = ширина + 23мм (зазор под направляющие каждой стороны). Если ширина секции не равна
// этому значению — корзина физически не встанет, включать её нельзя.
export const BASKET_HEIGHTS = [120, 190];
export const BASKET_PROYOM_GAP = 23; // обязательный проём = basketWidth + этот зазор

export function requiredBasketProyom(basketWidth) {
  return basketWidth + BASKET_PROYOM_GAP;
}

export function basketFits(sec) {
  return Math.round(sec.width) === requiredBasketProyom(sec.basketWidth);
}

export function availableBasketDepths(basketWidth, cabinetDepth) {
  const innerDepth = cabinetDepth - DOOR_DEPTH_ZONE - backWallClearance();
  return (BASKET_DEPTHS_BY_WIDTH[basketWidth] || []).filter(d => d <= innerDepth);
}

// Плоский список всех валидных сочетаний ширина/глубина/высота корзины при текущей глубине
// шкафа — используется для одного select'а «размер корзины» в UI (вместо трёх раздельных полей).
export function basketSizeOptions(cabinetDepth) {
  const opts = [];
  BASKET_WIDTHS.forEach(w => {
    availableBasketDepths(w, cabinetDepth).forEach(d => {
      BASKET_HEIGHTS.forEach(h => opts.push({ w, d, h }));
    });
  });
  return opts;
}
