import * as THREE from 'three';
import { camera, controls } from './scene.js';
import { state } from './state.js';
import { TYPES } from '../types/registry.js';
import {
  sectionVerticalBounds, itemBands, lastBuildSectionCenters, lastBuildY0,
} from '../types/_wardrobe-shared.js';

// Размерные линии наполнения — HTML-оверлей поверх канваса (не 3D-геометрия), см. #dimOverlay
// в css/style.css. Показывает просвет (по той же логике, что findFreeSlot/checkOverlap) между
// соседними элементами каждой секции, по-секционно управляется галочками (см. tabs.js), при
// драге элемента заменяется на редактируемые поля — см. js/core/itemDrag.js.
const overlay = document.getElementById('dimOverlay');
let entries = []; // { el, x, y, z } — мировые координаты подписи для перепроецирования при повороте камеры

const v3 = new THREE.Vector3();

export function projectToOverlay(x, y, z) {
  v3.set(x, y, z).project(camera);
  const rect = overlay.getBoundingClientRect();
  return {
    x: (v3.x * 0.5 + 0.5) * rect.width,
    y: (-v3.y * 0.5 + 0.5) * rect.height,
    behind: v3.z > 1,
  };
}

function sectionsHaveDimensions() {
  const type = TYPES[state.type] || TYPES['wardrobe'];
  return Array.isArray(state.sections) && !!type.ctx?.fill?.list;
}

// Просветы секции снизу вверх: от пола наполнения до первого элемента, между соседними
// элементами, от последнего элемента до потолка наполнения — те же границы, что использует
// findFreeSlot при поиске места для нового элемента.
export function sectionGaps(sec, fillBottom, fillTop) {
  const bands = itemBands(sec, null).sort((a, b) => a.lo - b.lo);
  const gaps = [];
  let cursor = fillBottom;
  bands.forEach(b => {
    if (b.lo - cursor > 1) gaps.push({ y: (cursor + b.lo) / 2, mm: Math.round(b.lo - cursor) });
    cursor = Math.max(cursor, b.hi);
  });
  if (fillTop - cursor > 1) gaps.push({ y: (cursor + fillTop) / 2, mm: Math.round(fillTop - cursor) });
  return gaps;
}

export function clearStaticDimensions() {
  entries.forEach(({ el }) => el.remove());
  entries = [];
}

export function renderStaticDimensions() {
  clearStaticDimensions();
  if (!state.showDimensions || !sectionsHaveDimensions()) return;
  const { fillBottom, fillTop } = sectionVerticalBounds();
  state.sections.forEach((sec, s) => {
    if (sec.showDimensions === false) return;
    const cx = lastBuildSectionCenters[s];
    if (cx === undefined) return;
    sectionGaps(sec, fillBottom, fillTop).forEach(g => {
      const el = document.createElement('div');
      el.className = 'dim-label';
      el.textContent = g.mm + ' мм';
      overlay.appendChild(el);
      entries.push({ el, x: cx, y: lastBuildY0 + g.y, z: 0 });
    });
  });
  repositionStaticDimensions();
}

export function repositionStaticDimensions() {
  entries.forEach(({ el, x, y, z }) => {
    const p = projectToOverlay(x, y, z);
    el.style.display = p.behind ? 'none' : '';
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  });
}

export function initDimensions() {
  controls.addEventListener('change', repositionStaticDimensions);
  window.addEventListener('resize', repositionStaticDimensions);
}
