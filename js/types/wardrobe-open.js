import { state } from '../core/state.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';
import { buildWardrobeBox } from './_wardrobe-shared.js';

export default {
  id: 'wardrobe-open',
  name: 'Шкаф открытый',
  ctx: {
    variant: { extra: true },
    fill:    { sections: true, shelves: true, drawers: false, rod: true, color: true },
    fasad:   { available: true },
  },

  // Геометрия пока идентична шкафу-купе (открытый фасад ещё не реализован отдельно).
  build: buildWardrobeBox,

  areas() {
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
