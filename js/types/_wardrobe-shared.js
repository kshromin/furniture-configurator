import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';

export function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

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
  const { width, depth, shelves, drawers, rod, sections, plinthEnabled, plinthHeight, noSideLeft, noSideRight, noCeiling, noBottom } = state;
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

  if (!noBottom)    addPanel(width, t, depth, kColor, [0, y0 + t / 2, 0]);
  if (!noCeiling)   addPanel(width, t, depth, kColor, [0, y0 + height - t / 2, 0]);
  if (!noSideLeft)  addPanel(t, height - 2 * t, depth, kColor, [-width / 2 + t / 2, y0 + height / 2, 0]);
  if (!noSideRight) addPanel(t, height - 2 * t, depth, kColor, [width / 2 - t / 2, y0 + height / 2, 0]);
  if (state.backWall !== 'none') {
    const bwColor = state.backWall === 'hdf' ? 0xffffff : kColor;
    const bwThick = state.backWall === 'hdf' ? 4 : t;
    addPanel(width - 2 * t, height - 2 * t, bwThick, bwColor, [0, y0 + height / 2, -depth / 2 + bwThick / 2]);
  }

  // Наполнение (перегородки, полки) не занимает дверную зону и прижато к задней стенке —
  // короб при этом остаётся на полную глубину.
  const innerDepth = depth - DOOR_DEPTH_ZONE;
  const innerZ = -DOOR_DEPTH_ZONE / 2;

  const innerWidth = width - 2 * t;
  const sectionWidth = (innerWidth - (sections - 1) * t) / sections;
  for (let i = 1; i < sections; i++) {
    addPanel(t, height - 2 * t, innerDepth, kColor, [
      -width / 2 + t + i * (sectionWidth + t) - t / 2,
      y0 + height / 2, innerZ,
    ]);
  }

  const doorCount = getDoorCount(width);
  if (state.showDoors) {
    const gap = 4;
    const span = width - 2 * t; // от стойки до стойки
    const doorW = (span + (doorCount - 1) * DOOR_OVERLAP) / doorCount;
    const doorZoneZ = depth / 2 - DOOR_DEPTH_ZONE / 2;
    const railFront = depth / 2 - DOOR_FRAME_DEPTH / 2;                      // у самого края короба
    const railBack   = depth / 2 - DOOR_DEPTH_ZONE + DOOR_FRAME_DEPTH / 2;   // в глубине дверной зоны

    // верхняя направляющая (глубокий короб-профиль) и нижняя (тонкая планка) — обе на всю дверную зону
    addPanel(span, TOP_RAIL_HEIGHT, DOOR_DEPTH_ZONE, RAIL_COLOR, [0, y0 + height - t - TOP_RAIL_HEIGHT / 2, doorZoneZ]);
    addPanel(span, BOTTOM_RAIL_HEIGHT, DOOR_DEPTH_ZONE, RAIL_COLOR, [0, y0 + t + BOTTOM_RAIL_HEIGHT / 2, doorZoneZ]);

    const doorBottom = y0 + t + BOTTOM_RAIL_HEIGHT + gap;
    const doorTop = y0 + height - t - TOP_RAIL_HEIGHT - gap;
    const doorH = doorTop - doorBottom;
    const doorCenterY = (doorBottom + doorTop) / 2;

    for (let i = 0; i < doorCount; i++) {
      const leftEdge = -span / 2 + i * (doorW - DOOR_OVERLAP);
      const x = leftEdge + doorW / 2;
      const z = i % 2 === 0 ? railFront : railBack;
      buildSlidingDoor(x, doorCenterY, z, doorW, doorH, fColor);
    }
  }

  const fillBottom = t + 10, fillTop = height - t - 10;

  for (let s = 0; s < sections; s++) {
    const cx = -width / 2 + t + s * (sectionWidth + t) + sectionWidth / 2;
    const sw = sectionWidth - 10;
    let drawerTop = fillBottom;

    if (drawers > 0) {
      const blkH = Math.min(700, (fillTop - fillBottom) * 0.4);
      const dh = (blkH - (drawers - 1) * 4) / drawers;
      for (let i = 0; i < drawers; i++) {
        const y = fillBottom + i * (dh + 4) + dh / 2;
        addPanel(sw, dh, t, fColor, [cx, y0 + y, depth / 2 - t - 20], 0.9);
      }
      drawerTop = fillBottom + blkH + 20;
    }

    if (shelves > 0) {
      const usable = fillTop - drawerTop - (rod ? 250 : 0);
      for (let i = 0; i < shelves; i++) {
        const y = drawerTop + (usable * (i + 1)) / (shelves + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y0 + y, innerZ]);
      }
    }

    if (rod) {
      const rodGeo = new THREE.CylinderGeometry(8, 8, sw, 12);
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
      const rodMesh = new THREE.Mesh(rodGeo, rodMat);
      rodMesh.rotation.z = Math.PI / 2;
      rodMesh.position.set(cx, y0 + fillTop - 60, depth / 2 - 100);
      furnitureGroup.add(rodMesh);
    }
  }

  return { door: doorCount, drawer: drawers * sections, shelf: shelves * sections, rod: rod ? sections : 0, item: 1 };
}
