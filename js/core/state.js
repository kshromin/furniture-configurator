// Толщина деталей ЛДСП: 16мм стандарт, 32мм — опция «в две плиты» (см. state.panel32).
// Живая ES-привязка: все модули читают PANEL_THICKNESS в рантайме внутри функций, поэтому
// syncPanelThickness() меняет толщину сразу во всей геометрии/расчётах без правки потребителей.
// Короба-замены и выравниватели от неё не зависят (у них собственные размеры).
export let PANEL_THICKNESS = 16;
export function syncPanelThickness() { PANEL_THICKNESS = state.panel32 ? 32 : 16; }

// Толщина конкретной корпусной детали: 32мм, если включён общий режим ИЛИ помечена эта деталь
// (state.thick32, галочки «Детали 32 мм» в Опциях). Ключи: left/right (стойки), top (крыша),
// bottom (дно), dividers (перегородки). Цоколь толщину не меняет (не панель ЛДСП в этом смысле).
// Полки — свой флаг на элементе (item.thick32, переключается по выделению полки в 3D).
export function detailT(key) {
  return (state.panel32 || state.thick32?.[key]) ? 32 : 16;
}

export let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], meshShelf: [], presets: [] };
export function setMaterials(m) { materials = m; }

// Стабильный id для наполнения секции (state.sections[i].items) — не индекс массива, т.к. на
// него ссылается вешало (valetAnchorId) и он должен пережить добавление/удаление СОСЕДНИХ
// элементов. crypto.randomUUID() доступен в secure context (https и localhost — сервер
// разработки всегда localhost).
export function newItemId() { return crypto.randomUUID(); }

// "Безопасный" снимок state — точка, после которой текущий дизайн можно спокойно потерять
// (только что добавлен в проект, или это ещё вообще ничего не менявшийся дефолт). Используется
// предупреждением при смене типа изделия (см. js/core/tabs.js bindTypeButtons) — пока baseline
// не выставлен явно (markStateSafe ещё не звали), считаем что предупреждать не о чем.
let lastSafeSnapshot = null;
export function markStateSafe() { lastSafeSnapshot = JSON.stringify(state); }
export function hasUnsavedChanges() {
  return lastSafeSnapshot !== null && JSON.stringify(state) !== lastSafeSnapshot;
}

