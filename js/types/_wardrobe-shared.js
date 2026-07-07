import * as THREE from 'three';
import { state, PANEL_THICKNESS } from '../core/state.js';
import { addPanel, furnitureGroup } from '../core/scene.js';
import { getColor } from '../core/materials.js';

export function getDoorCount(width) { return Math.max(2, Math.min(4, Math.round(width / 900))); }

// Общий короб для шкафа-купе / распашного / открытого — сегодня они выглядят одинаково
// (двери купе рисуются всегда), различия по дверям будут добавлены отдельно для каждого типа.
export function buildWardrobeBox() {
  const { width, height, depth, shelves, drawers, rod, sections } = state;
  const t = PANEL_THICKNESS;
  const kColor = getColor('korpus').color;
  const fColor = getColor('fasad').color;
  const nColor = getColor('fill').color;

  addPanel(width, t, depth, kColor, [0, t / 2, 0]);
  addPanel(width, t, depth, kColor, [0, height - t / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [-width / 2 + t / 2, height / 2, 0]);
  addPanel(t, height - 2 * t, depth, kColor, [width / 2 - t / 2, height / 2, 0]);
  if (state.backWall !== 'none') {
    const bwColor = state.backWall === 'hdf' ? 0xffffff : kColor;
    const bwThick = state.backWall === 'hdf' ? 4 : t;
    addPanel(width - 2 * t, height - 2 * t, bwThick, bwColor, [0, height / 2, -depth / 2 + bwThick / 2]);
  }

  const innerWidth = width - 2 * t;
  const sectionWidth = (innerWidth - (sections - 1) * t) / sections;
  for (let i = 1; i < sections; i++) {
    addPanel(t, height - 2 * t, depth - 20, kColor, [
      -width / 2 + t + i * (sectionWidth + t) - t / 2,
      height / 2, 0,
    ]);
  }

  const doorCount = getDoorCount(width);
  if (state.showDoors) {
    const gap = 4;
    const doorW = (width - gap * (doorCount + 1)) / doorCount;
    for (let i = 0; i < doorCount; i++) {
      const x = -width / 2 + gap + doorW / 2 + i * (doorW + gap);
      addPanel(doorW, height - 2 * gap, t, fColor, [x, height / 2, depth / 2 - t / 2], 0.85);
    }
  }

  const innerDepth = depth - 60;
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
        addPanel(sw, dh, t, fColor, [cx, y, depth / 2 - t - 20], 0.9);
      }
      drawerTop = fillBottom + blkH + 20;
    }

    if (shelves > 0) {
      const usable = fillTop - drawerTop - (rod ? 250 : 0);
      for (let i = 0; i < shelves; i++) {
        const y = drawerTop + (usable * (i + 1)) / (shelves + 1);
        addPanel(sw, t, innerDepth, nColor, [cx, y, 0]);
      }
    }

    if (rod) {
      const rodGeo = new THREE.CylinderGeometry(8, 8, sw, 12);
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
      const rodMesh = new THREE.Mesh(rodGeo, rodMat);
      rodMesh.rotation.z = Math.PI / 2;
      rodMesh.position.set(cx, fillTop - 60, depth / 2 - 100);
      furnitureGroup.add(rodMesh);
    }
  }

  return { door: doorCount, drawer: drawers * sections, shelf: shelves * sections, rod: rod ? sections : 0, item: 1 };
}
