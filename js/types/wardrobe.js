import { state, PANEL_THICKNESS } from '../core/state.js';
import { korpusBoxAreaM2 } from '../core/pricing.js';
import { buildWardrobeBox, getDoorCount } from './_wardrobe-shared.js';

export default {
  id: 'wardrobe',
  name: 'Шкаф-купе',
  ctx: {
    variant: { doors: true, extra: true },
    fill:    { sections: true, shelves: true, drawers: true, rod: true, color: true },
    fasad:   { available: true },
  },

  build: buildWardrobeBox,

  areas() {
    const { width, height, depth, sections, shelves, drawers } = state;
    const t = PANEL_THICKNESS;

    const korpusM2 = korpusBoxAreaM2(sections - 1);

    const dc = getDoorCount(width);
    const gap = 4;
    const dw = (width - gap * (dc + 1)) / dc;
    const fasadM2 = (dc * dw * (height - 2 * gap)) / 1e6;

    let fillM2 = 0;
    const innerWidth = width - 2 * t;
    const sw = (innerWidth - (sections - 1) * t) / sections - 10;
    if (drawers > 0) {
      const blkH = Math.min(700, (height - 2 * t - 20) * 0.4);
      fillM2 += (sections * sw * blkH) / 1e6;
    }
    if (shelves > 0) {
      const innerDepth = depth - 60;
      fillM2 += (sections * shelves * sw * innerDepth) / 1e6;
    }

    const backWallM2 = state.backWall !== 'none'
      ? ((width - 2 * t) * (height - 2 * t)) / 1e6
      : 0;

    return { korpusM2, fasadM2, fillM2, backWallM2 };
  },

  describe() {
    const { sections, shelves, drawers, rod } = state;
    return `, секций: ${sections}, полок: ${shelves}, ящиков: ${drawers}, штанга: ${rod ? 'да' : 'нет'}`;
  },
};