export const state = {
  type: 'wardrobe',
  width: 1800, height: 2400, depth: 600,
  // Секции шкафа-купе — у каждой своя ширина (мм) и своё наполнение. Ширины должны в сумме
  // совпадать с внутренней шириной короба — за этим следит rebalanceSections() в _wardrobe-shared.js.
  // items — свободно перетаскиваемое мышкой наполнение секции (кроме вешала, см. ниже): плоский
  // список { id, type, y, pinned? }. type: 'shelf' | 'drawer' | 'mesh' | 'basket' | 'rod'. y —
  // Y-координата ЦЕНТРА полосы коллизии элемента, в той же локальной системе координат, что и
  // fillBottom/fillTop (_wardrobe-shared.js) — БЕЗ учёта y0 (смещение цоколя), он прибавляется
  // отдельно в момент рисования. id — стабильный (newItemId(), не индекс массива) — на него может
  // ссылаться вешало (valetAnchorId). Экземпляры одного типа в секции делят общие параметры
  // (см. ниже drawerHeight и т.д.) — индивидуальна только позиция. Перетаскивание, поиск
  // свободного места при добавлении и проверка пересечений — см. findFreeSlot/checkOverlap/
  // clampItemPositions в _wardrobe-shared.js и логику драга в js/core/itemDrag.js.
  // pinned: true — у ровно одной "структурной" верхней полки на каждую секцию (создаётся вместе
  // с остальными в defaultItemsForSection/тут). Обычный перетаскиваемый item (двигается вверх-
  // вниз вместе с планкой жёсткости — см. buildWardrobeBox), но UI не даёт её удалить (см.
  // tabs.js) — она нужна как опорная точка по умолчанию для штанги/вешала.
  //
  // Ящики секции — по глубине вровень с внутренней перегородкой (за дверями купе), короб
  // (дно/боковины/задняя стенка) — наполнение/ЛДСП, фасад — отдельная лицевая панель.
  // drawerHeight — высота фасада (мм), drawerDepth — глубина короба (250-600, шаг 50),
  // drawerSlideType — тип направляющих, один на всю секцию: 'ball' (шариковые, самые дешёвые,
  // без доводчика) / 'soft' (скрытые с доводчиком, по умолчанию) / 'push' (скрытые push) /
  // 'blum' (скрытые BLUM, самые дорогие). Цена зависит ещё и от длины (= глубина короба
  // ящика) — см. data/materials.json → drawerSlide (матрица тип×длина) и drawerSlideUnitPrice
  // в wardrobe.js.
  // Сетчатые полки (metal mesh) — ширина всегда во всю секцию (как обычная полка, от стойки до
  // стойки), а глубина — фиксированный выбор 300/400/500мм (доступные варианты зависят от
  // реальной глубины короба, см. availableMeshDepths). Цена — за погонный метр, зависит от
  // глубины и цвета (см. materials.json).
  // Торцевое вешало — выдвижная штанга-петля (телескопический рельс с П-образным прутком на
  // конце). valet: 0/1 (есть/нет), valetAnchorId — id полки из items, к которой оно крепится
  // (мышкой прыгает между полками, свободно не двигается); null = крепится к фиксированной
  // верхней полке (поведение по умолчанию). valetLength — заявленный размер (250-550, шаг 50),
  // ограничен реальной доступной глубиной (как и у сетчатой полки).
  // Сетчатые корзины (выкатные) — реальный типоразмерный ряд производителя, НЕ произвольные
  // размеры: basketWidth (300/400/500, поперёк секции) жёстко определяет набор допустимых
  // basketDepth (в шкаф) — 300→[400], 400→[400,450,500,550,600], 500→[500,550,600] — и
  // ОБЯЗАТЕЛЬНЫЙ проём (реальную ширину секции) = basketWidth + 23мм (зазор под направляющие):
  // 300→323, 400→423, 500→523. Если ширина секции не совпадает — корзину включать нельзя (см.
  // basketFits в _wardrobe-shared.js), UI показывает тост и убирает корзины из items.
  // basketHeight — 120 или 190мм. Цвета: silver/white/black.
  // widthLocked — ручная фиксация ширины секции (галочка в UI): при добавлении/удалении других
  // секций эта ширина не трогается, ребаланс достаётся только незафиксированным секциям — тот же
  // механизм, что уже был у секций с корзинами (baskets > 0 тоже всегда фиксирован), просто
  // теперь можно закрепить ширину и без корзины. См. rebalanceSections/canAddSection.
  // backWallSegments — посегментная задняя стенка (ЛДСП), АЛЬТЕРНАТИВА общей state.backWall на
  // весь шкаф целиком — действует только когда state.backWall === 'none' (это два взаимоисключающих
  // режима, не комбинируются). Секция делится на сегменты по полкам (пол-полка, полка-полка,
  // полка-потолок — разрез ровно по центру толщины полки), задняя стенка ставится независимо в
  // каждом. Массив — id ВКЛЮЧЁННЫХ сегментов: 'floor' (нижний, от пола секции до первой полки)
  // либо id конкретной полки (сегмент от неё до следующей границы вверх) — см.
  // sectionBackWallSegments в wardrobe-items.js. Сегмент можно включить, только если хотя бы одна
  // его граница — реальная ЛДСП-панель (полка всегда подходит; пол/потолок секции — только если
  // не сняты «без дна»/«без крыши», см. eligible в той же функции).
  //
  // lockedGaps — зафиксированные просветы между элементами секции (галочка на статичной размерной
  // линии, см. renderStaticDimensions в dimensions.js). Массив ключей просветов: id элемента,
  // который ограничивает просвет СВЕРХУ, либо 'ceiling' для самого верхнего (между последним
  // элементом и потолком секции) — см. sectionGapsKeyed в wardrobe-items.js. Зафиксированный
  // просвет не меняется, когда пользователь двигает/меняет размер соседнего — вместо этого
  // двигается следующий свободный элемент по цепочке (см. resolveLockedMove).
  //
  // Дефолтные Y ниже (276/1704 обычная полка+штанга, 1774 структурная pinned-полка) посчитаны
  // вручную по формулам из _wardrobe-shared.js для дефолтных габаритов (2400×600, цоколь 50, без
  // выравнивателей/коробов) — чтобы первая отрисовка до применения пресета выглядела как раньше.
  // clampItemPositions подстрахует, если дефолтные габариты когда-нибудь изменятся.
  sections: [
    {
      width: 876,
      items: [
        { id: 'default-shelf-1', type: 'shelf', y: 276 },
        { id: 'default-top-shelf-1', type: 'shelf', y: 1774, pinned: true },
        { id: 'default-rod-1', type: 'rod', y: 1704 },
      ],
      drawerHeight: 150, drawerDepth: 500, drawerSlideType: 'soft',
      meshDepth: 400, meshColor: 'silver',
      valet: 0, valetAnchorId: null, valetLength: 400,
      basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver',
      widthLocked: false,
      backWallSegments: [],
      lockedGaps: [],
    },
    {
      width: 876,
      items: [
        { id: 'default-shelf-2', type: 'shelf', y: 276 },
        { id: 'default-top-shelf-2', type: 'shelf', y: 1774, pinned: true },
        { id: 'default-rod-2', type: 'rod', y: 1704 },
      ],
      drawerHeight: 150, drawerDepth: 500, drawerSlideType: 'soft',
      meshDepth: 400, meshColor: 'silver',
      valet: 0, valetAnchorId: null, valetLength: 400,
      basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver',
      widthLocked: false,
      backWallSegments: [],
      lockedGaps: [],
    },
  ],
  drawers: 0, // плоское значение для типов без секций (комод и т.п.)
  // Антресоли (задание «антресоли 19,07») — верхняя зона шкафа без стоек, отделённая от основных
  // секций одной сплошной полкой (не входит ни в чьи items — общая на весь короб, см.
  // mezzanineShelfY в wardrobe-items.js). Включение "съедает" mezzanineHeight мм с верху общего
  // наполнения (sectionVerticalBounds в wardrobe-items.js становится mezzanine-aware — фактическая
  // высота зажимается между MEZZANINE_MIN_HEIGHT и (общая высота - MEZZANINE_MIN_MAIN_ZONE), см.
  // там же). mezzanineSections — та же форма записи, что и sections, но без drawer/basket в items
  // (UI не предлагает эти типы для антресолей, см. tabs.js) — своя независимая ширинная раскладка
  // на той же горизонтали (innerSpanW), свои перегородки от полки до крыши.
  mezzanineEnabled: false,
  mezzanineHeight: 400,
  mezzanineSections: [],
  // Размерные линии наполнения (просвет между соседними элементами секции) — HTML-оверлей
  // поверх 3D-вида, см. js/core/dimensions.js. Глобальный чекбокс + по-секционный (sec.
  // showDimensions, undefined трактуется как true — не пишем в дефолтные секции, чтобы не
  // раздувать их лишним полем).
  showDimensions: true,
  korpusProducer: null, korpusId: null,
  fasadProducer:  null, fasadId:  null,
  fillProducer:   null, fillId:   null,
  showDoors: true,
  panel32: false,             // true = все детали ЛДСП 32мм (цена ×2, кромка ×3)
  thick32: { left: false, right: false, top: false, bottom: false, dividers: false },
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
  doorCount: null,           // null = авто; число — выбор пользователя (если допустим для пролёта)
  // Двери купе (задание «двери-начали 20,07»): профиль и его цвет — ОБЩИЕ на все двери шкафа
  // (меняются синхронно, в т.ч. из окна комбинированной двери), каталог видов/цветов/цен —
  // data/materials.json → slidingDoor. Наполнение по умолчанию — тоже общее; индивидуальные
  // перемычки/наполнение секций конкретной двери появятся в окне «Комбинированная дверь».
  profile: 'closed',         // open | closed | slim | slimbox | widebox
  profileColor: 'silver',    // silver | black | white | gold | bronze
  doorFill: 'ldsp',          // ldsp | mirror | special
  specialFillPrice: 3000,    // ₽/м² «цвета специального» — пользователь вводит сам
};
