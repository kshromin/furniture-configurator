import * as THREE from 'three';
import { camera, renderer, controls, furnitureGroup } from './scene.js';
import { state } from './state.js';
import { buildFurniture } from './build.js';
import { showToast } from './toast.js';
import {
  lastBuildItemMeshes, lastBuildValetMeshes, checkOverlap, sectionVerticalBounds,
  valetAnchorCandidates, resolveValetAnchorY,
} from '../types/_wardrobe-shared.js';

// Свободное перетаскивание мышкой наполнения секции (полки/ящики/сетка/корзины/штанга) — во
// время драга элемент может визуально проходить сквозь другие (двигаем меши напрямую, без
// проверки на каждый кадр), но зафиксировать (pointerup) можно только в свободном месте —
// иначе подсветка красным и возврат на исходную позицию. Вешало — отдельная ветка: не двигается
// свободно, а прыгает между полками (снап к ближайшему кандидату при отпускании).
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeHit = new THREE.Vector3();
const startHit = new THREE.Vector3();

const RED_EMISSIVE = 0xff2222;

let dragState = null;

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

function setOverlapHighlight(meshes, on) {
  meshes.forEach(mesh => {
    if (!mesh.material || !mesh.material.emissive) return;
    if (on) {
      if (mesh.userData._origEmissive === undefined) mesh.userData._origEmissive = mesh.material.emissive.getHex();
      mesh.material.emissive.setHex(RED_EMISSIVE);
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

function onPointerDown(e) {
  const picked = pickDraggable(e);
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
    dragState = {
      kind: 'item', sec, item, itemType, meshes,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startItemY: item.y, candidateY: item.y,
      fillBottom, fillTop, overlapping: false,
    };
  } else {
    const meshes = lastBuildValetMeshes.get(sectionIndex) || [];
    if (!meshes.length) return;
    const startAnchorY = resolveValetAnchorY(sec);
    const candidates = valetAnchorCandidates(sec);
    dragState = {
      kind: 'valet', sec, meshes,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startAnchorY, candidates,
      currentAnchorId: sec.valetAnchorId ?? null,
    };
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
      setOverlapHighlight(dragState.meshes, overlapping);
      dragState.overlapping = overlapping;
    }
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

  if (dragState.kind === 'item') {
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
}

export function initItemDrag() {
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}
