import { state, PANEL_THICKNESS } from '../core/state.js';
import { korpusBoxAreaM2 } from '../core/pricing.js';
import {
  buildWardrobeBox, getDoorCount, effectiveDoorSpan,
  DOOR_DEPTH_ZONE, DOOR_OVERLAP, TOP_RAIL_HEIGHT, BOTTOM_RAIL_HEIGHT,
} from './_wardrobe-shared.js';

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

    const { spanW, topOff } = effectiveDoorSpan();
    const dc = getDoorCount(spanW);
    const gap = 4;
    const dw = (spanW + (dc - 1) * DOOR_OVERLAP) / dc;
    const doorH = height - topOff - t - TOP_RAIL_HEIGHT - BOTTOM_RAIL_HEIGHT - 2 * gap;
    const fasadM2 = (dc * dw * doorH) / 1e6;

    // Площадь коробов (материал — корпус)
    const leftBoxM2  = (state.noSideLeft  && state.leftReplace  === 'box') ? (state.leftBoxW  * state.height * 2 + state.leftBoxW  * DOOR_DEPTH_ZONE * 2 + state.height * DOOR_DEPTH_ZONE) / 1e6 : 0;
    const rightBoxM2 = (state.noSideRight && state.rightReplace === 'box') ? (state.rightBoxW * state.height * 2 + state.rightBoxW * DOOR_DEPTH_ZONE * 2 + state.height * DOOR_DEPTH_ZONE) / 1e6 : 0;
    const topBoxM2   = (state.noCeiling   && state.topReplace   === 'box') ? (width * state.topBoxH * 2 + width * DOOR_DEPTH_ZONE + state.topBoxH * DOOR_DEPTH_ZONE * 2) / 1e6 : 0;

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

    return { korpusM2: korpusM2 + leftBoxM2 + rightBoxM2 + topBoxM2, fasadM2, fillM2, backWallM2 };
  },

  describe() {
    const { sections, shelves, drawers, rod } = state;
    return `, секций: ${sections}, полок: ${shelves}, ящиков: ${drawers}, штанга: ${rod ? 'да' : 'нет'}`;
  },
};
