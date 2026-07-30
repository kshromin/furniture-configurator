import { state } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { DOOR_DEPTH_ZONE } from './wardrobe-constants.js';
import { buildDoorRow, lastBuildDoorLayout } from './wardrobe-geometry.js';
import { effectiveDoorSpan } from './wardrobe-sizing.js';
import { slidingDoorUnitPrice, swingDoorUnitPrice, profileRate } from './wardrobe.js';

// Тип «Двери купе» — самостоятельное изделие: только двери (купе/распашные) + выравнивающие элементы
// из ЛДСП по периметру проёма. Двери и весь дверной ряд (профили, направляющие, распашные ≤2 с
// лимитами размеров, драг/выделение) переиспользуются из шкафа-купе через buildDoorRow. Периметр —
// те же поля состояния *Replace/*Box*, что и «замены сторон» у шкафа, но здесь рисуются всегда
// (у чистых дверей нет корпуса, который надо «убирать»). Размеры периметра и пролёт двери берём из
// общей effectiveDoorSpan (тип-осведомлённая: для sliding-doors периметр активен всегда).

export default {
  id: 'sliding-doors',
  name: 'Двери купе',
  ctx: {
    variant: { doors: true, perimeter: true }, // Внешнее: кол-во дверей + периметр
    fill:    {},                               // Внутреннее: пусто (наполнения нет)
    fasad:   { available: true },              // Фасад: сами двери (профиль/цвет/наполнение)
  },

  build() {
    const { width, height } = state;
    const kColor = getColor('korpus').color;   // цвет ЛДСП выравнивателей
    const fColor = getColor('fasad').color;    // цвет наполнения дверей (ЛДСП-фасад)
    const zone = DOOR_DEPTH_ZONE;              // глубина «изделия» = дверная зона

    // Периметр и пролёт — из общей effectiveDoorSpan (та же модель, что у счётчика дверей и допусков)
    const { spanW, leftOff: lW, rightOff: rW, topOff: tH, bottomOff: bH } = effectiveDoorSpan();

    if (lW) addPanel(lW, height, zone, kColor, [-width / 2 + lW / 2, height / 2, 0]);
    if (rW) addPanel(rW, height, zone, kColor, [ width / 2 - rW / 2, height / 2, 0]);
    const innerW  = Math.max(0, spanW);
    const innerCX = -width / 2 + lW + innerW / 2;
    if (tH) addPanel(innerW, tH, zone, kColor, [innerCX, height - tH / 2, 0]);
    if (bH) addPanel(innerW, bH, zone, kColor, [innerCX, bH / 2, 0]);

    // Двери — общий дверной ряд шкафа (купе/распашные + драг/выделение) в проёме между выравнивателями
    const doorCount = buildDoorRow({
      spanW: innerW, spanCenterX: innerCX,
      y0: 0, height, topOff: tH, bottomOff: bH,
      depth: zone, fColor,
    });

    return { door: doorCount, drawer: 0, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    const { height } = state;
    const { spanW, leftOff: lW, rightOff: rW, topOff: tH, bottomOff: bH } = effectiveDoorSpan();
    // ЛДСП выравнивателей — по площади (тариф корпуса).
    const alignerM2 = ((lW + rW) * height + (tH + bH) * Math.max(0, spanW)) / 1e6;
    // Цена дверей — теми же per-door функциями, что у шкафа (профиль + наполнение), + направляющая
    // на весь проём. Полотна считаются как наполнение (doorFillPrice), НЕ как плоский фасад (fasadM2=0).
    // Раскладку (doorW/doorH/число) берём из lastBuildDoorLayout — build() отработал перед areas().
    let doorFillPrice = 0, doorHardwarePrice = 0;
    const L = lastBuildDoorLayout;
    if (L && L.xs.length) {
      const sliding = state.fasadDoorType === 'sliding';
      for (let i = 0; i < L.xs.length; i++) {
        const u = sliding ? slidingDoorUnitPrice(i, L.doorW, L.doorH) : swingDoorUnitPrice(i, L.doorW, L.doorH);
        doorFillPrice += u.fill;
        doorHardwarePrice += u.profile + (sliding ? u.rollers : u.kit);
      }
      if (sliding) doorHardwarePrice += (spanW / 1000) * profileRate('track');
    }
    return { korpusM2: alignerM2, fasadM2: 0, fillM2: 0, doorFillPrice, doorHardwarePrice };
  },

  describe() {
    return '';
  },
};
