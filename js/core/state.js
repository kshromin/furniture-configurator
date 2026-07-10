export const PANEL_THICKNESS = 16;

export let materials = { korpus: { producers: [] }, fasad: { producers: [] }, fill: { producers: [] }, fittings: [], presets: [] };
export function setMaterials(m) { materials = m; }

export const state = {
  type: 'wardrobe',
  width: 1800, height: 2400, depth: 600,
  // Секции шкафа-купе — у каждой своя ширина (мм) и своё наполнение. Ширины должны в сумме
  // совпадать с внутренней шириной короба — за этим следит rebalanceSections() в _wardrobe-shared.js.
  // Каждая секция по умолчанию уже содержит верхнюю полку + штангу (см. _wardrobe-shared.js) —
  // shelvesTop/shelvesBottom считают ТОЛЬКО дополнительные полки сверх опорных верхней/нижней.
  // Верхняя полка всегда есть (не считается, не убирается) — она опорная точка для штанги/жёсткости.
  // Нижняя полка, в отличие от верхней, съёмная — bottomShelf: 1 (есть) / 0 (убрана).
  // rod — количество штанг (0-2), а не флаг.
  // Ящики секции — по глубине вровень с внутренней перегородкой (за дверями купе), короб
  // (дно/боковины/задняя стенка) — наполнение/ЛДСП, фасад — отдельная лицевая панель.
  // drawerHeight — высота фасада (мм), drawerDepth — глубина короба (250-600, шаг 50),
  // drawerSoftClose — направляющие с доводчиком (по умолчанию true).
  sections: [
    { width: 876, shelvesTop: 0, shelvesBottom: 0, bottomShelf: 1, drawers: 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true, rod: 1 },
    { width: 876, shelvesTop: 0, shelvesBottom: 0, bottomShelf: 1, drawers: 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true, rod: 1 },
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
