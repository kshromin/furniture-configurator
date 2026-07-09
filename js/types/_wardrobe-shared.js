import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';

export function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

// Вычисляет ширину/высоту дверного пролёта с учётом стоек/крыши/коробов/планок.
// "планка" = та же толщина что и панель (пролёт не меняется относительно варианта "со стойкой").
// "короб" = занимает boxW/boxH из габарита изделия → пролёт уменьшается на размер короба.
// "ничего" (убрана без замены) → пролёт расширяется на толщину убранной панели.
// Выравнивающий элемент — планка у переднего края рядом со стойкой/крышей (та же толщина,
// что и панель, но шириной/высотой по умолчанию 50мм). Сдвигает стойку/крышу вглубь на свой
// размер, поэтому дверной пролёт (и цена) должны знать про него так же, как про планку/короб.
export function effectiveDoorSpan() {
  const { width, noSideLeft, noSideRight, noCeiling, noBottom,
          leftReplace, rightReplace, topReplace, bottomReplace,
          leftBoxW, rightBoxW, topBoxH, bottomBoxH,
          alignerLeft, alignerLeftW, alignerRight, alignerRightW, alignerTop, alignerTopH } = state;
  const t = PANEL_THICKNESS;

  function off(noPanel, replace, boxSize, alignerOn, alignerSize) {
    let base;
    if (!noPanel)                   base = t;     // панель на месте
    else if (replace === 'planka')  base = t;     // планка = та же толщина
    else if (replace === 'box')     base = boxSize;
    else                             base = 0;     // ничего
    return base + (alignerOn ? alignerSize : 0);
  }

  const leftOff   = off(noSideLeft,  leftReplace,   leftBoxW,   alignerLeft,  alignerLeftW);
  const rightOff  = off(noSideRight, rightReplace,  rightBoxW,  alignerRight, alignerRightW);
  const topOff    = off(noCeiling,   topReplace,    topBoxH,    alignerTop,   alignerTopH);
  const bottomOff = off(noBottom,    bottomReplace, bottomBoxH, false,        0);

  return {
    spanW:     width - leftOff - rightOff,
    leftOff,
    rightOff,
    topOff,
    bottomOff,
  };
}

// Секции наполнения имеют произвольную ширину, но сумма их ширин + перегородки между ними
// обязана совпадать с внутренней шириной короба (effectiveDoorSpan().spanW). Эта функция
// восстанавливает баланс после любого изменения, которое сдвигает границы короба (ширина
// изделия, стойки/выравниватели) или состав секций (добавили/убрали секцию).
// editedIndex — если пользователь только что руками поправил ширину одной секции, её значение
// не трогаем, остальные пропорционально ужимаются/растягиваются под освободившееся место.
export const MIN_SECTION_WIDTH = 150;

export function rebalanceSections(editedIndex = null) {
  const sections = state.sections;
  const n = sections.length;
  if (n === 0) return;
  const t = PANEL_THICKNESS;
  const { spanW } = effectiveDoorSpan();
  const available = spanW - (n - 1) * t;

  if (n === 1) { sections[0].width = available; return; }

  if (editedIndex !== null) {
    const maxForEdited = available - (n - 1) * MIN_SECTION_WIDTH;
    sections[editedIndex].width = Math.min(Math.max(sections[editedIndex].width, MIN_SECTION_WIDTH), maxForEdited);
  }

  const otherIdx = sections.map((_, i) => i).filter(i => i !== editedIndex);
  const fixedW = editedIndex !== null ? sections[editedIndex].width : 0;
  const remaining = Math.max(otherIdx.length * MIN_SECTION_WIDTH, available - fixedW);
  const otherTotal = otherIdx.reduce((s, i) => s + sections[i].width, 0);

  otherIdx.forEach(i => {
    // если у всех «остальных» секций ширина 0 (например, только что собраны из пресета) —
    // делим доступное место поровну, иначе доля 0/0 обнулила бы всех, кроме последней
    const share = otherTotal > 0 ? sections[i].width / otherTotal : 1 / otherIdx.length;
    sections[i].width = Math.max(MIN_SECTION_WIDTH, Math.round(remaining * share));
  });

  // компенсируем накопленное округление в последней «нефиксированной» секции, чтобы сумма
  // ширин точно совпала с available, а не отличалась на пару мм
  const total = sections.reduce((s, sec) => s + sec.width, 0);
  sections[otherIdx[otherIdx.length - 1]].width += available - total;
}

