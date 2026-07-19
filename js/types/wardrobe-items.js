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
// "Сырые" границы — без учёта антресолей (см. задание «антресоли 19,07»): нужны самим антресолям,
// чтобы посчитать свою полку/зону от истинного потолка, а не от уже урезанного sectionVerticalBounds.
function rawSectionVerticalBounds() {
  const { plinthEnabled, plinthHeight, noBottom } = state;
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  const height = state.height - plinthH;
  const { topOff, bottomOff } = effectiveDoorSpan();
  const fillBottom = bottomOff + 10;
  const fillTop = height - topOff - 10;
  return { fillBottom, fillTop };
}

// Публичная версия — то же самое, но если антресоли включены (state.mezzanineEnabled), потолок
// наполнения ОСНОВНЫХ секций подрезается до низа общей антресольной полки (см. mezzanineShelfY
// ниже). Весь остальной код секций (коллизии/драг/дефолтные позиции элементов) вызывает именно
// эту функцию и ничего не знает про антресоли — просто работает в уменьшенном диапазоне.
export function sectionVerticalBounds() {
  const raw = rawSectionVerticalBounds();
  if (!state.mezzanineEnabled) return raw;
  return { fillBottom: raw.fillBottom, fillTop: mezzanineShelfY() - PANEL_THICKNESS / 2 - 10 };
}

// Физические границы внутреннего пространства — поверхность дна и низ крыши (либо низ антресольной
// полки, если антресоли включены), БЕЗ служебных ±10мм отступов расстановки. Для размерных линий:
// сумма просветов и толщин элементов должна сходиться с внутренней высотой шкафа на калькуляторе.
export function sectionVerticalBoundsPhysical() {
  const { fillBottom, fillTop } = sectionVerticalBounds();
  return { fillBottom: fillBottom - 10, fillTop: fillTop + 10 };
}

// ---------- антресоли (задание «антресоли 19,07») ----------
// Верхняя зона шкафа без стоек: одна сплошная (не входящая ни в чьи items) полка на весь короб,
// выше неё — отдельный ряд секций (state.mezzanineSections) со своей раскладкой по ширине и своим
// набором перегородок, ограничивающих только эту зону (полка-крыша), не всю высоту короба (см.
// buildWardrobeBox в wardrobe-geometry.js). Ящики/корзины туда не ставятся (не нужна такая же
// глубокая опора по бокам, да и не нужны в принципе антресолям) — остальные типы по аналогии.
export const MEZZANINE_MIN_HEIGHT = 200;    // минимальная высота самой антресольной зоны
export const MEZZANINE_MIN_MAIN_ZONE = 300; // минимальная высота, которая должна остаться внизу

// Y ЦЕНТРА общей антресольной полки (та же локальная система координат, что у item.y) — считается
// от "сырых" границ короба и state.mezzanineHeight, зажатой между MEZZANINE_MIN_HEIGHT и потолком
// минус MEZZANINE_MIN_MAIN_ZONE. Полка не item ни одной секции — рисуется один раз в buildWardrobeBox.
export function mezzanineShelfY() {
  const raw = rawSectionVerticalBounds();
  const physicalCeiling = raw.fillTop + 10;
  const physicalFloor = raw.fillBottom - 10;
  const totalH = physicalCeiling - physicalFloor;
  const maxH = Math.max(MEZZANINE_MIN_HEIGHT, totalH - MEZZANINE_MIN_MAIN_ZONE);
  const h = Math.min(Math.max(state.mezzanineHeight, MEZZANINE_MIN_HEIGHT), maxH);
  return physicalCeiling - h - PANEL_THICKNESS / 2;
}

// Диапазон наполнения самой антресольной зоны — от верхней поверхности общей полки до потолка
// (та же ±10мм страховка расстановки, что и у sectionVerticalBounds).
export function mezzanineVerticalBounds() {
  const raw = rawSectionVerticalBounds();
  const shelfTopSurface = mezzanineShelfY() + PANEL_THICKNESS / 2;
  return { fillBottom: shelfTopSurface + 10, fillTop: raw.fillTop };
}

export function mezzanineVerticalBoundsPhysical() {
  const { fillBottom, fillTop } = mezzanineVerticalBounds();
  return { fillBottom: fillBottom - 10, fillTop: fillTop + 10 };
}

