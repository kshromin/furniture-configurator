import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';

export default {
  id: 'chest',
  name: 'Комод',
  ctx: {
    variant: { extra: true },
    fill:    { sections: false, shelves: false, drawers: true, rod: false, color: false },
    fasad:   { available: true },
  },

  build() {
    const { width, height, depth, drawers } = state;
    const t = PANEL_THICKNESS;
    const kColor = getColor('korpus').color;
    const fColor = getColor('fasad').color;
    const dc = Math.max(1, drawers);

    addPanel(width, t, depth, kColor, [0, t / 2, 0]);
    addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
    addPanel(t, height - 2 * t, depth, kColor, [-width / 2 + t / 2, height / 2, 0]);
    addPanel(t, height - 2 * t, depth, kColor, [width / 2 - t / 2, height / 2, 0]);
    addPanel(width - 2 * t, height - 2 * t, 4, kColor, [0, height / 2, -depth / 2 + 2]);

    const gap = 4, iH = height - 2 * t, dh = (iH - gap * (dc + 1)) / dc;
    const iW = width - 2 * t - 10;
    for (let i = 0; i < dc; i++) {
      const y = t + gap + i * (dh + gap) + dh / 2;
      addPanel(iW, dh, t, fColor, [0, y, depth / 2 - t / 2]);
    }

    return { door: 0, drawer: dc, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