// Двери купе едут по рельсам, вынесенным в переднюю зону короба (как у Командор) —
// это съедает часть глубины у наполнения, но не у самого короба (короб — на полную глубину).
export const DOOR_DEPTH_ZONE = 90;
// Соседние двери заходят друг на друга внахлёст, чтобы не было щели; крайние двери при
// этом не вылезают наружу — весь ряд идёт строго от стойки до стойки (см. buildSlidingDoors).
export const DOOR_OVERLAP = 30;

// Рамка двери купе — по умолчанию серебристый алюминиевый профиль; сама дверь на 90мм
// зоны глубины (ширину/глубину рамки и цвет вынесем в настройки, когда дойдём до этого).
export const DOOR_FRAME_WIDTH = 40; // видимая ширина профиля по периметру
export const DOOR_FRAME_DEPTH = 40; // толщина рамки (она же — толщина двери по Z)
const DOOR_FRAME_COLOR = 0xc4c4c8;
const RAIL_COLOR = 0xb0b0b4;
export const TOP_RAIL_HEIGHT = 50;
export const BOTTOM_RAIL_HEIGHT = 10;

// Дверь купе = рамка по периметру + наполнение внутри неё (зеркало/ЛДСП/стекло).
// Наполнение сейчас той же толщины, что и панели короба, и красится в цвет фасада —
// когда рамка/наполнение станут настраиваться раздельно (разный цвет рамки, разный материал
// наполнения), менять нужно будет только эту функцию.
function buildSlidingDoor(x, y, z, w, h, fillColor) {
  const fw = DOOR_FRAME_WIDTH;
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y + h / 2 - fw / 2, z]); // верхний брусок рамки
  addPanel(w, fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x, y - h / 2 + fw / 2, z]); // нижний брусок рамки
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x - w / 2 + fw / 2, y, z]); // левый брусок
  addPanel(fw, h - 2 * fw, DOOR_FRAME_DEPTH, DOOR_FRAME_COLOR, [x + w / 2 - fw / 2, y, z]); // правый брусок
  addPanel(w - 2 * fw, h - 2 * fw, PANEL_THICKNESS, fillColor, [x, y, z], 0.85); // наполнение
}

