import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';

export function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

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
// Секции с корзинами (sec.baskets > 0) — ширина у них ЗАФИКСИРОВАНА всегда, даже когда они не
// editedIndex: корзина завязана на конкретный проём (basketFits), и любое авто-сжатие/растяжение
// от соседних действий (добавили секцию, изменили ширину другой секции) немедленно ломало бы её
// (см. basketFits) — гуляет только ширина секций БЕЗ корзин. Дополнительно секцию можно
// зафиксировать вручную галочкой (sec.widthLocked) даже без корзины — тот же эффект.
export const MIN_SECTION_WIDTH = 150;
export function isSectionWidthLocked(sec) { return sec.baskets > 0 || sec.widthLocked; }

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

// Двери купе едут по рельсам, вынесенным в переднюю зону короба (как у Командор) —
// это съедает часть глубины у наполнения, но не у самого короба (короб — на полную глубину).
export const DOOR_DEPTH_ZONE = 90;
// Соседние двери заходят друг на друга внахлёст, чтобы не было щели; крайние двери при
// этом не вылезают наружу — весь ряд идёт строго от стойки до стойки (см. buildSlidingDoors).
export const DOOR_OVERLAP = 30;

// Рамка двери купе — по умолчанию серебристый алюминиевый профиль; сама дверь на 90мм
// зоны глубины (ширину/глубину рамки и цвет вынесем в настройки, когда дойдём до этого).
export const DOOR_FRAME_WIDTH = 40; // видимая ширина профиля по периметру
export const DOOR_FRAME_DEPTH = 40; // толщина рамки (она же — толщина двери по Z)
const DOOR_FRAME_COLOR = 0xc4c4c8;
const RAIL_COLOR = 0xb0b0b4;
export const TOP_RAIL_HEIGHT = 50;
export const BOTTOM_RAIL_HEIGHT = 10;

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

// Дефолтная структура наполнения секции: верхняя полка не настраивается, просто задаёт верхнюю
// границу зоны для доп. полок/штанги. sec.shelves (state.sections[i]) — экспериментальная
// объединённая модель остальных полок, см. комментарий в state.js.
export const TOP_SHELF_GAP = 550;    // от верхней границы наполнения до верхней полки
export const BOTTOM_SHELF_GAP = 250; // от нижней границы наполнения до нижней полки
export const ROD_BELOW_TOP_SHELF = 70; // штанга №1 — на столько ниже верхней полки
// Жёсткость — вертикальная пластина, свисающая вниз от полки (перпендикулярно ей, не лежит
// плашмя как полка), стоит в плоскости задней стенки. STIFFENER_THICKNESS — тонкий размер
// пластины (вдоль глубины, впритык к задней стенке), STIFFENER_HEIGHT — на сколько свисает вниз.
export const STIFFENER_THICKNESS = 10;
export const STIFFENER_HEIGHT = 100;
const ROD_COLOR = 0xc0c0c0; // хром
const ROD_RADIUS = 12.5; // диаметр штанги 25мм
const MIN_ZONE_GAP = 200; // страховка для низких секций, чтобы полки не пересеклись

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

// Сетчатые полки — независимое от ящиков поле, тоже строятся снизу вверх (максимум 3шт),
// но ширина всегда во всю секцию (как обычная полка), а фиксированный выбор глубины (300/400/500мм)
// ограничен реальной доступной глубиной наполнения (innerDepth = глубина короба − дверная зона
// − толщина задней стенки, если она есть, см. backWallClearance).
export const MESH_DEPTHS = [300, 400, 500];
export const MESH_THICKNESS = 20; // высота силовых прутков
export const MESH_PITCH = 300;    // шаг между соседними сетчатыми полками (центр-центр)
const MESH_WIRE = 4;  // толщина частых прутков решётки
const MESH_WIRE_STEP = 25; // шаг частых прутков вдоль ШИРИНЫ (сами прутки идут вдоль глубины)
const MESH_LIP_HEIGHT = 35; // высота загиба переднего края

export function availableMeshDepths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE - backWallClearance();
  return MESH_DEPTHS.filter(d => d <= innerDepth);
}

// silver/white — исходно для сетчатой полки (2 цвета); black добавлен для корзин (3 цвета) —
// без явной ветки 'black' раньше проваливался в белую по умолчанию (белая проволока вместо чёрной).
function meshShelfMaterialProps(colorKey) {
  if (colorKey === 'silver') return { color: 0xc0c0c0, metalness: 0.7, roughness: 0.25 };
  if (colorKey === 'black')  return { color: 0x1c1c1c, metalness: 0.4, roughness: 0.35 };
  return { color: 0xf2f2f2, metalness: 0.05, roughness: 0.5 }; // white
}

// Торцевое вешало — выдвижная штанга-петля (см. mdm-complect.ru/catalog/shtangi/36654):
// телескопический рельс, крепится саморезами к самой верхней полке. valetLength — габарит
// ВСЕГО вешала целиком, включая кронштейны с обоих концов (как у реального товара) — прутки
// внутри короче на глубину кронштейна с каждого конца, но весь узел (кронштейн-кронштейн)
// укладывается ровно в заявленный размер и не вылезает за реальную доступную глубину.
// П-образный пруток (петля) тянется вдоль глубины. Показываем в выдвинутом положении.
export const VALET_LENGTHS = [250, 300, 350, 400, 450, 500, 550];
const VALET_LOOP_WIDTH = 60; // ширина петли штанги
const VALET_ROD_RADIUS = 4;
const VALET_COLOR = 0xc0c0c0;
const VALET_BRACKET_DEPTH = 20; // глубина кронштейна (совпадает с 'd' в addPanel ниже)

