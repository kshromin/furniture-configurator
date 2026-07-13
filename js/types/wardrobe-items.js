import { state, PANEL_THICKNESS, newItemId } from '../core/state.js';
import { TOP_SHELF_GAP } from './wardrobe-constants.js';
import { effectiveDoorSpan } from './wardrobe-sizing.js';

// Коллизии + драг: где допустимо стоять элементу секции (полка/ящик/сетка/корзина/штанга),
// пересекается ли кандидатная позиция с уже стоящими, поиск свободного места. Ничего не рисует
// в 3D (см. wardrobe-geometry.js) и не считает доступные размеры/цену (см. wardrobe-sizing.js) —
// только геометрия коллизий по вертикали внутри одной секции. js/core/itemDrag.js и
// js/core/dimensions.js — основные потребители этого модуля.

const MIN_ZONE_GAP = 200; // страховка для низких секций, чтобы полки не пересеклись
export const ROD_BELOW_TOP_SHELF = 70; // дефолтная штанга садится настолько ниже верхней полки (не в первую свободную щель снизу)

// Высота полосы коллизии по типу элемента — используется и для проверки пересечений, и для
// поиска свободного места. Зазоры совпадают с теми, что раньше были у алгоритмической стопки
// (4мм у ящиков, BASKET_STACK_GAP у корзин), чтобы визуальный воздух между элементами не изменился.
const DRAWER_GAP = 4;
export const MESH_THICKNESS = 20; // высота силовых прутков сетчатой полки (см. wardrobe-geometry.js addMeshShelf)
export const BASKET_STACK_GAP = 20; // зазор по высоте между соседними корзинами в стопке (у ящиков — 4мм)
export const ROD_BAND_HEIGHT = 40; // тонкая полоса вокруг штанги, без запаса под одежду

// Вертикальные границы наполнения секции — общие для всех секций (не зависят от sec, только от
// габаритов изделия/крыши/дна/цоколя), поэтому считаются один раз, а не внутри цикла по секциям.
// fillBottom/fillTop — та же система координат, что и state.sections[i].items[].y (ЛОКАЛЬНАЯ,
// без y0/смещения цоколя — оно прибавляется отдельно в момент рисования). Верхняя полка больше
// НЕ фиксирована — это обычный (но защищённый от удаления, pinned) перетаскиваемый item, поэтому
// валидный диапазон для ЛЮБОГО элемента — весь [fillBottom, fillTop] целиком.
export function sectionVerticalBounds() {
  const { plinthEnabled, plinthHeight, noBottom } = state;
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  const height = state.height - plinthH;
  const { topOff, bottomOff } = effectiveDoorSpan();
  const fillBottom = bottomOff + 10;
  const fillTop = height - topOff - 10;
  return { fillBottom, fillTop };
}

// Начальная Y-позиция структурной (pinned) полки при первом создании набора items — та же
// формула, что раньше задавала ПОСТОЯННУЮ фиксированную верхнюю полку (TOP_SHELF_GAP от верхней
// границы, со страховкой MIN_ZONE_GAP для низких секций) — теперь это только стартовое положение
// обычного перетаскиваемого item, дальше пользователь может утащить её куда угодно.
function defaultPinnedShelfY(fillBottom, fillTop) {
  let y = fillTop - TOP_SHELF_GAP;
  if (y < fillBottom + MIN_ZONE_GAP) y = fillBottom + MIN_ZONE_GAP;
  return y;
}

export function itemBandHeight(type, sec) {
  switch (type) {
    case 'shelf':  return PANEL_THICKNESS;
    case 'drawer': return sec.drawerHeight + DRAWER_GAP;
    case 'mesh':   return MESH_THICKNESS + 10;
    case 'basket': return sec.basketHeight + BASKET_STACK_GAP;
    case 'rod':    return ROD_BAND_HEIGHT;
    default:       return PANEL_THICKNESS;
  }
}

// item.y хранится как Y ЦЕНТРА полосы коллизии для всех типов (в т.ч. корзины, хотя её
// геометрия рисуется от нижнего края — конвертация в addBasket на месте вызова).
export function itemRange(item, sec) {
  const h = itemBandHeight(item.type, sec);
  return [item.y - h / 2, item.y + h / 2];
}