// Общий короб для шкафа-купе / распашного / открытого — сегодня они выглядят одинаково
// (двери купе рисуются всегда), различия по дверям будут добавлены отдельно для каждого типа.
export function buildWardrobeBox() {
  const { width, depth, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  // Без дна нечему опираться на цоколь — он тоже пропадает, даже если галочка стоит.
  const plinthH = (plinthEnabled && !noBottom) ? plinthHeight : 0;
  // Цоколь занимает нижнюю часть общей высоты изделия — короб над ним ниже на эту величину.
  const height = state.height - plinthH;
  const y0 = plinthH; // низ короба, всё остальное строится как раньше, но с этим смещением

  if (plinthH > 0) {
    addPanel(width, plinthH, depth - 40, kColor, [0, plinthH / 2, -20]);
  }

  // Выравнивающие элементы — тонкие планки (толщиной с панель) у самого переднего края,
  // рядом со стойкой/крышей; сама стойка/крыша сдвигается вглубь на их размер.
  const alLeftW  = state.alignerLeft  ? state.alignerLeftW  : 0;
  const alRightW = state.alignerRight ? state.alignerRightW : 0;
  const alTopH   = state.alignerTop   ? state.alignerTopH   : 0;
  const alignZ = depth / 2 - t / 2;

  // Реальные границы короба — с учётом планок/коробов/выравнивающих элементов (та же логика,
  // что и для дверного пролёта). Стойки, задняя стенка и наполнение опираются на них, а не на
  // голую толщину панели — иначе при снятой крыше/дне (или сдвиге от выравнивателя) они не
  // дотянутся до реального края короба или, наоборот, вылезут за него.
  const { spanW, leftOff, rightOff, topOff, bottomOff } = effectiveDoorSpan();
  const stojkaH = height - topOff - bottomOff;
  const stojkaCenterY = y0 + bottomOff + stojkaH / 2;

  if (!noBottom)    addPanel(width, t, depth, kColor, [0, y0 + t / 2, 0]);
  if (!noCeiling)   addPanel(width, t, depth, kColor, [0, y0 + height - alTopH - t / 2, 0]);
  if (!noSideLeft)  addPanel(t, stojkaH, depth, kColor, [-width / 2 + alLeftW + t / 2, stojkaCenterY, 0]);
  if (!noSideRight) addPanel(t, stojkaH, depth, kColor, [width / 2 - alRightW - t / 2, stojkaCenterY, 0]);
  if (state.alignerLeft)  addPanel(alLeftW,  stojkaH, t, kColor, [-width / 2 + alLeftW / 2, stojkaCenterY, alignZ]);
  if (state.alignerRight) addPanel(alRightW, stojkaH, t, kColor, [width / 2 - alRightW / 2, stojkaCenterY, alignZ]);
  if (state.alignerTop)   addPanel(width, alTopH, t, kColor, [0, y0 + height - alTopH / 2, alignZ]);
  if (state.backWall !== 'none') {
    const bwColor = state.backWall === 'hdf' ? 0xffffff : kColor;
    const bwThick = state.backWall === 'hdf' ? 4 : t;
    addPanel(width - leftOff - rightOff, stojkaH, bwThick, bwColor, [0, stojkaCenterY, -depth / 2 + bwThick / 2]);
  }

  // Наполнение (перегородки, полки) не занимает дверную зону и прижато к задней стенке —
  // короб при этом остаётся на полную глубину.
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  const innerZ = -DOOR_DEPTH_ZONE / 2;

  // Ширины секций хранятся как есть в state.sections; здесь только страховка на случай, если
  // что-то изменило границы короба (габариты, стойки, выравниватели) и не вызвало rebalanceSections()
  // само — без этого секции могли бы не долетать до края короба или вылезать за него.
  const sections = state.sections;
  {
    const available = spanW - (sections.length - 1) * t;
    const sum = sections.reduce((s, sec) => s + sec.width, 0);
    if (Math.abs(sum - available) > 0.5) rebalanceSections();
  }
  const sectionCenters = [];
  {
    let cursorX = -width / 2 + leftOff;
    sections.forEach((sec, i) => {
      sectionCenters.push(cursorX + sec.width / 2);
      cursorX += sec.width;
      if (i < sections.length - 1) {
        addPanel(t, stojkaH, innerDepth, nColor, [cursorX + t / 2, stojkaCenterY, innerZ]);
        cursorX += t;
      }
    });
  }

  // Визуализация планок и коробов (глубина = дверная зона, внутри габарита изделия)
  const elemZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
  const totalH = state.height;

  function drawSideElem(noSide, replace, boxW, xCenter) {
    if (!noSide) return;
    if (replace === 'planka')
      addPanel(t, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
    else if (replace === 'box')
      addPanel(boxW, totalH, DOOR_DEPTH_ZONE, kColor, [xCenter, totalH / 2, elemZ]);
  }
  drawSideElem(state.noSideLeft,  state.leftReplace,  state.leftBoxW,  -width / 2 + (state.leftReplace === 'box' ? state.leftBoxW : t) / 2);
  drawSideElem(state.noSideRight, state.rightReplace, state.rightBoxW,  width / 2 - (state.rightReplace === 'box' ? state.rightBoxW : t) / 2);

  if (state.noCeiling) {
    const h = state.topReplace === 'box' ? state.topBoxH : t;
    if (state.topReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, totalH - h / 2, elemZ]);
  }
  if (state.noBottom) {
    const h = state.bottomReplace === 'box' ? state.bottomBoxH : t;
    if (state.bottomReplace !== 'none')
      addPanel(width, h, DOOR_DEPTH_ZONE, kColor, [0, h / 2, elemZ]);
  }

  const spanCenterX = -width / 2 + leftOff + spanW / 2;

  const doorCount = getDoorCount(spanW);
  if (state.showDoors) {
    const gap = 4;
    const doorW = (spanW + (doorCount - 1) * DOOR_OVERLAP) / doorCount;
    const doorZoneZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
    const railFront = depth / 2 - DOOR_FRAME_DEPTH / 2;
    const railBack  = depth / 2 - DOOR_DEPTH_ZONE + DOOR_FRAME_DEPTH / 2;

    addPanel(spanW, TOP_RAIL_HEIGHT,    DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + height - topOff - TOP_RAIL_HEIGHT / 2,       doorZoneZ]);
    addPanel(spanW, BOTTOM_RAIL_HEIGHT, DOOR_DEPTH_ZONE, RAIL_COLOR, [spanCenterX, y0 + bottomOff + BOTTOM_RAIL_HEIGHT / 2, doorZoneZ]);

    const doorBottom  = y0 + bottomOff + BOTTOM_RAIL_HEIGHT + gap;
    const doorTop     = y0 + height - topOff - TOP_RAIL_HEIGHT - gap;
    const doorH       = doorTop - doorBottom;
    const doorCenterY = (doorBottom + doorTop) / 2;

    for (let i = 0; i < doorCount; i++) {
      const leftEdge = -spanW / 2 + i * (doorW - DOOR_OVERLAP);
      const x = spanCenterX + leftEdge + doorW / 2;
      const z = i % 2 === 0 ? railFront : railBack;
      buildSlidingDoor(x, doorCenterY, z, doorW, doorH, fColor);
    }
  }

  const fillBottom = bottomOff + 10, fillTop = height - topOff - 10;
  let totalShelves = 0, totalDrawers = 0, totalRod = 0;

  sections.forEach((sec, s) => {
    const cx = sectionCenters[s];
    const sw = sec.width - 10;
    let drawerTop = fillBottom;

    if (sec.drawers > 0) {
      const blkH = Math.min(700, (fillTop - fillBottom) * 0.4);
      const dh = (blkH - (sec.drawers - 1) * 4) / sec.drawers;
      for (let i = 0; i < sec.drawers; i++) {
        const y = fillBottom + i * (dh + 4) + dh / 2;
        addPanel(sw, dh, t, fColor, [cx, y0 + y, depth / 2 - t - 20], 0.9);
      }
      drawerTop = fillBottom + blkH + 20;
      totalDrawers += sec.drawers;
    }

    if (sec.shelves > 0) {
      const usable = fillTop - drawerTop - (sec.rod ? 250 : 0);
      for (let i = 0; i < sec.shelves; i++) {
        const y = drawerTop + (usable * (i + 1)) / (sec.shelves + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y0 + y, innerZ]);
      }
      totalShelves += sec.shelves;
    }

    if (sec.rod) {
      const rodGeo = new THREE.CylinderGeometry(8, 8, sw, 12);
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
      const rodMesh = new THREE.Mesh(rodGeo, rodMat);
      rodMesh.rotation.z = Math.PI / 2;
      rodMesh.position.set(cx, y0 + fillTop - 60, depth / 2 - 100);
      furnitureGroup.add(rodMesh);
      totalRod++;
    }
  });

  return { door: doorCount, drawer: totalDrawers, shelf: totalShelves, rod: totalRod, item: 1 };
}