// Диспетчеры по зоне ('main' | 'mezzanine') — единая точка ветвления для js/core/itemDrag.js и
// js/core/dimensions.js, чтобы не дублировать if(zone==='mezzanine') в каждом месте использования.
export function boundsForZone(zone) {
  return zone === 'mezzanine' ? mezzanineVerticalBounds() : sectionVerticalBounds();
}
export function boundsForZonePhysical(zone) {
  return zone === 'mezzanine' ? mezzanineVerticalBoundsPhysical() : sectionVerticalBoundsPhysical();
}
export function secForZone(zone, sectionIndex) {
  return zone === 'mezzanine' ? state.mezzanineSections[sectionIndex] : state.sections[sectionIndex];
}

// Начальная Y-позиция структурной (pinned) полки при первом создании набора items — та же
// формула, что раньше задавала ПОСТОЯННУЮ фиксированную верхнюю полку (TOP_SHELF_GAP от верхней
// границы, со страховкой MIN_ZONE_GAP для низких секций) — теперь это только стартовое положение
// обычного перетаскиваемого item, дальше пользователь может утащить её куда угодно.
export function defaultPinnedShelfY(fillBottom, fillTop) {
  let y = fillTop - TOP_SHELF_GAP;
  if (y < fillBottom + MIN_ZONE_GAP) y = fillBottom + MIN_ZONE_GAP;
  return y;
}

