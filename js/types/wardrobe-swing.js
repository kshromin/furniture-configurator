import { state } from '../core/state.js';
import { korpusBoxAreaM2, defaultFasadAreaM2 } from '../core/pricing.js';
import { buildWardrobeBox } from './_wardrobe-shared.js';

export default {
  id: 'wardrobe-swing',
  name: 'Шкаф распашной',
  ctx: {
    variant: { extra: true },
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: true, list: true },
    fasad:   { available: true },
  },

  // Геометрия пока идентична шкафу-купе (распашные двери ещё не реализованы отдельно).
  build: buildWardrobeBox,

  areas() {
    // В отличие от wardrobe.js — здесь не считаются перегородки секций и наполнение (унаследовано от старой цены-заглушки).
    return { korpusM2: korpusBoxAreaM2(0), fasadM2: defaultFasadAreaM2(), fillM2: 0 };
  },

  describe() {
    return `, ящиков: ${Math.max(1, state.drawers)}`;
  },
};