// Толщина самой задней стенки (ЛДСП — та же панель, что и корпус, ХДФ — тонкая накладка, см.
// buildWardrobeBox). Если стенка есть, она физически занимает часть глубины короба у спинки —
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
// (см. STIFFENER_HEIGHT), а не по всей высоте секции, но обе величины отнимают место по глубине
// в одной и той же задней зоне, поэтому вешало учитывает и то, и другое.
function valetBackClearance() {
  return state.backWall !== 'ldsp' ? PANEL_THICKNESS : 0;
}

export function availableValetLengths(depth) {
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  return VALET_LENGTHS.filter(v => v <= innerDepth - valetBackClearance() - backWallClearance());
}

// Общий клампинг фиксированных размеров (глубина ящика/сетки, длина вешала) под текущую
// глубину короба. Вызывается и из build() (чтобы геометрия не вылезала за реальные границы),
// и из renderSectionsList() (чтобы <select> в UI сразу показывал уже подрезанное значение —
// иначе браузер молча выбирает первый вариант списка, пока значение не совпадёт ни с одной
// опцией, и в поле показывается не то, что реально построено).
export function clampSectionSizes(sections, depth) {
  const maxDD = maxDrawerDepth(depth);
  const meshAvail = availableMeshDepths(depth);
  const valetAvail = availableValetLengths(depth);
  sections.forEach(sec => {
    if (sec.drawerDepth > maxDD) sec.drawerDepth = maxDD;
    // Если ни одна глубина сетчатой полки больше не влезает — подрезать нечего, гасим счётчик
    // (та же логика, что у корзины ниже); раньше молча падало на MESH_DEPTHS[0], хотя полка уже
    // не влезала — торчала наружу вместо того, чтобы исчезнуть.
    if (meshAvail.length) {
      if (!meshAvail.includes(sec.meshDepth)) sec.meshDepth = meshAvail[meshAvail.length - 1];
    } else {
      sec.meshDepth = MESH_DEPTHS[0];
      sec.meshShelves = 0;
    }
    // Аналогично для вешала — если ни один заявленный размер больше не влезает, гасим галочку.
    if (valetAvail.length) {
      if (!valetAvail.includes(sec.valetLength)) sec.valetLength = valetAvail[valetAvail.length - 1];
    } else {
      sec.valetLength = VALET_LENGTHS[0];
      sec.valet = 0;
    }
    if (!BASKET_WIDTHS.includes(sec.basketWidth)) sec.basketWidth = BASKET_WIDTHS[0];
    const basketDepthAvail = availableBasketDepths(sec.basketWidth, depth);
    if (basketDepthAvail.length) {
      // Шкаф стал мельче — уже построенная корзина подрезается до наибольшей ещё влезающей
      // глубины (та же логика, что и у глубины ящика — maxDrawerDepth/drawerDepth).
      if (!basketDepthAvail.includes(sec.basketDepth)) sec.basketDepth = basketDepthAvail[basketDepthAvail.length - 1];
    } else {
      // Ни один вариант глубины для этой ширины корзины больше не влезает в шкаф вообще —
      // подрезать нечего, корзина физически не влезет ни при какой доступной глубине.
      // Показываем в UI дефолтную глубину (первую из типоразмерного ряда), но гасим счётчик.
      sec.basketDepth = BASKET_DEPTHS_BY_WIDTH[sec.basketWidth][0];
      sec.baskets = 0;
    }
    // Тихая защита данных: если ширина секции разошлась с обязательным проёмом (например, из-за
    // ребаланса других секций), корзину включать нельзя — гасим счётчик без тоста (тост — только
    // при прямом действии пользователя, см. validateBasketFit и его вызовы в tabs.js).
    if (sec.baskets > 0 && !basketFits(sec)) sec.baskets = 0;
  });
}

// Сетчатые корзины — реальный типоразмерный ряд (не параметрический): ширина (поперёк секции)
// жёстко определяет набор допустимых глубин (в шкаф) и обязательный проём (реальную ширину
// секции) = ширина + 23мм (зазор под направляющие каждой стороны). Если ширина секции не равна
// этому значению — корзина физически не встанет, включать её нельзя.
export const BASKET_WIDTHS = [300, 400, 500];
export const BASKET_DEPTHS_BY_WIDTH = { 300: [400], 400: [400, 450, 500, 550, 600], 500: [500, 550, 600] };
export const BASKET_HEIGHTS = [120, 190];
export const BASKET_PROYOM_GAP = 23; // обязательный проём = basketWidth + этот зазор
export const BASKET_STACK_GAP = 20; // зазор по высоте между соседними корзинами в стопке (у ящиков — 4мм)
// Один общий шаг и для дна (в обе стороны — вдоль глубины и вдоль ширины), и для вертикальных
// стоек стенок — по просьбе пользователя дно чуть реже (было 25мм), а стойки чуть чаще
// (было 70мм), и то и другое сошлось к одному значению.
export const BASKET_WIRE_STEP = 35;
const BASKET_WIRE = 4;
export const BASKET_TAPER = 60; // на столько уже дно корзины, чем верх (трапеция), по ширине
const BASKET_MIN_BOTTOM_WIDTH = 150; // страховка от вырожденной геометрии при малой ширине
export const BASKET_RAIL_HEIGHT = 40; // направляющая — планка на стойке под дном корзины
export const BASKET_RAIL_WIDTH = 15;
const BASKET_RAIL_COLOR = 0xb0b0b4; // тот же металлик, что у дверных рельс/кронштейнов вешала
const BASKET_CLIP_HEIGHT = 10; // полосы, соединяющие корзину со стойкой/направляющей
const BASKET_CLIP_DEPTH = 20;

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

