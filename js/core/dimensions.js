import * as THREE from 'three';
import { camera, controls } from './scene.js';
import { state } from './state.js';
import { TYPES } from '../types/registry.js';
import {
  sectionVerticalBounds, itemBands, lastBuildSectionCenters, lastBuildY0,
} from '../types/_wardrobe-shared.js';

// Размерные линии наполнения — HTML/SVG-оверлей поверх канваса (не 3D-геометрия), см. #dimOverlay
// в css/style.css. Показывает просвет (по той же логике, что findFreeSlot/checkOverlap) между
// соседними элементами каждой секции — число + тонкая стрелка от одной границы просвета до
// другой (иначе непонятно, ЧТО именно измеряет цифра), по-секционно управляется галочками (см.
// tabs.js), при драге элемента дополняется редактируемыми полями — см. js/core/itemDrag.js.
const overlay = document.getElementById('dimOverlay');
const arrowsSvg = document.getElementById('dimArrowsSvg');
const SVG_NS = 'http://www.w3.org/2000/svg';

let entries = []; // { el, key, p1:[x,y,z], p2:[x,y,z] } — мировые координаты подписи+стрелки для перепроецирования при повороте камеры
const arrowPool = new Map(); // key -> <line> — переиспользуются между вызовами (и статикой, и драгом), чтобы не пересоздавать SVG-элементы на каждый кадр

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

function getArrowLine(key) {
  let line = arrowPool.get(key);
  if (!line) {
    line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'dim-arrow-line');
    line.setAttribute('marker-start', 'url(#dimArrowHead)');
    line.setAttribute('marker-end', 'url(#dimArrowHead)');
    arrowsSvg.appendChild(line);
    arrowPool.set(key, line);
  }
  return line;
}

// Стрелка между двумя произвольными мировыми точками (не обязательно вертикальная — например,
// ширина секции измеряется по горизонтали) — используется и статичными подписями (высота просвета
// + ширина секции), и полями точного размера при драге (js/core/itemDrag.js), с разными ключами
// (см. clearArrows). updateArrow — частный случай (вертикальная стрелка при фиксированном x).
export function updateArrowPoints(key, x1, y1, z1, x2, y2, z2) {
  const line = getArrowLine(key);
  const p1 = projectToOverlay(x1, y1, z1);
  const p2 = projectToOverlay(x2, y2, z2);
  line.setAttribute('x1', p1.x);
  line.setAttribute('y1', p1.y);
  line.setAttribute('x2', p2.x);
  line.setAttribute('y2', p2.y);
  line.style.display = (p1.behind || p2.behind) ? 'none' : '';
}

export function updateArrow(key, x, loWorldY, hiWorldY) {
  updateArrowPoints(key, x, loWorldY, 0, x, hiWorldY, 0);
}

export function hideArrow(key) {
  const line = arrowPool.get(key);
  if (line) line.style.display = 'none';
}

function clearArrows(prefix) {
  for (const [key, line] of arrowPool) {
    if (key.startsWith(prefix)) { line.remove(); arrowPool.delete(key); }
  }
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
    if (b.lo - cursor > 1) gaps.push({ lo: cursor, hi: b.lo, mm: Math.round(b.lo - cursor) });
    cursor = Math.max(cursor, b.hi);
  });
  if (fillTop - cursor > 1) gaps.push({ lo: cursor, hi: fillTop, mm: Math.round(fillTop - cursor) });
  return gaps;
}

export function clearStaticDimensions() {
  entries.forEach(({ el }) => el.remove());
  entries = [];
  clearArrows('static-');
}

function pushEntry(text, key, p1, p2) {
  const el = document.createElement('div');
  el.className = 'dim-label';
  el.textContent = text;
  overlay.appendChild(el);
  entries.push({ el, key, p1, p2 });
}

// Ширина секции дублирует то же число, что уже видно в поле на боковой панели (см. tabs.js) —
// просто нагляднее видеть её прямо на 3D-модели. Линия — под низом всего изделия (чуть ниже
// цоколя/пола, независимо от того, есть цоколь или нет), тот же принцип, что и высота просвета:
// стрелка от левой границы секции до правой + число посередине. Управляется той же галочкой
// (общей и по-секционной), что и просветы по высоте — отдельного переключателя нет.
const WIDTH_LINE_Y = -60;
function widthLineZ() { return state.depth / 2 + 15; }

export function renderStaticDimensions() {
  clearStaticDimensions();
  if (!state.showDimensions || !sectionsHaveDimensions()) return;
  const { fillBottom, fillTop } = sectionVerticalBounds();
  const z = widthLineZ();
  state.sections.forEach((sec, s) => {
    if (sec.showDimensions === false) return;
    const cx = lastBuildSectionCenters[s];
    if (cx === undefined) return;
    sectionGaps(sec, fillBottom, fillTop).forEach((g, gi) => {
      pushEntry(g.mm + ' мм', `static-${s}-${gi}`, [cx, lastBuildY0 + g.lo, 0], [cx, lastBuildY0 + g.hi, 0]);
    });
    const halfW = sec.width / 2;
    pushEntry(Math.round(sec.width) + ' мм', `static-w-${s}`, [cx - halfW, WIDTH_LINE_Y, z], [cx + halfW, WIDTH_LINE_Y, z]);
  });
  repositionStaticDimensions();
}

export function repositionStaticDimensions() {
  entries.forEach(({ el, key, p1, p2 }) => {
    const p = projectToOverlay((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
    el.style.display = p.behind ? 'none' : '';
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    updateArrowPoints(key, p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  });
}

export function initDimensions() {
  controls.addEventListener('change', repositionStaticDimensions);
  window.addEventListener('resize', repositionStaticDimensions);
}
