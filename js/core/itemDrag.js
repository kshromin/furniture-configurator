import * as THREE from 'three';
import { camera, renderer, controls, furnitureGroup } from './scene.js';
import { state } from './state.js';
import { buildFurniture } from './build.js';
import { showToast } from './toast.js';
import {
  lastBuildItemMeshes, lastBuildValetMeshes, lastBuildSectionCenters, lastBuildY0,
  checkOverlap, sectionVerticalBounds, valetAnchorCandidates, resolveValetAnchorY,
  itemBands, itemBandHeight,
} from '../types/_wardrobe-shared.js';
import { projectToOverlay } from './dimensions.js';

// Свободное перетаскивание мышкой наполнения секции (полки/ящики/сетка/корзины/штанга) — во
// время драга элемент может визуально проходить сквозь другие (двигаем меши напрямую, без
// проверки на каждый кадр), но зафиксировать (pointerup) можно только в свободном месте —
// иначе подсветка красным и возврат на исходную позицию. Вешало — отдельная ветка: не двигается
// свободно, а прыгает между полками (снап к ближайшему кандидату при отпускании).
//
// "active" (в отличие от dragState) живёт дольше самого драга — с pointerdown и до клика мимо
// (или выбора другого элемента): подсветка + инфопанель + (для kind:'item') редактируемые поля
// точного размера просвета сверху/снизу остаются на экране и после отпускания мышки, чтобы можно
// было допечатать точное число с клавиатуры, а не ловить его мышкой — см. js/core/dimensions.js
// для мировые->экранные координаты.
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeHit = new THREE.Vector3();
const startHit = new THREE.Vector3();

const SELECT_EMISSIVE = 0x2f6fed;
const RED_EMISSIVE = 0xff2222;

let dragState = null; // только между pointerdown и pointerup — живое перемещение мешей
let active = null;    // { kind, sectionIndex, sec, item?, itemType?, meshes }

const overlay = document.getElementById('dimOverlay');
const infoPanel = document.getElementById('dragInfoPanel');
const belowInput = document.createElement('input');
const aboveInput = document.createElement('input');
[belowInput, aboveInput].forEach(inp => {
  inp.type = 'number';
  inp.className = 'dim-drag-input';
  inp.style.display = 'none';
  overlay.appendChild(inp);
});

