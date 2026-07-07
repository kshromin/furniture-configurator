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

// Дверь купе = рамка + наполнение (зеркало/ЛДСП/стекло). Пока рисуем одной панелью,
// но держим отрисовку в одном месте — когда рамка и наполнение станут разными материалами,
// красить их по отдельности нужно будет только здесь.
function buildSlidingDoor(x, y, z, w, h, color) {
  addPanel(w, h, PANEL_THICKNESS, color, [x, y, z], 0.85);
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
    const railFront = depth / 2 - t / 2;                  // у самого края короба
    const railBack   = depth / 2 - DOOR_DEPTH_ZONE + t / 2; // в глубине дверной зоны
    for (let i = 0; i < doorCount; i++) {
      const leftEdge = -span / 2 + i * (doorW - DOOR_OVERLAP);
      const x = leftEdge + doorW / 2;
      const z = i % 2 === 0 ? railFront : railBack;
      buildSlidingDoor(x, y0 + height / 2, z, doorW, height - 2 * gap, fColor);
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