// item — опционально: полка может быть индивидуально 32мм (item.thick32); для кандидатов
// на добавление (item ещё нет) берётся обычная толщина.
export function itemBandHeight(type, sec, item = null) {
  switch (type) {
    case 'shelf':  return item?.thick32 ? 32 : PANEL_THICKNESS;
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
  const h = itemBandHeight(item.type, sec, item);
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

// pipeFillBottom — если передан, в полосы добавляется занятое вертикальными трубами-стойками
// пространство (item.verticalSupport, задание «трубы вертикально»): от ближайшей полки/пола под
// штангой и до самой штанги — труба не может проходить сквозь ящик/корзину/сетчатую полку.
// Обычные полки НЕ проверяются на эту полосу (см. checkOverlap/findFreeSlot ниже) — труба сама
// укорачивается до новой ближайшей полки, а не блокирует её постановку.
export function itemBands(sec, excludeId, pipeFillBottom) {
  const bands = sec.items.filter(it => it.id !== excludeId).map(it => {
    const [lo, hi] = itemRange(it, sec);
    return { id: it.id, lo, hi };
  });
  if (sec.valet) {
    const [lo, hi] = valetBand(sec);
    bands.push({ id: '__valet__', lo, hi });
  }
  if (pipeFillBottom !== undefined) {
    sec.items.forEach(it => {
      if (it.type !== 'rod' || !it.verticalSupport || it.id === excludeId) return;
      const surfaceY = nearestSupportSurfaceY(sec, it, pipeFillBottom);
      bands.push({ id: '__pipe__' + it.id, lo: surfaceY, hi: it.y });
    });
  }
  return bands;
}

// Типы, которые физически не могут делить пространство с вертикальной трубой-стойкой (труба не
// проходит сквозь них) — полки и штанги исключены сознательно, см. комментарий у itemBands.
const PIPE_BLOCKED_TYPES = new Set(['drawer', 'basket', 'mesh']);

// ---------- физические габариты (для размерных линий) ----------
// Полоса коллизии включает служебные зазоры (4мм у ящика, 10 у сетки, 20 у корзины, 40мм-полоса
// у штанги ⌀25) — для расстановки это правильно, но размерные линии должны показывать реальное
// используемое расстояние между поверхностями элементов, а не между полосами коллизии.
export function itemPhysicalHeight(type, sec, item = null) {
  switch (type) {
    case 'shelf':  return item?.thick32 ? 32 : PANEL_THICKNESS;
    case 'drawer': return sec.drawerHeight;
    case 'mesh':   return MESH_THICKNESS;
    case 'basket': return sec.basketHeight;
    case 'rod':    return 25; // диаметр штанги (см. ROD_RADIUS в wardrobe-geometry.js)
    default:       return PANEL_THICKNESS;
  }
}

// Те же полосы, что itemBands, но по физическим краям элементов (центр совпадает — item.y).
// Вешало оставлено полосой коллизии: его физический низ и есть граница полезного пространства.
export function itemPhysicalBands(sec, excludeId) {
  const bands = sec.items.filter(it => it.id !== excludeId).map(it => {
    const h = itemPhysicalHeight(it.type, sec, it);
    return { id: it.id, lo: it.y - h / 2, hi: it.y + h / 2 };
  });
  if (sec.valet) {
    const [lo, hi] = valetBand(sec);
    bands.push({ id: '__valet__', lo, hi });
  }
  return bands;
}

// Ближайшая ЛДСП-поверхность СНИЗУ от штанги — опора для вертикальной трубы-стойки (см.
// item.verticalSupport, задание «трубы вертикально»): полка, если она есть под штангой в этой же
// секции, иначе пол секции (физический, не полоса коллизии). Только полки — сетка/ящики/корзины
// не жёсткая ЛДСП-опора, к ним трубу не привязываем.
export function nearestSupportSurfaceY(sec, rodItem, fillBottomPhysical) {
  let best = fillBottomPhysical;
  sec.items.forEach(it => {
    if (it.type !== 'shelf' || it.id === rodItem.id) return;
    const top = it.y + itemPhysicalHeight('shelf', sec, it) / 2;
    if (top <= rodItem.y && top > best) best = top;
  });
  return best;
}

// Горизонтальные перемычки от вертикальной трубы-стойки к боковым стойкам (item.horizontalSupportLeft/
// Right, задание «трубы вертикально плюс») — ЛЕВАЯ и ПРАВАЯ полностью независимы (свой краб,
// своя высота стыка с вертикальной трубой — item.horizontalSupportLeftY/RightY, мышкой двигается
// пользователем от низа (опоры) до верха (штанги), с минимальным зазором с обеих сторон).
export const HORIZONTAL_SUPPORT_MARGIN = 30;

// Диапазон одинаковый для обеих сторон (обе крепятся к одной и той же вертикальной трубе) —
// но САМИ высоты (поле field — 'horizontalSupportLeftY' или 'horizontalSupportRightY') хранятся
// и двигаются раздельно.
export function horizontalSupportYRange(sec, rodItem, fillBottomPhysical) {
  const surfaceY = nearestSupportSurfaceY(sec, rodItem, fillBottomPhysical);
  return { lo: surfaceY + HORIZONTAL_SUPPORT_MARGIN, hi: rodItem.y - HORIZONTAL_SUPPORT_MARGIN };
}

// Подгоняет сохранённую высоту перемычки (поле field) под текущий диапазон (полка могла
// подвинуться/пропасть — см. nearestSupportSurfaceY) — назначает середину при первом включении,
// иначе клампит без изменения, если уже была выставлена мышкой.
export function clampHorizontalSupportY(sec, rodItem, fillBottomPhysical, field) {
  const { lo, hi } = horizontalSupportYRange(sec, rodItem, fillBottomPhysical);
  const mid = (lo + hi) / 2;
  if (rodItem[field] === undefined || hi < lo) {
    rodItem[field] = mid;
  } else {
    rodItem[field] = Math.min(Math.max(rodItem[field], lo), hi);
  }
}

// Пересекается ли кандидатная позиция (Y центра) элемента типа type с каким-либо другим
// элементом секции (кроме excludeId — самого себя при перетаскивании), с вешалом (если есть),
// или с границами секции (пол/потолок наполнения). Используется и во время драга (подсветка
// красным), и при поиске свободного места. Верхняя полка теперь ОБЫЧНЫЙ item (просто pinned —
// защищена от удаления в UI), отдельной границы для неё больше нет — валидный диапазон для
// любого элемента, включая её саму, это весь [fillBottom, fillTop].
export function checkOverlap(candidateY, type, excludeId, sec, fillBottom, fillTop, item = null) {
  const h = itemBandHeight(type, sec, item);
  const lo = candidateY - h / 2, hi = candidateY + h / 2;
  if (lo < fillBottom || hi > fillTop) return true;
  const pipeFillBottom = PIPE_BLOCKED_TYPES.has(type) ? fillBottom : undefined;
  return itemBands(sec, excludeId, pipeFillBottom).some(b => lo < b.hi && hi > b.lo);
}

// Ищет первый достаточный по высоте свободный промежуток снизу вверх (от пола до потолка
// наполнения секции) для элемента типа type. Возвращает Y центра или null, если свободного места
// не нашлось (вызывающий код должен показать тост).
export function findFreeSlot(sec, type, fillBottom, fillTop) {
  const h = itemBandHeight(type, sec);
  const pipeFillBottom = PIPE_BLOCKED_TYPES.has(type) ? fillBottom : undefined;
  const bands = itemBands(sec, null, pipeFillBottom).sort((a, b) => a.lo - b.lo);
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

// Полоса коллизии некоторых типов зависит от параметра, ОБЩЕГО на всю секцию, не индивидуального
// у item (sec.drawerHeight — высота фасада всех ящиков секции, sec.basketHeight — высота всех
// корзин): пользователь меняет его в панели (или толщину полки — 32мм по выделению в 3D) уже
// ПОСЛЕ того, как элементы расставлены — их y (центр) при этом не двигается, а полоса вокруг него
// вырастает на месте и может наехать на соседа. clampItemPositions такое не ловит (только пол/
// потолок секции, не соседей) — вызывается следом за ним при каждой сборке, раздвигает элементы
// снизу вверх на минимально необходимое, чтобы устранить пересечения. Один проход снизу-вверх +
// (если у потолка не хватило места) проход сверху-вниз — не идеальная упаковка, но для типичного
// «зазор чуть подрос» этого достаточно и результат предсказуем (ближайшие просто раздвигаются).
export function resolveBandOverlaps(sec, fillBottom, fillTop) {
  const order = sec.items.slice().sort((a, b) => a.y - b.y);
  let prevHi = fillBottom;
  order.forEach(item => {
    const h = itemBandHeight(item.type, sec, item);
    let lo = item.y - h / 2;
    if (lo < prevHi) item.y += prevHi - lo;
    prevHi = item.y + h / 2;
  });
  if (prevHi > fillTop) {
    let nextLo = fillTop;
    order.slice().reverse().forEach(item => {
      const h = itemBandHeight(item.type, sec, item);
      let hi = item.y + h / 2;
      if (hi > nextLo) item.y -= hi - nextLo;
      nextLo = item.y - h / 2;
    });
  }
}

// Дефолтный набор items для новой/пресетной секции — сперва структурная (pinned) верхняя полка
// (есть всегда, первая, защищена от удаления в UI — см. tabs.js), затем остальные полки/ящики по
// очереди в первое свободное место снизу вверх (findFreeSlot), штанга — отдельно (см. ниже).
// Общая функция для presets.js и tabs.js («Добавить секцию»), чтобы не дублировать расстановку.
// bounds — опциональное переопределение границ (см. mezzanineVerticalBounds в задаче «антресоли
// 19,07» — новая секция антресолей создаётся в СВОЕЙ зоне, не в основной).
export function defaultItemsForSection({ shelves = 0, drawers = 0, rod = 0, drawerHeight = 150, bounds } = {}) {
  const { fillBottom, fillTop } = bounds || sectionVerticalBounds();
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
  // Физические границы (без ±10мм зазора расстановки items из sectionVerticalBounds) — панель
  // должна реально доходить до пола/крыши секции, а не останавливаться за 10мм до них.
  const { fillBottom, fillTop } = sectionVerticalBoundsPhysical();
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

// ---------- фиксация просветов (sec.lockedGaps) ----------

// Просветы секции снизу вверх с ключом каждого (тот же порядок/границы, что и статичные
// размерные линии в dimensions.js — физические края элементов, БЕЗ служебных зазоров
// расстановки). Ключ — id элемента, ограничивающего просвет СВЕРХУ, либо 'ceiling' для самого
// верхнего (см. sec.lockedGaps в state.js). lockable=false у просветов, прилегающих к вешалу —
// у него нет своего item/id, двигать в цепочке нечего, фиксировать нельзя.
export function sectionGapsKeyed(sec, fillBottom, fillTop) {
  const bands = itemPhysicalBands(sec, null).sort((a, b) => a.lo - b.lo);
  const gaps = [];
  let cursor = fillBottom, prevId = null;
  bands.forEach(b => {
    if (b.lo - cursor > 1) {
      gaps.push({ lo: cursor, hi: b.lo, key: b.id, lockable: prevId !== '__valet__' && b.id !== '__valet__' });
    }
    cursor = Math.max(cursor, b.hi);
    prevId = b.id;
  });
  if (fillTop - cursor > 1) {
    gaps.push({ lo: cursor, hi: fillTop, key: 'ceiling', lockable: prevId !== '__valet__' });
  }
  return gaps;
}

// Каскад для одного двигаемого элемента с учётом зафиксированных просветов (sec.lockedGaps —
// галочки на статичных размерных линиях, см. renderStaticDimensions в dimensions.js): просвет,
// отмеченный галочкой, не должен меняться — вместо этого двигается следующий свободный элемент
// по цепочке в нужную сторону, пока не найдётся незафиксированный просвет (он поглощает сдвиг)
// либо цепочка не упрётся в пол/потолок секции или в вешало (сдвиг обрезается по месту упора —
// см. задание «фиксация размеров»). Считает по ПОЛОСАМ КОЛЛИЗИИ (itemBands), не физическим —
// чтобы результат не нарушал те же зазоры, что и обычное перетаскивание/checkOverlap.
// Возвращает { updates: [{id, y}] } — итоговые позиции элементов цепочки (сам itemId и все, кто
// сдвинулся вместе с ним); state не трогает, применение — на вызывающей стороне.
export function resolveLockedMove(sec, itemId, targetY, fillBottom, fillTop) {
  const order = itemBands(sec, null).sort((a, b) => a.lo - b.lo);
  const idx = order.findIndex(b => b.id === itemId);
  const item = sec.items.find(it => it.id === itemId);
  if (idx === -1 || !item) return { updates: [{ id: itemId, y: targetY }] };

  let delta = targetY - item.y;
  if (delta === 0) return { updates: [] };

  const locked = new Set(sec.lockedGaps || []);
  const keyBelow = i => order[i].id;                                          // просвет ПОД order[i]
  const keyAbove = i => (i + 1 < order.length ? order[i + 1].id : 'ceiling'); // просвет НАД order[i]

  let loIdx = idx;
  while (loIdx > 0 && order[loIdx - 1].id !== '__valet__' && locked.has(keyBelow(loIdx))) loIdx--;
  let hiIdx = idx;
  while (hiIdx < order.length - 1 && order[hiIdx + 1].id !== '__valet__' && locked.has(keyAbove(hiIdx))) hiIdx++;

  // Ни один соседний просвет не зафиксирован — цепочка не расширилась (loIdx/hiIdx остались на
  // самом itemId). Клампинг к соседу тут неуместен: обычное перетаскивание должно уметь
  // «перепрыгнуть» через соседний элемент в свободное место дальше (как было до фиксации
  // просветов) — единственное условие успеха, как раньше, пересечение в ИТОГОВОЙ позиции с
  // ЛЮБЫМ элементом секции (не только с ближайшим соседом), проверяем всей секцией целиком.
  if (loIdx === idx && hiIdx === idx) {
    if (checkOverlap(targetY, item.type, itemId, sec, fillBottom, fillTop, item)) return { updates: [] };
    return { updates: [{ id: itemId, y: targetY }] };
  }

  // Цепочка упёрлась в САМЫЙ пол/потолок секции, а просвет там всё равно зафиксирован — двигать
  // уже некого, этот просвет обязан остаться ровно тем же числом. Любой сдвиг (в ЛЮБУЮ сторону)
  // меняет расстояние цепочки до пола/потолка — значит сдвиг целиком запрещён, а не подрезается
  // «до упора», как со свободной незафиксированной границей.
  const frozen = (loIdx === 0 && locked.has(keyBelow(0)))
    || (hiIdx === order.length - 1 && locked.has(keyAbove(order.length - 1)));
  if (frozen) return { updates: [] };

  if (delta < 0) {
    let limit = fillBottom - order[loIdx].lo;
    if (loIdx > 0) limit = Math.max(limit, order[loIdx - 1].hi - order[loIdx].lo);
    delta = Math.max(delta, limit);
  } else {
    let limit = fillTop - order[hiIdx].hi;
    if (hiIdx < order.length - 1) limit = Math.min(limit, order[hiIdx + 1].lo - order[hiIdx].hi);
    delta = Math.min(delta, limit);
  }
  if (delta === 0) return { updates: [] };

  const updates = [];
  for (let i = loIdx; i <= hiIdx; i++) {
    const it = sec.items.find(x => x.id === order[i].id);
    updates.push({ id: order[i].id, y: it.y + delta });
  }
  return { updates };
}

// Если элемент (только что добавленный или перетащенный) оказался МЕЖДУ парой, чей просвет
// зафиксирован — просвет НАД парой автоматически «наследуется» новым соседом (ключ — id верхнего
// элемента пары, он не меняется), а вот новый НИЖНИЙ просвет остаётся незафиксированным по
// умолчанию — весь исходный промежуток перестаёт быть жёстким целиком, только его верхняя
// половина. Пользователь ожидает обратное: раз зафиксировали расстояние между парой, оно должно
// оставаться неизменным целиком, даже если между ними что-то добавили — так что если это
// произошло, дозафиксировываем и нижнюю половину тоже. Вызывать после любой фиксации новой
// позиции элемента (добавление, перетаскивание, ввод точного размера) — идемпотентно, если
// абсорбировать нечего, ничего не делает.
export function absorbIntoLockedGap(sec, itemId) {
  const locked = sec.lockedGaps;
  if (!locked || !locked.length) return;
  const order = itemBands(sec, null).sort((a, b) => a.lo - b.lo);
  const idx = order.findIndex(b => b.id === itemId);
  if (idx === -1) return;
  const aboveKey = idx + 1 < order.length ? order[idx + 1].id : 'ceiling';
  if (aboveKey === '__valet__') return;
  if (locked.includes(aboveKey) && !locked.includes(itemId)) locked.push(itemId);
}