// Дверь купе = рамка по периметру + наполнение внутри неё (зеркало/ЛДСП/стекло).
// Наполнение сейчас той же толщины, что и панели короба, и красится в цвет фасада —
// когда рамка/наполнение станут настраиваться раздельно (разный цвет рамки, разный материал
// наполнения), менять нужно будет только эту функцию.
function buildSlidingDoor(x, y, z, w, h, fillColor) {
  const fw = DOOR_FRAME_WIDTH;
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y + h / 2 - fw / 2, z]); // верхний брусок рамки
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y - h / 2 + fw / 2, z]); // нижний брусок рамки
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x - w / 2 + fw / 2, y, z]); // левый брусок
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x + w / 2 - fw / 2, y, z]); // правый брусок
  addPanel(w - 2 * fw, h - 2 * fw, PANEL_THICKNESS, fillColor, [x, y, z], 0.85); // наполнение
}

// Общий короб для шкафа-купе / распашного / открытого — сегодня они выглядят одинаково
// (двери купе рисуются всегда), различия по дверям будут добавлены отдельно для каждого типа.
export function buildWardrobeBox() {
  const { width, depth, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  // Без дна нечему опираться на цоколь — он тоже пропадает, даже если галочка стоит.
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  // Цоколь занимает нижнюю часть общей высоты изделия — короб над ним ниже на эту величину.
  const height = state.height - plinthH;
  const y0 = plinthH; // низ короба, всё остальное строится как раньше, но с этим смещением

  if (plinthH > 0) {
    addPanel(width, plinthH, depth - 40, kColor, [0, plinthH / 2, -20]);
  }

  // Выравнивающие элементы — тонкие планки (толщиной с панель) у самого переднего края,
  // рядом со стойкой/крышей; сама стойка/крыша сдвигается вглубь на их размер.
  const alLeftW  = state.alignerLeft  ? state.alignerLeftW  : 0;
  const alRightW = state.alignerRight ? state.alignerRightW : 0;
  const alTopH   = state.alignerTop   ? state.alignerTopH   : 0;
  const alignZ = depth / 2 - t / 2;

  // Реальные границы короба — с учётом планок/коробов/выравнивающих элементов (та же логика,
  // что и для дверного пролёта). Стойки, задняя стенка и наполнение опираются на них, а не на
  // голую толщину панели — иначе при снятой крыше/дне (или сдвиге от выравнивателя) они не
  // дотянутся до реального края короба или, наоборот, вылезут за него.
  const {
    spanW, leftOff, rightOff, topOff, bottomOff,
    stojkaTopOff, stojkaBottomOff, stojkaLeftOff, stojkaRightOff, innerSpanW,
  } = effectiveDoorSpan();
  const stojkaH = height - stojkaTopOff - stojkaBottomOff;
  const stojkaCenterY = y0 + stojkaBottomOff + stojkaH / 2;

  if (!noBottom)    addPanel(width, t, depth, kColor, [0, y0 + t / 2, 0]);
  if (!noCeiling)   addPanel(width, t, depth, kColor, [0, y0 + height - alTopH - t / 2, 0]);
  if (!noSideLeft)  addPanel(t, stojkaH, depth, kColor, [-width / 2 + alLeftW + t / 2, stojkaCenterY, 0]);
  if (!noSideRight) addPanel(t, stojkaH, depth, kColor, [width / 2 - alRightW - t / 2, stojkaCenterY, 0]);
  if (state.alignerLeft)  addPanel(alLeftW,  stojkaH, t, kColor, [-width / 2 + alLeftW / 2, stojkaCenterY, alignZ]);
  if (state.alignerRight) addPanel(alRightW, stojkaH, t, kColor, [width / 2 - alRightW / 2, stojkaCenterY, alignZ]);
  if (state.alignerTop)   addPanel(width, alTopH, t, kColor, [0, y0 + height - alTopH / 2, alignZ]);
  if (state.backWall !== 'none') {
    const bwColor = state.backWall === 'hdf' ? 0xffffff : kColor;
    const bwThick = state.backWall === 'hdf' ? 4 : t;
    addPanel(width - stojkaLeftOff - stojkaRightOff, stojkaH, bwThick, bwColor, [0, stojkaCenterY, -depth / 2 + bwThick / 2]);
  }

  // Наполнение (перегородки, полки) не занимает дверную зону и прижато к задней стенке —
  // короб при этом остаётся на полную глубину.
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  const innerZ = -DOOR_DEPTH_ZONE / 2;

  // Ширины секций хранятся как есть в state.sections; здесь только страховка на случай, если
  // что-то изменило границы короба (габариты, стойки, выравниватели) и не вызвало rebalanceSections()
  // само — без этого секции могли бы не долетать до края короба или вылезать за него. Считаем
  // от innerSpanW (реальная ширина до стены), а не spanW (дверной пролёт) — наполнение должно
  // доходить до стены независимо от планки/короба на стойке.
  const sections = state.sections;
  {
    const available = innerSpanW - (sections.length - 1) * t;
    const sum = sections.reduce((s, sec) => s + sec.width, 0);
    if (Math.abs(sum - available) > 0.5) rebalanceSections();
  }
  clampSectionSizes(sections, depth);
  const sectionCenters = [];
  {
    let cursorX = -width / 2 + stojkaLeftOff;
    sections.forEach((sec, i) => {
      sectionCenters.push(cursorX + sec.width / 2);
      cursorX += sec.width;
      if (i < sections.length - 1) {
        addPanel(t, stojkaH, innerDepth, nColor, [cursorX + t / 2, stojkaCenterY, innerZ]);
        cursorX += t;
      }
    });
  }

  // Визуализация планок и коробов (глубина = дверная зона, внутри габарита изделия)
  const elemZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
  const totalH = state.height;

  function drawSideElem(noSide, replace, boxW, xCenter) {
    if (!noSide) return;
    if (replace === 'planka')
      addPanel(t, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
    else if (replace === 'box')
      addPanel(boxW, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
  }
  drawSideElem(state.noSideLeft,  state.leftReplace,  state.leftBoxW,  -width / 2 + (state.leftReplace === 'box' ? state.leftBoxW : t) / 2);
  drawSideElem(state.noSideRight, state.rightReplace, state.rightBoxW,  width / 2 - (state.rightReplace === 'box' ? state.rightBoxW : t) / 2);

  if (state.noCeiling) {
    const h = state.topReplace === 'box' ? state.topBoxH : t;
    if (state.topReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, totalH - h / 2, elemZ]);
  }
  if (state.noBottom) {
    const h = state.bottomReplace === 'box' ? state.bottomBoxH : t;
    if (state.bottomReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, h / 2, elemZ]);
  }

  const spanCenterX = -width / 2 + leftOff + spanW / 2;

  const doorCount = getDoorCount(spanW);
  if (state.showDoors) {
    const gap = 4;
    const doorW = (spanW + (doorCount - 1) * DOOR_OVERLAP) / doorCount;
    const doorZoneZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
    const railFront = depth / 2 - DOOR_FRAME_DEPTH / 2;
    const railBack  = depth / 2 - DOOR_DEPTH_ZONE + DOOR_FRAME_DEPTH / 2;

    addPanel(spanW, TOP_RAIL_HEIGHT,    DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + height - topOff - TOP_RAIL_HEIGHT / 2,       doorZoneZ]);
    addPanel(spanW, BOTTOM_RAIL_HEIGHT, DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + bottomOff + BOTTOM_RAIL_HEIGHT / 2, doorZoneZ]);

    const doorBottom  = y0 + bottomOff + BOTTOM_RAIL_HEIGHT + gap;
    const doorTop     = y0 + height - topOff - TOP_RAIL_HEIGHT - gap;
    const doorH       = doorTop - doorBottom;
    const doorCenterY = (doorBottom + doorTop) / 2;

    for (let i = 0; i < doorCount; i++) {
      const leftEdge = -spanW / 2 + i * (doorW - DOOR_OVERLAP);
      const x = spanCenterX + leftEdge + doorW / 2;
      const z = i % 2 === 0 ? railFront : railBack;
      buildSlidingDoor(x, doorCenterY, z, doorW, doorH, fColor);
    }
  }

  const fillBottom = bottomOff + 10, fillTop = height - topOff - 10;
  // Граница дверной зоны — та же, что и у полок/перегородки (innerZ ± innerDepth/2): ящики
  // должны быть с ней вровень, а не торчать вперёд к самим дверям.
  const frontZ = depth / 2 - DOOR_DEPTH_ZONE;
  let totalShelves = 0, totalDrawers = 0, totalRod = 0, totalDrawerSoft = 0, totalDrawerBasic = 0, totalMeshShelves = 0, totalValet = 0, totalBaskets = 0;

  function addRod(cx, y, sw) {
    const rodGeo = new THREE.CylinderGeometry(ROD_RADIUS, ROD_RADIUS, sw, 24);
    const rodMat = new THREE.MeshStandardMaterial({ color: ROD_COLOR, metalness: 0.9, roughness: 0.15 });
    const rodMesh = new THREE.Mesh(rodGeo, rodMat);
    rodMesh.rotation.z = Math.PI / 2;
    rodMesh.position.set(cx, y0 + y, innerZ);
    furnitureGroup.add(rodMesh);
  }

  // Ящик = фасад (лицевая панель, цвет фасада, вровень с перегородкой) + короб позади него
  // (дно/боковины/задняя стенка, цвет наполнения/ЛДСП, чуть уже фасада). Глубина короба
  // ограничена, чтобы не вылезти за заднюю стенку короба шкафа.
  function addDrawer(cx, y, sw, sec) {
    const dh = sec.drawerHeight;
    const facadeZ = frontZ - t / 2;
    const { boxW, boxH, boxDepth } = drawerBoxSize(sw, dh, sec.drawerDepth, depth);
    const boxCenterZ = facadeZ - t / 2 - boxDepth / 2;

    addPanel(sw, dh, t, fColor, [cx, y0 + y, facadeZ], 0.9); // фасад
    addPanel(boxW, t, boxDepth, nColor, [cx, y0 + y - boxH / 2 + t / 2, boxCenterZ]);      // дно короба
    addPanel(t, boxH, boxDepth, nColor, [cx - boxW / 2 + t / 2, y0 + y, boxCenterZ]);      // левая боковина
    addPanel(t, boxH, boxDepth, nColor, [cx + boxW / 2 - t / 2, y0 + y, boxCenterZ]);      // правая боковина
    addPanel(boxW, boxH, t, nColor, [cx, y0 + y, boxCenterZ - boxDepth / 2 + t / 2]);       // задняя стенка короба
  }

  // Тонкая планка без чёрного контура (addPanel рисует его всегда, для десятков тонких прутков
  // это выглядело бы захламлённо) — металлик/белый по выбранному цвету.
  function addBar(w, h, d, x, y, z, colorKey) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    mesh.position.set(x, y, z);
    furnitureGroup.add(mesh);
  }

  // Круглый пруток (настоящая сетка/штанга сделана из проволоки, не плоских планок) — цилиндр,
  // ориентированный вдоль оси 'x' или 'z' (по умолчанию — вдоль 'y', как обычный CylinderGeometry).
  function addRodBar(length, radius, x, y, z, axis, colorKey) {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    furnitureGroup.add(mesh);
  }

  // Наклонный пруток между двумя произвольными точками — обычный addRodBar умеет только строго
  // вдоль осей x/y/z, а трапециевидным стойкам корзины нужен реальный наклон.
  function addRodBetween(p1, p2, radius, colorKey) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(meshShelfMaterialProps(colorKey)));
    mesh.position.set((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    furnitureGroup.add(mesh);
  }

  // Сетчатая полка — сделана из круглой проволоки (не плоских планок). Частые тонкие прутки
  // идут ВДОЛЬ ГЛУБИНЫ, с шагом 25мм вдоль ширины, и тянутся сквозь все силовые прутки без
  // разрыва. У КАЖДОГО такого прутка свой отдельный загиб-крючок на переднем конце — приподнят
  // на 35мм. Силовых прутков поперёк (вдоль ширины) — 4: задний ровно на заднем крае (им
  // заканчивается полка), второй чуть ближе к переднему краю от середины, третий у основания
  // загиба (на высоте прутков, в лицевой плоскости), четвёртый замыкает загиб сверху (на высоте
  // окончания крючков).
  function addMeshShelf(cx, y, sw, meshDepth, colorKey) {
    // Если есть задняя стенка, полка не должна протыкать её насквозь — сдвигаем задний край
    // вперёд на её толщину (см. backWallClearance).
    const backZ = -depth / 2 + backWallClearance();
    const frontZ = backZ + meshDepth;
    const wireR = MESH_WIRE / 2;
    const crossR = MESH_WIRE * 1.3 / 2;

    const nWires = Math.max(6, Math.round(sw / MESH_WIRE_STEP));
    for (let i = 0; i <= nWires; i++) {
      const wx = cx - sw / 2 + (sw * i) / nWires;
      addRodBar(meshDepth, wireR, wx, y, backZ + meshDepth / 2, 'z', colorKey);
      addRodBar(MESH_LIP_HEIGHT, wireR, wx, y + MESH_LIP_HEIGHT / 2, frontZ, 'y', colorKey); // свой крючок
    }

    addRodBar(sw, crossR, cx, y, backZ, 'x', colorKey);                       // 1: задний, на краю
    addRodBar(sw, crossR, cx, y, backZ + meshDepth * 0.6, 'x', colorKey);     // 2: чуть ближе к переду от середины
    addRodBar(sw, crossR, cx, y, frontZ, 'x', colorKey);                      // 3: у основания загиба
    addRodBar(sw, crossR, cx, y + MESH_LIP_HEIGHT, frontZ, 'x', colorKey);    // 4: замыкает загиб сверху
  }

  // Сетчатая корзина — открытый сверху проволочный короб (дно + 4 стенки), выкатной, типоразмер
  // жёстко привязан к ширине секции (см. basketFits/requiredBasketProyom). Физическая ширина
  // корзины — basketWidth (меньше ширины секции на BASKET_PROYOM_GAP — это зазор под
  // направляющие), центрирована в секции. В проекции (вид спереди) — трапеция: дно уже верха на
  // BASKET_TAPER мм по ширине (реальная форма выкатных корзин, не прямоугольный короб). Глубина
  // не сужается — только ширина. Дно и вертикальные стойки стенок используют один и тот же шаг
  // BASKET_WIRE_STEP (дно — реже, чем было раньше, стойки — чаще).
  function addBasket(cx, yBottom, sw, basketWidth, basketDepth, basketHeight, colorKey) {
    // Если есть задняя стенка, корзина не должна протыкать её насквозь — сдвигаем задний край
    // вперёд на её толщину (см. backWallClearance).
    const backZ = -depth / 2 + backWallClearance();
    const frontZ = backZ + basketDepth;
    const yTop = yBottom + basketHeight;
    const wireR = BASKET_WIRE / 2;

    const widthTop = basketWidth;
    const widthBottom = Math.max(basketWidth - BASKET_TAPER, BASKET_MIN_BOTTOM_WIDTH);
    const leftXTop = cx - widthTop / 2;
    const leftXBottom = cx - widthBottom / 2;

    // X-координата на произвольной высоте y для прутка, который у верхнего (широкого) края
    // находится в доле t (0..1) поперёк ширины — линейная интерполяция между широким верхом и
    // узким низом даёт правильную трапецию на любой высоте.
    function xAt(t, y) {
      const topX = leftXTop + widthTop * t;
      const botX = leftXBottom + widthBottom * t;
      const k = (y - yBottom) / basketHeight;
      return botX + (topX - botX) * k;
    }

    const nW = Math.max(4, Math.round(widthTop / BASKET_WIRE_STEP));   // прутков поперёк ширины
    const nD = Math.max(2, Math.round(basketDepth / BASKET_WIRE_STEP)); // прутков поперёк глубины

    // Дно — сетка в обе стороны (не только вдоль глубины, как раньше, но и вдоль ширины), на
    // уровне нижнего (узкого) края.
    for (let i = 0; i <= nW; i++) {
      const wx = xAt(i / nW, yBottom);
      addRodBar(basketDepth, wireR, wx, yBottom, backZ + basketDepth / 2, 'z', colorKey);
    }
    for (let i = 0; i <= nD; i++) {
      const wz = backZ + (basketDepth * i) / nD;
      addRodBar(widthBottom, wireR, cx, yBottom, wz, 'x', colorKey);
    }

    // Стенка вдоль ширины (перед/зад): широкий верхний рельс + узкий нижний рельс + наклонные
    // стойки между ними.
    function wallAlongWidth(z) {
      addRodBar(widthTop,    wireR, cx, yTop,    z, 'x', colorKey);
      addRodBar(widthBottom, wireR, cx, yBottom, z, 'x', colorKey);
      for (let i = 0; i <= nW; i++) {
        const t = i / nW;
        addRodBetween([xAt(t, yTop), yTop, z], [xAt(t, yBottom), yBottom, z], wireR, colorKey);
      }
    }
    // Стенка вдоль глубины (t=0 — левая, t=1 — правая): рельсы горизонтальны (глубина не
    // сужается), но сама стенка наклонена внутрь у дна — те же наклонные стойки.
    function wallAlongDepth(t) {
      addRodBar(basketDepth, wireR, xAt(t, yTop),    yTop,    backZ + basketDepth / 2, 'z', colorKey);
      addRodBar(basketDepth, wireR, xAt(t, yBottom), yBottom, backZ + basketDepth / 2, 'z', colorKey);
      for (let i = 0; i <= nD; i++) {
        const wz = backZ + (basketDepth * i) / nD;
        addRodBetween([xAt(t, yTop), yTop, wz], [xAt(t, yBottom), yBottom, wz], wireR, colorKey);
      }
    }
    wallAlongWidth(backZ);
    wallAlongWidth(frontZ);
    wallAlongDepth(0);
    wallAlongDepth(1);

    // Направляющие — планки, прижатые к стойкам СЕКЦИИ (sw — реальная ширина секции, не
    // корзины — между ними и есть зазор BASKET_PROYOM_GAP), низ планки ровно на уровне дна
    // корзины (не ниже), сама планка стоит выше этой линии. Глубина совпадает с глубиной
    // корзины. Цвет фиксированный — металлик, как у дверных рельс/кронштейнов вешала, не
    // зависит от цвета корзины (реальная фурнитура рельс всегда металлическая).
    const railZCenter = backZ + basketDepth / 2;
    const railYCenter = yBottom + BASKET_RAIL_HEIGHT / 2;
    const stojkaLeftX  = cx - sw / 2;
    const stojkaRightX = cx + sw / 2;
    const leftRailX  = stojkaLeftX  + BASKET_RAIL_WIDTH / 2;
    const rightRailX = stojkaRightX - BASKET_RAIL_WIDTH / 2;
    addPanel(BASKET_RAIL_WIDTH, BASKET_RAIL_HEIGHT, basketDepth, BASKET_RAIL_COLOR, [leftRailX,  railYCenter, railZCenter]);
    addPanel(BASKET_RAIL_WIDTH, BASKET_RAIL_HEIGHT, basketDepth, BASKET_RAIL_COLOR, [rightRailX, railYCenter, railZCenter]);

    // Полосы — соединяют корзину с направляющей/стойкой у переднего и заднего торца (2 слева +
    // 2 справа = 4 всего). Ширина — от самой стойки до касания корзины (перекрывает и
    // направляющую тоже), высота 10мм, глубина (по Z) 20мм, низ строго на уровне дна корзины
    // (не ниже — yBottom, планка стоит НАД этой линией, а не свисает под неё).
    const rightXBottom = cx + widthBottom / 2;
    const leftStripW  = leftXBottom  - stojkaLeftX;
    const rightStripW = stojkaRightX - rightXBottom;
    const leftStripX  = (stojkaLeftX  + leftXBottom)  / 2;
    const rightStripX = (stojkaRightX + rightXBottom) / 2;
    const stripYCenter = yBottom + BASKET_CLIP_HEIGHT / 2;
    const stripZFront = backZ + basketDepth - BASKET_CLIP_DEPTH / 2;
    const stripZBack  = backZ + BASKET_CLIP_DEPTH / 2;
    [[leftStripX, leftStripW], [rightStripX, rightStripW]].forEach(([sx, w]) => {
      addPanel(w, BASKET_CLIP_HEIGHT, BASKET_CLIP_DEPTH, BASKET_RAIL_COLOR, [sx, stripYCenter, stripZFront]);
      addPanel(w, BASKET_CLIP_HEIGHT, BASKET_CLIP_DEPTH, BASKET_RAIL_COLOR, [sx, stripYCenter, stripZBack]);
    });
  }

  // Торцевое вешало — крепится к низу верхней полки 4 саморезами (2 спереди, 2 сзади — не к
  // задней жёсткости, крепления отнесены вперёд). Один замкнутый прямоугольник по центру секции
  // (не два, не слева-справа): верхний пруток вдоль глубины (у полки) → стойка вниз спереди →
  // нижний пруток вдоль глубины (параллельно, ниже — на нём висят вешалки) → стойка вверх сзади
  // → замыкается обратно на верхний. Показываем в выдвинутом положении.
  // Перемычки (доп. жёсткость) убраны — расположение будет уточнено отдельно.
  // topShelfWorldY — мировая Y-координата верхней полки (с учётом y0), как и у других функций.
  function addValet(cx, topShelfWorldY, valetLength) {
    const shelfBottomY = topShelfWorldY - t / 2;
    const railY = shelfBottomY - 8;
    const half = VALET_LOOP_WIDTH / 2;
    const dropH = 50; // на сколько нижний пруток (штанга-вешалка) ниже верхнего рельса

    // valetLength — габарит всего узла целиком (кронштейн-кронштейн). Если сзади жёсткость —
    // узел сдвинут вперёд на её толщину (см. valetBackClearance/availableValetLengths — те же
    // 16мм там уже вычтены из допустимых размеров). Центры кронштейнов (и концы прутков)
    // отступают от краёв габарита на полглубины кронштейна.
    const envBackZ = -depth / 2 + valetBackClearance() + backWallClearance();
    const backZ = envBackZ + VALET_BRACKET_DEPTH / 2;
    const frontZ = envBackZ + valetLength - VALET_BRACKET_DEPTH / 2;
    const rodLen = frontZ - backZ;

    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, backZ]);  // кронштейн задний левый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, backZ]);  // кронштейн задний правый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx - half, shelfBottomY - 7, frontZ]); // кронштейн передний левый
    addPanel(30, 15, VALET_BRACKET_DEPTH, 0xb0b0b4, [cx + half, shelfBottomY - 7, frontZ]); // кронштейн передний правый

    const mat = { color: VALET_COLOR, metalness: 0.8, roughness: 0.2 };
    const addValetRod = (length, x, y, z, axis) => {
      const geo = new THREE.CylinderGeometry(VALET_ROD_RADIUS, VALET_ROD_RADIUS, length, 10);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(mat));
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      furnitureGroup.add(mesh);
    };
    addValetRod(rodLen, cx, railY, backZ + rodLen / 2, 'z');          // верхний пруток (рельс у полки)
    addValetRod(dropH, cx, railY - dropH / 2, frontZ, 'y');           // стойка вниз спереди
    addValetRod(rodLen, cx, railY - dropH, backZ + rodLen / 2, 'z');  // нижний пруток (штанга-вешалка)
    addValetRod(dropH, cx, railY - dropH / 2, backZ, 'y');            // стойка вверх сзади

    // Два прутка вдоль ширины, соединяющие середины нижних граней кронштейнов (левого и
    // правого) — отдельно спереди и сзади.
    const bracketBottomY = shelfBottomY - 7 - 15 / 2;
    addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, backZ, 'x');
    addValetRod(VALET_LOOP_WIDTH, cx, bracketBottomY, frontZ, 'x');
  }

  sections.forEach((sec, s) => {
    const cx = sectionCenters[s];
    // Без зазора — полки/жёсткость/штанга/ящики примыкают к стойкам/перегородке вплотную.
    const sw = sec.width;

    // Дефолтная пара полок: верхняя и нижняя, задают границы зон для доп. полок/штанги.
    // Для очень низких секций отступы сжимаются к центру, чтобы полки не пересеклись.
    let topShelfY = fillTop - TOP_SHELF_GAP;
    let bottomShelfY = fillBottom + BOTTOM_SHELF_GAP;
    if (topShelfY - bottomShelfY < MIN_ZONE_GAP) {
      const mid = (fillTop + fillBottom) / 2;
      topShelfY = mid + MIN_ZONE_GAP / 2;
      bottomShelfY = mid - MIN_ZONE_GAP / 2;
    }
    addPanel(sw, t, innerDepth, nColor, [cx, y0 + topShelfY, innerZ]);
    totalShelves += 1;
    // bottomShelfY остаётся границей зон для штанги №2 и распределения доп. полок, даже когда
    // ни одна полка там не нарисована (sec.shelves === 0).

    // Полки (экспериментальная объединённая модель — см. state.js): первая полка счётчика
    // всегда встаёт на прежнее место "нижней" полки, остальные распределяются равномерно между
    // ней и верхней полкой. Точную расстановку впоследствии заменит перетаскивание мышкой —
    // сейчас важно только чтобы каждая полка была отдельным управляемым элементом.
    if (sec.shelves > 0) {
      addPanel(sw, t, innerDepth, nColor, [cx, y0 + bottomShelfY, innerZ]);
      totalShelves += 1;
      if (sec.shelves > 1) {
        const extra = sec.shelves - 1;
        const usable = topShelfY - bottomShelfY;
        for (let i = 0; i < extra; i++) {
          const y = bottomShelfY + (usable * (i + 1)) / (extra + 1);
          addPanel(sw, t, innerDepth, nColor, [cx, y0 + y, innerZ]);
        }
        totalShelves += extra;
      }
    }

    if (sec.valet) {
      addValet(cx, y0 + topShelfY, sec.valetLength);
      totalValet += 1;
    }

    // Ящики стоят над нижней полкой (на её верхней грани), а если полки нет вообще — прямо на
    // дне короба. Если снята боковая стойка (планка/короб/ничего — не важно) — направляющие
    // ящика крепить некуда, ящики не ставим вообще, независимо от значения в поле.
    if (sec.drawers > 0 && !noSideLeft && !noSideRight) {
      const gap = 4;
      const baseY = sec.shelves > 0 ? bottomShelfY + t / 2 : fillBottom;
      for (let i = 0; i < sec.drawers; i++) {
        const y = baseY + i * (sec.drawerHeight + gap) + sec.drawerHeight / 2;
        addDrawer(cx, y, sw, sec);
      }
      totalDrawers += sec.drawers;
      if (sec.drawerSoftClose) totalDrawerSoft += sec.drawers; else totalDrawerBasic += sec.drawers;
    }

    // Сетчатые полки — независимое от ящиков поле, тоже строятся снизу вверх (максимум 3шт).
    if (sec.meshShelves > 0) {
      const baseY = sec.shelves > 0 ? bottomShelfY + t / 2 : fillBottom;
      for (let i = 0; i < sec.meshShelves; i++) {
        const y = baseY + MESH_THICKNESS / 2 + i * MESH_PITCH;
        addMeshShelf(cx, y0 + y, sw, sec.meshDepth, sec.meshColor);
      }
      totalMeshShelves += sec.meshShelves;
    }

    // Сетчатые корзины — как и ящики, нужна боковая стойка (направляющие крепятся к ней) и
    // ширина секции строго равна обязательному проёму (basketFits) — clampSectionSizes уже
    // обнулил sec.baskets, если не совпало, но проверяем ещё раз здесь на случай прямого
    // вызова build() в обход клампа.
    if (sec.baskets > 0 && !noSideLeft && !noSideRight && basketFits(sec)) {
      // Зазор между корзинами больше, чем у ящиков (4мм) — корзина выкатная и открытая сверху,
      // нужен видимый промежуток для руки/захвата, а не плотная посадка фасад-в-фасад.
      const gap = BASKET_STACK_GAP;
      const baseY = sec.shelves > 0 ? bottomShelfY + t / 2 : fillBottom;
      for (let i = 0; i < sec.baskets; i++) {
        const y = baseY + i * (sec.basketHeight + gap);
        addBasket(cx, y0 + y, sw, sec.basketWidth, sec.basketDepth, sec.basketHeight, sec.basketColor);
      }
      totalBaskets += sec.baskets;
    }

    // Планка жёсткости под верхней полкой — не нужна, если задняя стенка сама держит форму (ЛДСП).
    // Вертикальная пластина (перпендикулярно полке, свисает вниз от неё), стоит в плоскости
    // задней стенки — не лежит плашмя на всю глубину полки, как раньше.
    if (state.backWall !== 'ldsp') {
      const stiffenerZ = -depth / 2 + STIFFENER_THICKNESS / 2;
      const stiffenerY = topShelfY - t / 2 - STIFFENER_HEIGHT / 2;
      addPanel(sw, STIFFENER_HEIGHT, STIFFENER_THICKNESS, nColor, [cx, y0 + stiffenerY, stiffenerZ]);
    }

    // Штанга №1 — фиксированно под верхней полкой; штанга №2 (если выбраны обе) — посередине
    // между штангой №1 и нижней полкой.
    const rodCount = Math.max(0, Math.min(2, sec.rod || 0));
    if (rodCount >= 1) {
      const rod1Y = topShelfY - ROD_BELOW_TOP_SHELF;
      addRod(cx, rod1Y, sw);
      if (rodCount === 2) addRod(cx, (rod1Y + bottomShelfY) / 2, sw);
      totalRod += rodCount;
    }
  });

  return {
    door: doorCount, drawer: totalDrawers, shelf: totalShelves, rod: totalRod, item: 1,
    drawerSoft: totalDrawerSoft, drawerBasic: totalDrawerBasic, meshShelf: totalMeshShelves, valet: totalValet,
    basket: totalBaskets,
  };
}
