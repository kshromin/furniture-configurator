import { state } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';

export default {
  id: 'parts',
  name: 'Детали',
  ctx: {
    variant: { extra: false },
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: false },
    fasad:   { available: false },
  },

  build() {
    const { width, height, depth } = state;
    const kColor = getColor('korpus').color;
    addPanel(width, height, depth, kColor, [0, height / 2, 0]);
    return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
