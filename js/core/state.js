export const PANEL_THICKNESS = 16;

export let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], meshShelf: [], presets: [] };
export function setMaterials(m) { materials = m; }

export const state = {
  type: 'wardrobe',
  width: 1800, height: 2400, depth: 600,
  // Секции шкафа-купе — у каждой своя ширина (мм) и своё наполнение. Ширины должны в сумме
  // совпадать с внутренней шириной короба — за этим следит rebalanceSections() в _wardrobe-shared.js.
  // Каждая секция по умолчанию уже содержит верхнюю полку + штангу (см. _wardrobe-shared.js) —
  // верхняя полка всегда есть (не считается, не убирается, не входит в shelves) — она опорная
  // точка для штанги/жёсткости. shelves — ОБЩИЙ счётчик остальных полок (экспериментальная
  // модель на замену прежнему разделению shelvesTop/shelvesBottom/bottomShelf): первая полка
  // счётчика всегда рисуется на месте прежней "нижней" полки, остальные — по свободному
  // алгоритму (готовим почву под будущее перетаскивание полок мышкой). shelves: 0 = совсем без
  // нижней полки.
  // rod — количество штанг (0-2), а не флаг.
  // Ящики секции — по глубине вровень с внутренней перегородкой (за дверями купе), короб
  // (дно/боковины/задняя стенка) — наполнение/ЛДСП, фасад — отдельная лицевая панель.
  // drawerHeight — высота фасада (мм), drawerDepth — глубина короба (250-600, шаг 50),
  // drawerSoftClose — направляющие с доводчиком (по умолчанию true).
  // Сетчатые полки (metal mesh) — независимы от ящиков, тоже строятся снизу вверх, максимум 3шт
  // на секцию. Ширина всегда во всю секцию (как обычная полка, от стойки до стойки), а вот
  // глубина — фиксированный выбор 300/400/500мм (доступные варианты зависят от реальной глубины
  // короба, см. maxMeshDepth). Цена — за погонный метр, зависит от глубины и цвета (см. materials.json).
  // Торцевое вешало — выдвижная штанга-петля (телескопический рельс с П-образным прутком на
  // конце), крепится к низу верхней полки, тянется вдоль глубины. valet: 0/1 (есть/нет),
  // valetLength — заявленный размер (250-550, шаг 50), ограничен реальной доступной глубиной
  // (как и у сетчатой полки).
  // Сетчатые корзины (выкатные) — реальный типоразмерный ряд производителя, НЕ произвольные
  // размеры: basketWidth (300/400/500, поперёк секции) жёстко определяет набор допустимых
  // basketDepth (в шкаф) — 300→[400], 400→[400,450,500,550,600], 500→[500,550,600] — и
  // ОБЯЗАТЕЛЬНЫЙ проём (реальную ширину секции) = basketWidth + 23мм (зазор под направляющие):
  // 300→323, 400→423, 500→523. Если ширина секции не совпадает — корзину включать нельзя (см.
  // validateBasketFit в _wardrobe-shared.js), UI показывает тост и сбрасывает baskets на 0.
  // basketHeight — 120 или 190мм. Цвета: silver/white/black.
  // widthLocked — ручная фиксация ширины секции (галочка в UI): при добавлении/удалении других
  // секций эта ширина не трогается, ребаланс достаётся только незафиксированным секциям — тот же
  // механизм, что уже был у секций с корзинами (baskets > 0 тоже всегда фиксирован), просто
  // теперь можно закрепить ширину и без корзины. См. rebalanceSections/canAddSection.
  sections: [
    { width: 876, shelves: 1, drawers: 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true, rod: 1, meshShelves: 0, meshDepth: 400, meshColor: 'silver', valet: 0, valetLength: 400, baskets: 0, basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver', widthLocked: false },
    { width: 876, shelves: 1, drawers: 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true, rod: 1, meshShelves: 0, meshDepth: 400, meshColor: 'silver', valet: 0, valetLength: 400, baskets: 0, basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver', widthLocked: false },
  ],
  drawers: 0, // плоское значение для типов без секций (комод и т.п.)
  korpusProducer: null, korpusId: null,
  fasadProducer:  null, fasadId:  null,
  fillProducer:   null, fillId:   null,
  showDoors: true,
  backWall: 'none',           // none | ldsp | hdf
  plinthEnabled: true,
  plinthHeight: 50,
  noSideLeft: false,  leftReplace: 'planka',  leftBoxW: 66,
  noSideRight: false, rightReplace: 'planka', rightBoxW: 66,
  noCeiling: false,   topReplace: 'planka',   topBoxH: 66,
  noBottom: false,    bottomReplace: 'planka', bottomBoxH: 66,
  alignerLeft: false,  alignerLeftW: 50,
  alignerRight: false, alignerRightW: 50,
  alignerTop: false,   alignerTopH: 50,
  fasadDoorType: 'sliding',  // sliding | swing | none
  profile: 'standard',       // standard | slim | anod | black
  doorFill: 'ldsp',          // ldsp | mirror | glass
  doorFill2: null,           // null | ldsp | mirror | glass (комбо)
  glassType: 'clear',
};
