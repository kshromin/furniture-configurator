import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';
import { getDoorCount } from './_wardrobe-shared.js';

export default {
  id: 'sliding-doors',
  name: 'Двери купе',
  ctx: {
    variant: { extra: false },
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: false },
    fasad:   { available: true },
  },

  build() {
    const { width, height } = state;
    const t = PANEL_THICKNESS;
    const fColor = getColor('fasad').color;
    const doorCount = getDoorCount(width);
    const gap = 4;
    const doorW = (width - gap * (doorCount + 1)) / doorCount;

    // верхняя и нижняя направляющие
    const kColor = getColor('korpus').color;
    addPanel(width, t, 40, kColor, [0, height - t / 2, 0]);
    addPanel(width, t, 40, kColor, [0, t / 2, 0]);

    // полотна дверей (два слоя для имитации купе)
    for (let i = 0; i < doorCount; i++) {
      const x = -width / 2 + gap + doorW / 2 + i * (doorW + gap);
      const zOffset = i % 2 === 0 ? 0 : t + 6;
      addPanel(doorW, height - 2 * gap, t, fColor, [x, height / 2, zOffset]);
    }

    return { door: doorCount, drawer: 0, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