// Высота/положение узла вешала (см. addValet в wardrobe-geometry.js: railY = anchorWorldY - t/2
// - 8, узел свисает вниз от рельса на dropH=50) — используется, чтобы вешало тоже занимало
// полосу коллизии, и другие элементы нельзя было перетащить/добавить туда, где оно висит.
const VALET_RAIL_OFFSET = 8;
export const VALET_DROP_HEIGHT = 50;
function valetBand(sec) {
  const anchorY = resolveValetAnchorY(sec);
  const hi = anchorY - PANEL_THICKNESS / 2 - VALET_RAIL_OFFSET;
  return [hi - VALET_DROP_HEIGHT, hi];
}

export function itemBands(sec, excludeId) {
  const bands = sec.items.filter(it => it.id !== excludeId).map(it => {
    const [lo, hi] = itemRange(it, sec);
    return { id: it.id, lo, hi };
  });
  if (sec.valet) {
    const [lo, hi] = valetBand(sec);
    bands.push({ id: '__valet__', lo, hi });
  }
  return bands;
}

// Пересекается ли кандидатная позиция (Y центра) элемента типа type с каким-либо другим
// элементом секции (кроме excludeId — самого себя при перетаскивании), с вешалом (если есть),
// или с границами секции (пол/потолок наполнения). Используется и во время драга (подсветка
// красным), и при поиске свободного места. Верхняя полка теперь ОБЫЧНЫЙ item (просто pinned —
// защищена от удаления в UI), отдельной границы для неё больше нет — валидный диапазон для
// любого элемента, включая её саму, это весь [fillBottom, fillTop].
export function checkOverlap(candidateY, type, excludeId, sec, fillBottom, fillTop) {
  const h = itemBandHeight(type, sec);
  const lo = candidateY - h / 2, hi = candidateY + h / 2;
  if (lo < fillBottom || hi > fillTop) return true;
  return itemBands(sec, excludeId).some(b => lo < b.hi && hi > b.lo);
}

// Ищет первый достаточный по высоте свободный промежуток снизу вверх (от пола до потолка
// наполнения секции) для элемента типа type. Возвращает Y центра или null, если свободного места
// не нашлось (вызывающий код должен показать тост).
export function findFreeSlot(sec, type, fillBottom, fillTop) {
  const h = itemBandHeight(type, sec);
  const bands = itemBands(sec, null).sort((a, b) => a.lo - b.lo);
  let cursor = fillBottom;
  for (const b of bands) {
    if (b.lo - cursor >= h) return cursor + h / 2;
    cursor = Math.max(cursor, b.hi);
  }
  if (fillTop - cursor >= h) return cursor + h / 2;
  return null;
}

// Подрезка позиций уже сохранённых элементов под текущие границы секции — вызывается при каждой
// сборке (габариты/крыша/дно/цоколь могли измениться и вытолкнуть элемент за пределы диапазона).
// Простое ограничение по диапазону, без переупаковки — коллизии между элементами при этом не
// разрешаются (редкий крайний случай: секция резко уменьшилась и несколько элементов зажало в
// одну точку), достаточно как страховка от вылета геометрии за габариты.
export function clampItemPositions(sec, fillBottom, fillTop) {
  sec.items.forEach(item => {
    const h = itemBandHeight(item.type, sec);
    const minY = fillBottom + h / 2;
    const maxY = fillTop - h / 2;
    item.y = maxY < minY ? (minY + maxY) / 2 : Math.min(Math.max(item.y, minY), maxY);
  });
}

