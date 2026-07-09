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
    fill:    { sections: false, shelves: false, drawers: false, rod: false, color: true, list: true },
    fasad:   { available: true },
  },

  build: buildWardrobeBox,

  areas() {
    const { width, depth, sections, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
    const t = PANEL_THICKNESS;
    const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
    const height = state.height - plinthH;

    const { spanW, leftOff, rightOff, topOff, bottomOff } = effectiveDoorSpan();
    const stojkaH = height - topOff - bottomOff;

    let korpusM2 = korpusBoxAreaM2(sections.length - 1, height, {
      top: noCeiling, bottom: noBottom, left: noSideLeft, right: noSideRight,
    }, stojkaH);
    if (plinthH > 0) {
      korpusM2 += (width * (depth - 40)) / 1e6; // цоколь — тот же материал, что корпус
    }

    const dc = getDoorCount(spanW);
    const gap = 4;
    const dw = (spanW + (dc - 1) * DOOR_OVERLAP) / dc;
    const doorH = height - topOff - bottomOff - TOP_RAIL_HEIGHT - BOTTOM_RAIL_HEIGHT - 2 * gap;
    const fasadM2 = (dc * dw * doorH) / 1e6;

    // Площадь коробов и планок (материал — корпус)
    const H = state.height;
    function elemM2(noSide, replace, boxW, isHoriz) {
      if (!noSide || replace === 'none') return 0;
      const w = replace === 'box' ? boxW : t;
      return isHoriz
        ? (width * w * 2 + width * DOOR_DEPTH_ZONE + w * DOOR_DEPTH_ZONE * 2) / 1e6
        : (w * H * 2 + w * DOOR_DEPTH_ZONE * 2 + H * DOOR_DEPTH_ZONE) / 1e6;
    }
    const leftBoxM2   = elemM2(state.noSideLeft,  state.leftReplace,   state.leftBoxW,   false);
    const rightBoxM2  = elemM2(state.noSideRight, state.rightReplace,  state.rightBoxW,  false);
    const topBoxM2    = elemM2(state.noCeiling,   state.topReplace,    state.topBoxH,    true);
    const bottomBoxM2 = elemM2(state.noBottom,    state.bottomReplace, state.bottomBoxH, true);

    // Выравнивающие элементы — та же геометрия, что и addPanel в buildWardrobeBox
    const alignerM2 =
      (state.alignerLeft  ? (state.alignerLeftW  * stojkaH) / 1e6 : 0) +
      (state.alignerRight ? (state.alignerRightW * stojkaH) / 1e6 : 0) +
      (state.alignerTop   ? (width * state.alignerTopH) / 1e6 : 0);

    let fillM2 = 0;
    const innerDepth = depth - DOOR_DEPTH_ZONE;
    sections.forEach(sec => {
      const sw = sec.width - 10;
      if (sec.drawers > 0) {
        const blkH = Math.min(700, (height - topOff - bottomOff - 20) * 0.4);
        fillM2 += (sw * blkH) / 1e6;
      }
      if (sec.shelves > 0) {
        fillM2 += (sec.shelves * sw * innerDepth) / 1e6;
      }
    });

    const backWallM2 = state.backWall !== 'none'
      ? ((width - leftOff - rightOff) * stojkaH) / 1e6
      : 0;

    return { korpusM2: korpusM2 + leftBoxM2 + rightBoxM2 + topBoxM2 + bottomBoxM2 + alignerM2, fasadM2, fillM2, backWallM2 };
  },

  describe() {
    const { sections } = state;
    const totalShelves = sections.reduce((s, sec) => s + sec.shelves, 0);
    const totalDrawers = sections.reduce((s, sec) => s + sec.drawers, 0);
    const hasRod = sections.some(sec => sec.rod);
    return `, секций: ${sections.length}, полок: ${totalShelves}, ящиков: ${totalDrawers}, штанга: ${hasRod ? 'да' : 'нет'}`;
  },
};
