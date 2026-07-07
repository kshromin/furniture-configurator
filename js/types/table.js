import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';

export default {
  id: 'table',
  name: 'Стол',
  ctx: {
    variant: { extra: false },
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: false },
    fasad:   { available: false },
  },

  build() {
    const { width, height, depth } = state;
    const t = PANEL_THICKNESS;
    const kColor = getColor('korpus').color;
    const legH = height - t;
    const legD = 40;

    addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
      addPanel(legD, legH, legD, kColor, [
        sx * (width / 2 - legD / 2 - 20),
        legH / 2,
        sz * (depth / 2 - legD / 2 - 20),
      ]);
    });

    return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