function updatePointerNDC(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

// Рейкастим только настоящие меши (у edge-контуров addPanel — LineSegments — нет userData,
// они и так не .isMesh, но фильтруем явно для надёжности), первый хит с itemId — обычный
// перетаскиваемый элемент, первый хит с itemType 'valet' — вешало (снап-ветка).
function pickDraggable(e) {
  updatePointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(furnitureGroup.children, true);
  for (const hit of hits) {
    const obj = hit.object;
    if (!obj.isMesh || !obj.userData) continue;
    if (obj.userData.itemId) return { mesh: obj, kind: 'item' };
    if (obj.userData.itemType === 'valet') return { mesh: obj, kind: 'valet' };
  }
  return null;
}

function setHighlight(meshes, hex) {
  meshes.forEach(mesh => {
    if (!mesh.material || !mesh.material.emissive) return;
    if (hex !== null) {
      if (mesh.userData._origEmissive === undefined) mesh.userData._origEmissive = mesh.material.emissive.getHex();
      mesh.material.emissive.setHex(hex);
    } else if (mesh.userData._origEmissive !== undefined) {
      mesh.material.emissive.setHex(mesh.userData._origEmissive);
      delete mesh.userData._origEmissive;
    }
  });
}

function buildDragPlane(worldAnchor) {
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  dragPlane.setFromNormalAndCoplanarPoint(camDir, worldAnchor);
}

// ---------- инфопанель выбранного элемента ----------

const COLOR_LABELS = { silver: 'серебро/хром', white: 'белый', black: 'чёрный' };

function describeActive() {
  const { kind, sec, item, itemType } = active;
  if (kind === 'valet') return { title: 'Торцевое вешало', lines: [`Длина: ${sec.valetLength} мм`] };
  switch (itemType) {
    case 'shelf':
      return { title: item.pinned ? 'Полка (опорная)' : 'Полка', lines: item.pinned ? ['С планкой жёсткости снизу'] : [] };
    case 'rod':
      return { title: 'Штанга', lines: ['Хром, ⌀25 мм'] };
    case 'drawer':
      return {
        title: 'Ящик',
        lines: [`Фасад: ${sec.drawerHeight} мм`, `Глубина короба: ${sec.drawerDepth} мм`, sec.drawerSoftClose ? 'С доводчиком' : 'Без доводчика'],
      };
    case 'mesh':
      return { title: 'Сетчатая полка', lines: [`Глубина: ${sec.meshDepth} мм`, `Цвет: ${COLOR_LABELS[sec.meshColor] || sec.meshColor}`] };
    case 'basket':
      return {
        title: 'Сетчатая корзина',
        lines: [`Размер: ${sec.basketWidth}×${sec.basketDepth}×${sec.basketHeight} мм`, `Цвет: ${COLOR_LABELS[sec.basketColor] || sec.basketColor}`],
      };
    default:
      return { title: itemType, lines: [] };
  }
}

function showInfoPanel() {
  const { title, lines } = describeActive();
  infoPanel.innerHTML = `<div class="drag-info-panel-title">${title}</div>${lines.map(l => `<div>${l}</div>`).join('')}`;
  infoPanel.classList.add('visible');
}

function hideInfoPanel() {
  infoPanel.classList.remove('visible');
}

// ---------- редактируемые поля точного размера просвета (только kind:'item') ----------

// Текущая Y элемента: во время живого драга — кандидатная позиция под курсором, иначе — уже
// зафиксированная в state (после отпускания мышки, но пока элемент ещё выбран).
function currentItemY() {
  return (dragState && dragState.kind === 'item' && dragState.item === active.item) ? dragState.candidateY : active.item.y;
}

function neighborGaps(sec, itemId, lo, hi, fillBottom, fillTop) {
  let belowHi = fillBottom, aboveLo = fillTop;
  itemBands(sec, itemId).forEach(b => {
    if (b.hi <= lo && b.hi > belowHi) belowHi = b.hi;
    if (b.lo >= hi && b.lo < aboveLo) aboveLo = b.lo;
  });
  return { belowHi, aboveLo };
}

function updateEditInputs() {
  if (!active || active.kind !== 'item') { belowInput.style.display = 'none'; aboveInput.style.display = 'none'; return; }
  const { sec, item, itemType, sectionIndex } = active;
  const { fillBottom, fillTop } = sectionVerticalBounds();
  const h = itemBandHeight(itemType, sec);
  const y = currentItemY();
  const lo = y - h / 2, hi = y + h / 2;
  const { belowHi, aboveLo } = neighborGaps(sec, item.id, lo, hi, fillBottom, fillTop);
  active.belowHi = belowHi;
  active.aboveLo = aboveLo;
  active.h = h;

  const cx = lastBuildSectionCenters[sectionIndex];
  if (cx === undefined) return;

  const belowPos = projectToOverlay(cx, lastBuildY0 + (lo + belowHi) / 2, 0);
  belowInput.style.left = belowPos.x + 'px';
  belowInput.style.top = belowPos.y + 'px';
  belowInput.style.display = belowPos.behind ? 'none' : '';
  if (document.activeElement !== belowInput) belowInput.value = Math.round(lo - belowHi);

  const abovePos = projectToOverlay(cx, lastBuildY0 + (hi + aboveLo) / 2, 0);
  aboveInput.style.left = abovePos.x + 'px';
  aboveInput.style.top = abovePos.y + 'px';
  aboveInput.style.display = abovePos.behind ? 'none' : '';
  if (document.activeElement !== aboveInput) aboveInput.value = Math.round(aboveLo - hi);
}

function commitGapEdit(fromBelow) {
  if (!active || active.kind !== 'item') return;
  const inp = fromBelow ? belowInput : aboveInput;
  const val = Number(inp.value);
  if (!Number.isFinite(val) || val < 0) { updateEditInputs(); return; }
  const { sec, item, itemType } = active;
  const { fillBottom, fillTop } = sectionVerticalBounds();
  const h = active.h;
  const newY = fromBelow ? active.belowHi + val + h / 2 : active.aboveLo - val - h / 2;
  if (checkOverlap(newY, itemType, item.id, sec, fillBottom, fillTop)) {
    showToast('Нельзя поставить сюда — пересечение с другим элементом.');
    updateEditInputs();
    return;
  }
  item.y = newY;
  buildFurniture();
  // buildFurniture пересобрал меши — active.meshes устарели (старая группа очищена), обновляем
  // ссылку и переподсвечиваем на новых мешах (подсветка не переживает пересборку сама по себе).
  active.meshes = lastBuildItemMeshes.get(active.sectionIndex + '|' + item.id) || [];
  setHighlight(active.meshes, SELECT_EMISSIVE);
  updateEditInputs();
}

[belowInput, aboveInput].forEach((inp, i) => {
  const fromBelow = i === 0;
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { inp.blur(); commitGapEdit(fromBelow); }
    else if (e.key === 'Escape') { updateEditInputs(); inp.blur(); }
  });
  inp.addEventListener('blur', () => commitGapEdit(fromBelow));
});

// ---------- жизненный цикл "выбранного" элемента ----------

