import { state, PANEL_THICKNESS } from '../core/state.js';
import { korpusBoxAreaM2 } from '../core/pricing.js';
import { buildWardrobeBox, getDoorCount, DOOR_DEPTH_ZONE, DOOR_OVERLAP } from './_wardrobe-shared.js';

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
    const { width, depth, sections, shelves, drawers, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
    const t = PANEL_THICKNESS;
    const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
    const height = state.height - plinthH;

    let korpusM2 = korpusBoxAreaM2(sections - 1, height, {
      top: noCeiling, bottom: noBottom, left: noSideLeft, right: noSideRight,
    });
    if (plinthH > 0) {
      korpusM2 += (width * (depth - 40)) / 1e6; // цоколь — тот же материал, что корпус
    }

    const dc = getDoorCount(width);
    const gap = 4;
    const span = width - 2 * t; // от стойки до стойки, как в buildWardrobeBox
    const dw = (span + (dc - 1) * DOOR_OVERLAP) / dc;
    const fasadM2 = (dc * dw * (height - 2 * gap)) / 1e6;

    let fillM2 = 0;
    const innerWidth = width - 2 * t;
    const sw = (innerWidth - (sections - 1) * t) / sections - 10;
    if (drawers > 0) {
      const blkH = Math.min(700, (height - 2 * t - 20) * 0.4);
      fillM2 += (sections * sw * blkH) / 1e6;
    }
    if (shelves > 0) {
      const innerDepth = depth - DOOR_DEPTH_ZONE;
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