// Дефолтный набор items для новой/пресетной секции — сперва структурная (pinned) верхняя полка
// (есть всегда, первая, защищена от удаления в UI — см. tabs.js), затем остальные полки/ящики по
// очереди в первое свободное место снизу вверх (findFreeSlot), штанга — отдельно (см. ниже).
// Общая функция для presets.js и tabs.js («Добавить секцию»), чтобы не дублировать расстановку.
export function defaultItemsForSection({ shelves = 0, drawers = 0, rod = 0, drawerHeight = 150 } = {}) {
  const { fillBottom, fillTop } = sectionVerticalBounds();
  const tempSec = { items: [], drawerHeight };
  const pinnedY = defaultPinnedShelfY(fillBottom, fillTop);
  tempSec.items.push({ id: newItemId(), type: 'shelf', y: pinnedY, pinned: true });

  const addN = (type, n) => {
    for (let i = 0; i < n; i++) {
      const y = findFreeSlot(tempSec, type, fillBottom, fillTop);
      if (y === null) break; // не влезло — маловероятно для дефолтных наборов, просто не добавляем дальше
      tempSec.items.push({ id: newItemId(), type, y });
    }
  };
  addN('shelf', shelves);
  addN('drawer', drawers);
  // Штанга по умолчанию садится у структурной верхней полки — привычный вид шкафа (см.
  // ROD_BELOW_TOP_SHELF), а не в первую попавшуюся свободную щель снизу (findFreeSlot дал бы
  // штангу прямо на полке у пола — непохоже на дефолтный шкаф).
  for (let i = 0; i < rod; i++) {
    const h = itemBandHeight('rod', tempSec);
    const preferredY = pinnedY - PANEL_THICKNESS / 2 - ROD_BELOW_TOP_SHELF - h / 2;
    const y = checkOverlap(preferredY, 'rod', null, tempSec, fillBottom, fillTop)
      ? findFreeSlot(tempSec, 'rod', fillBottom, fillTop)
      : preferredY;
    if (y === null) break;
    tempSec.items.push({ id: newItemId(), type: 'rod', y });
  }
  return tempSec.items;
}

// Полки, к которым может быть приклеено вешало (мышкой прыгает между ними) — все полки секции,
// включая структурную (pinned) — она теперь обычный shelf-item, отдельного сентинела не нужно.
export function valetAnchorCandidates(sec) {
  return sec.items.filter(it => it.type === 'shelf').map(it => ({ id: it.id, y: it.y }));
}

export function resolveValetAnchorY(sec) {
  if (sec.valetAnchorId) {
    const anchor = sec.items.find(it => it.id === sec.valetAnchorId && it.type === 'shelf');
    if (anchor) return anchor.y;
  }
  // По умолчанию (или если якорная полка была удалена) — структурная (pinned) полка; она есть
  // всегда, но подстрахуемся и на случай данных без неё (любая другая полка).
  const pinned = sec.items.find(it => it.type === 'shelf' && it.pinned);
  if (pinned) return pinned.y;
  const anyShelf = sec.items.find(it => it.type === 'shelf');
  return anyShelf ? anyShelf.y : 0;
}

// Сегменты секции для посегментной задней стенки (см. state.js sec.backWallSegments) — секция
// режется на промежутки границами-полками (плюс пол/потолок секции по краям), разрез точно по
// центру толщины полки. n полок дают n+1 сегментов; ключ сегмента — id полки, которая служит его
// НИЖНЕЙ границей, либо 'floor' для самого нижнего (от пола секции до первой полки или сразу до
// потолка, если полок нет вовсе).
// eligible — можно ли вообще поставить сюда стенку: панели нужна опора со ВСЕХ четырёх сторон
// сразу — по вертикали ОБЕИХ границ (полка — всегда реальная ЛДСП-граница; пол/потолок секции —
// только если не сняты «без дна»/«без крыши»), И по горизонтали ОБЕИХ сторон (слева и справа).
// Без этого панели физически не за что зацепиться на одном из бортов, даже если на остальных трёх
// опора есть. Средние секции всегда опираются на перегородку (она есть всегда), крайняя
// левая/правая — на настоящую боковую стойку короба, если та не снята («без левой/правой стойки»).
export function sectionBackWallSegments(sec, sectionIndex) {
  const { fillBottom, fillTop } = sectionVerticalBounds();
  const isFirst = sectionIndex === 0;
  const isLast = sectionIndex === state.sections.length - 1;
  const leftOk = !isFirst || !state.noSideLeft;
  const rightOk = !isLast || !state.noSideRight;
  const sidesOk = leftOk && rightOk;
  const shelves = sec.items.filter(it => it.type === 'shelf').sort((a, b) => a.y - b.y);
  const boundaries = [
    { y: fillBottom, isLdsp: !state.noBottom },
    ...shelves.map(sh => ({ y: sh.y, isLdsp: true, shelfId: sh.id })),
    { y: fillTop, isLdsp: !state.noCeiling },
  ];
  const segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const lo = boundaries[i], hi = boundaries[i + 1];
    segments.push({
      key: i === 0 ? 'floor' : lo.shelfId,
      loY: lo.y, hiY: hi.y,
      eligible: sidesOk && lo.isLdsp && hi.isLdsp,
    });
  }
  return segments;
}
