import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel } from '../core/scene.js';
import { getColor } from '../core/materials.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';

export default {
  id: 'wardrobe-room',
  name: 'Гардероб',
  ctx: {
    variant: { extra: true },
    fill:    { sections: true, shelves: true, drawers: false, rod: true, color: true },
    fasad:   { available: false },
  },

  // Гардероб — пока заглушка: три стены-секции буквой П
  build() {
    const { width, height, depth } = state;
    const t = PANEL_THICKNESS;
    const kColor = getColor('korpus').color;
    const sideDepth = Math.round(width * 0.4);

    addPanel(width, height, t, kColor, [0, height / 2, -depth / 2]);
    addPanel(t, height, sideDepth, kColor, [-width / 2 + t / 2, height / 2, sideDepth / 2 - depth / 2]);
    addPanel(t, height, sideDepth, kColor, [width / 2 - t / 2, height / 2, sideDepth / 2 - depth / 2]);
    addPanel(width, t, sideDepth, kColor, [0, height - t / 2, sideDepth / 2 - depth / 2]);

    return { door: 0, drawer: 0, shelf: 0, rod: 0, item: 1 };
  },

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