function closeActive() {
  if (!active) return;
  setHighlight(active.meshes, null);
  hideInfoPanel();
  belowInput.style.display = 'none';
  aboveInput.style.display = 'none';
  active = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && active && document.activeElement !== belowInput && document.activeElement !== aboveInput) closeActive();
});

function onPointerDown(e) {
  const picked = pickDraggable(e);
  closeActive();
  if (!picked) return;
  e.preventDefault();
  controls.enabled = false;
  renderer.domElement.style.cursor = 'grabbing';

  const { sectionIndex } = picked.mesh.userData;
  const sec = state.sections[sectionIndex];
  const { fillBottom, fillTop } = sectionVerticalBounds();

  const worldAnchor = picked.mesh.getWorldPosition(new THREE.Vector3());
  buildDragPlane(worldAnchor);
  updatePointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, startHit)) return;

  if (picked.kind === 'item') {
    const { itemId, itemType } = picked.mesh.userData;
    const item = sec.items.find(it => it.id === itemId);
    if (!item) return;
    const meshes = lastBuildItemMeshes.get(sectionIndex + '|' + itemId) || [picked.mesh];
    active = { kind: 'item', sectionIndex, sec, item, itemType, meshes };
    dragState = {
      kind: 'item', sec, item, itemType, meshes,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startItemY: item.y, candidateY: item.y,
      fillBottom, fillTop, overlapping: false,
    };
    setHighlight(meshes, SELECT_EMISSIVE);
    showInfoPanel();
    updateEditInputs();
  } else {
    const meshes = lastBuildValetMeshes.get(sectionIndex) || [];
    if (!meshes.length) return;
    const startAnchorY = resolveValetAnchorY(sec);
    const candidates = valetAnchorCandidates(sec);
    active = { kind: 'valet', sectionIndex, sec, meshes };
    dragState = {
      kind: 'valet', sec, meshes,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startAnchorY, candidates,
      currentAnchorId: sec.valetAnchorId ?? null,
    };
    setHighlight(meshes, SELECT_EMISSIVE);
    showInfoPanel();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  if (!dragState) return;
  updatePointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
  const deltaY = planeHit.y - dragState.startPointerY;

  if (dragState.kind === 'item') {
    dragState.meshes.forEach((m, i) => { m.position.y = dragState.originalY[i] + deltaY; });
    const candidateY = dragState.startItemY + deltaY;
    dragState.candidateY = candidateY;
    const overlapping = checkOverlap(candidateY, dragState.itemType, dragState.item.id, dragState.sec, dragState.fillBottom, dragState.fillTop);
    if (overlapping !== dragState.overlapping) {
      setHighlight(dragState.meshes, overlapping ? RED_EMISSIVE : SELECT_EMISSIVE);
      dragState.overlapping = overlapping;
    }
    updateEditInputs();
  } else {
    // Вешало — не следует за мышью непрерывно, а прыгает к ближайшему кандидату (полке) —
    // пересчитываем позицию мешей только когда "ближайший" реально сменился.
    const virtualY = dragState.startAnchorY + deltaY;
    let nearest = dragState.candidates[0];
    let bestDist = Infinity;
    dragState.candidates.forEach(c => {
      const d = Math.abs(c.y - virtualY);
      if (d < bestDist) { bestDist = d; nearest = c; }
    });
    if (nearest.id !== dragState.currentAnchorId) {
      const offset = nearest.y - dragState.startAnchorY;
      dragState.meshes.forEach((m, i) => { m.position.y = dragState.originalY[i] + offset; });
      dragState.currentAnchorId = nearest.id;
    }
  }
}

function onPointerUp() {
  if (!dragState) return;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);

  const wasItem = dragState.kind === 'item';
  if (wasItem) {
    if (dragState.overlapping) {
      showToast('Здесь нельзя разместить элемент — пересечение с другим. Возвращён на место.');
    } else {
      dragState.item.y = dragState.candidateY;
    }
    // При пересечении state не трогаем — buildFurniture() ниже вернёт геометрию на исходное место.
  } else {
    dragState.sec.valetAnchorId = dragState.currentAnchorId;
  }
  dragState = null;
  buildFurniture();

  // Элемент остаётся "выбранным" после отпускания — переподсвечиваем на свежих мешах (старые
  // уничтожены пересборкой) и для kind:'item' держим редактируемые поля точного размера
  // открытыми, чтобы можно было допечатать число с клавиатуры без повторной мышиной точности.
  if (active) {
    active.meshes = wasItem
      ? (lastBuildItemMeshes.get(active.sectionIndex + '|' + active.item.id) || [])
      : (lastBuildValetMeshes.get(active.sectionIndex) || []);
    setHighlight(active.meshes, SELECT_EMISSIVE);
    if (wasItem) updateEditInputs();
  }
}

export function initItemDrag() {
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}
