import { state, materials, PANEL_THICKNESS } from '../core/state.js';
import { korpusBoxAreaM2 } from '../core/pricing.js';
import {
  buildWardrobeBox, getDoorCount, effectiveDoorSpan, drawerBoxSize, basketFits, sectionMissingSideSupport,
  DOOR_DEPTH_ZONE, DOOR_OVERLAP, TOP_RAIL_HEIGHT, BOTTOM_RAIL_HEIGHT, STIFFENER_HEIGHT,
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

    const {
      spanW, topOff, bottomOff,
      stojkaTopOff, stojkaBottomOff, stojkaLeftOff, stojkaRightOff,
    } = effectiveDoorSpan();
    const stojkaH = height - stojkaTopOff - stojkaBottomOff;

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
    let fasadM2 = (dc * dw * doorH) / 1e6;

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

    function meshPricePerM(depth, color) {
      const entry = (materials.meshShelf || []).find(m => m.depth === depth && m.color === color);
      return entry ? entry.pricePerM : 0;
    }

    // Сетчатая корзина — готовое изделие фиксированного типоразмера (ширина/глубина/высота/цвет),
    // цена за штуку берётся из каталога, а не считается по площади/погонному метру.
    function basketUnitPrice(width, depth, height, color) {
      const entry = (materials.basket || []).find(b => b.width === width && b.depth === depth && b.height === height && b.color === color);
      return entry ? entry.price : 0;
    }

    let fillM2 = 0, meshPrice = 0, basketPrice = 0;
    const innerDepth = depth - DOOR_DEPTH_ZONE;
    // Наполнение секции теперь свободно перетаскиваемые items (см. state.js), а не счётчики —
    // считаем штуки по типу; общие на тип параметры (высота/глубина/цвет) не изменились.
    const countOf = (sec, type) => sec.items.filter(it => it.type === type).length;

    // Кромка (ПВХ-лента по видимым торцам ЛДСП, см. data/materials.json edgeBanding) — считаем
    // каждый реально оклеиваемый торец, с учётом того, что скрыто в стыках/у стены:
    // - крыша/дно: передний торец (ширина короба) + левый/правый торец (глубина короба) —
    //   у крыши/дна есть боковые срезы помимо переднего.
    // - боковые стойки, перегородки между секциями: только передний торец (высота стойки) —
    //   задний у стены/в примыкании, не оклеивается.
    // - планка/короб, заменяющие снятую стойку/крышу/дно: ДВА торца (наружный+внутренний) — это
    //   отдельная накладка в дверной зоне, ничем не прикрыта ни спереди, ни изнутри, в отличие
    //   от настоящей стойки, у которой задний торец упирается в стену.
    // - полки: передний торец на ширину своей секции.
    let edgeLengthMm = 0;
    if (!noCeiling)   edgeLengthMm += width + 2 * depth;
    if (!noBottom)    edgeLengthMm += width + 2 * depth;
    if (!noSideLeft)  edgeLengthMm += stojkaH;
    if (!noSideRight) edgeLengthMm += stojkaH;
    edgeLengthMm += (sections.length - 1) * stojkaH; // перегородки между секциями — всегда есть

    function replaceEdgeLength(noSide, replace, span) {
      return (noSide && replace !== 'none') ? 2 * span : 0;
    }
    edgeLengthMm += replaceEdgeLength(state.noSideLeft,  state.leftReplace,   H);
    edgeLengthMm += replaceEdgeLength(state.noSideRight, state.rightReplace,  H);
    edgeLengthMm += replaceEdgeLength(state.noCeiling,   state.topReplace,    width);
    edgeLengthMm += replaceEdgeLength(state.noBottom,    state.bottomReplace, width);

    sections.forEach((sec, s) => {
      // Без зазора — совпадает с геометрией в buildWardrobeBox.
      const sw = sec.width;
      // Без опоры по бокам (см. sectionMissingSideSupport) ящики не ставятся — только в той
      // крайней секции, где реально сняли стойку, не во всех сразу — см. buildWardrobeBox.
      const drawerCount = sectionMissingSideSupport(sections, s) ? 0 : countOf(sec, 'drawer');
      if (drawerCount > 0) {
        // Фасад ящика — в площадь фасадов; короб (дно+2 боковины+задняя стенка) — в наполнение/ЛДСП.
        fasadM2 += (drawerCount * sw * sec.drawerHeight) / 1e6;
        const { boxW, boxH, boxDepth } = drawerBoxSize(sw, sec.drawerHeight, sec.drawerDepth, depth);
        const boxM2 = boxW * boxDepth + 2 * boxH * boxDepth + boxW * boxH;
        fillM2 += (drawerCount * boxM2) / 1e6;
        // Кромка ящика: фасад целиком по периметру; у короба — дно без кромки (скрыто в стыке),
        // боковины оклеены с трёх сторон (верх+перед+зад — не оклеен только низ, в стыке с
        // дном), задняя стенка — только верхний торец (левый/правый/нижний скрыты в стыках с
        // боковинами и дном).
        const facadeEdge = 2 * (sw + sec.drawerHeight);
        const sideWallsEdge = 2 * (boxDepth + 2 * boxH);
        const backWallEdge = boxW;
        edgeLengthMm += drawerCount * (facadeEdge + sideWallsEdge + backWallEdge);
      }
      // Сетчатые полки — цена за погонный метр (ширина секции), а не за м², зависит от
      // выбранной глубины и цвета (см. materials.json meshShelf).
      const meshCount = countOf(sec, 'mesh');
      if (meshCount > 0) {
        meshPrice += meshCount * (sw / 1000) * meshPricePerM(sec.meshDepth, sec.meshColor);
      }
      // Сетчатые корзины — как ящики, нужна опора по бокам и точное совпадение ширины секции с
      // обязательным проёмом (basketFits) — иначе корзина физически не встанет (см. state.js).
      const basketCount = (sectionMissingSideSupport(sections, s) || !basketFits(sec)) ? 0 : countOf(sec, 'basket');
      if (basketCount > 0) {
        basketPrice += basketCount * basketUnitPrice(sec.basketWidth, sec.basketDepth, sec.basketHeight, sec.basketColor);
      }
      // Полки (верхняя структурная — тоже обычный item типа shelf, отдельно не считается, см.
      // _wardrobe-shared.js) плюс планка жёсткости (если задняя стенка не ЛДСП, висит от
      // структурной полки).
      if (state.backWall !== 'ldsp') fillM2 += (sw * STIFFENER_HEIGHT) / 1e6; // жёсткость — вертикальная пластина, площадь ширина×высота
      const shelfCount = countOf(sec, 'shelf');
      fillM2 += (shelfCount * sw * innerDepth) / 1e6;
      edgeLengthMm += shelfCount * sw; // передний торец каждой полки — на всю ширину секции
    });

    const backWallM2 = state.backWall !== 'none'
      ? ((width - stojkaLeftOff - stojkaRightOff) * stojkaH) / 1e6
      : 0;

    return {
      korpusM2: korpusM2 + leftBoxM2 + rightBoxM2 + topBoxM2 + bottomBoxM2 + alignerM2,
      fasadM2, fillM2, backWallM2, meshPrice, basketPrice,
      edgeLengthM: edgeLengthMm / 1000,
    };
  },

  describe() {
    const { sections } = state;
    const countOf = (sec, type) => sec.items.filter(it => it.type === type).length;
    // Верхняя (структурная) полка — теперь тоже обычный item типа shelf, отдельно не считается.
    const totalShelves = sections.reduce((s, sec) => s + countOf(sec, 'shelf'), 0);
    const totalBaskets = sections.reduce((sum, sec, i) => sum + ((sectionMissingSideSupport(sections, i) || !basketFits(sec)) ? 0 : countOf(sec, 'basket')), 0);
    // Без опоры по бокам ящики не ставятся — только в крайней секции без стойки, см. buildWardrobeBox.
    const totalDrawers = sections.reduce((sum, sec, i) => sum + (sectionMissingSideSupport(sections, i) ? 0 : countOf(sec, 'drawer')), 0);
    const totalRod = sections.reduce((s, sec) => s + countOf(sec, 'rod'), 0);
    const totalMesh = sections.reduce((s, sec) => s + countOf(sec, 'mesh'), 0);
    const totalValet = sections.reduce((s, sec) => s + (sec.valet ? 1 : 0), 0);
    return `, секций: ${sections.length}, полок: ${totalShelves}, ящиков: ${totalDrawers}, штанг: ${totalRod}, сетчатых полок: ${totalMesh}, торцевых вешал: ${totalValet}, корзин: ${totalBaskets}`;
  },
};
