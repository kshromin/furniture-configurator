import * as THREE from 'three';
import { camera, renderer, controls, furnitureGroup, isFrontView, showPerspectiveView } from './scene.js';
import { state } from './state.js';
import { buildFurniture } from './build.js';
import {
  lastBuildItemMeshes, lastBuildValetMeshes, lastBuildSectionCenters, lastBuildMezzanineSectionCenters, lastBuildY0,
  checkOverlap, boundsForZone, boundsForZonePhysical, secForZone, valetAnchorCandidates, resolveValetAnchorY,
  itemPhysicalBands, itemPhysicalHeight, itemBands, itemBandHeight, resolveLockedMove, absorbIntoLockedGap,
  nearestSupportSurfaceY, horizontalSupportYRange,
  clampDrawerOffsetWidth, MIN_DRAWER_OFFSET_WIDTH, MIN_DRAWER_REMAINING_WIDTH, DEFAULT_DRAWER_OFFSET_WIDTH,
} from '../types/_wardrobe-shared.js';
import { projectToOverlay, updateArrow, hideArrow } from './dimensions.js';
import { renderSectionsList, selectSectionFromScene } from './tabs.js';

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

// Смещение элемента до края одним нажатием (задание «смещение элемента до края 19,07») — стрелка
// рядом с полем просвета, жмёшь и элемент уходит вплотную к этому соседу: то же самое, что
// вписать 0 в поле и подтвердить (commitGapEdit/commitHSupportEdit уже умеют каскад по
// зафиксированным просветам и клампинг по границам — переиспользуем один в один, не дублируем).
const snapBelowBtn = document.createElement('button');
const snapAboveBtn = document.createElement('button');
snapBelowBtn.textContent = '▼';
snapAboveBtn.textContent = '▲';
snapBelowBtn.title = 'Сдвинуть вплотную к соседу снизу';
snapAboveBtn.title = 'Сдвинуть вплотную к соседу сверху';
[snapBelowBtn, snapAboveBtn].forEach(btn => {
  btn.type = 'button';
  btn.className = 'dim-snap-btn';
  btn.style.display = 'none';
  // Не должно приводить к клику по канвасу под оверлеем/сбрасывать текущий выбор — тот же приём,
  // что и у галочки фиксации просвета (.dim-lock-cb) в dimensions.js.
  btn.addEventListener('pointerdown', e => e.stopPropagation());
  overlay.appendChild(btn);
});
snapBelowBtn.addEventListener('click', e => { e.stopPropagation(); snapGap(true); });
snapAboveBtn.addEventListener('click', e => { e.stopPropagation(); snapGap(false); });

// Антресоли (задание «антресоли 19,07») — свой ряд секций (state.mezzanineSections), независимая
// от основного нумерация sectionIndex с нуля, поэтому центр по X ищем в своём массиве координат.
function centerForZone(zone, sectionIndex) {
  return zone === 'mezzanine' ? lastBuildMezzanineSectionCenters[sectionIndex] : lastBuildSectionCenters[sectionIndex];
}

function updatePointerNDC(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

// Рейкастим только настоящие меши (у edge-контуров addPanel — LineSegments — нет userData,
// они и так не .isMesh, но фильтруем явно для надёжности). hSupportSide проверяется ПЕРВЫМ —
// это меш горизонтальной перемычки штанги, левой или правой (см. wardrobe-geometry.js), у него
// тоже есть itemId (входит в общую подсветку штанги), но клик по НЕЙ (по любой её части — краб,
// труба или фланец) должен тащить именно эту перемычку, а не штангу целиком. Дальше — обычный
// itemId (перетаскиваемый элемент секции), затем 'valet' (вешало).
function pickDraggable(e) {
  updatePointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(furnitureGroup.children, true);
  for (const hit of hits) {
    const obj = hit.object;
    if (!obj.isMesh || !obj.userData) continue;
    // zone — 'main'|'mezzanine' (задание «антресоли 19,07», см. tagItemMesh в wardrobe-geometry.js);
    // на всякий случай подстрахуемся дефолтом 'main' для мешей без явной метки.
    const zone = obj.userData.zone || 'main';
    if (obj.userData.hSupportSide) return { mesh: obj, kind: 'hsupport', side: obj.userData.hSupportSide, zone };
    if (obj.userData.itemId) return { mesh: obj, kind: 'item', zone };
    if (obj.userData.itemType === 'valet') return { mesh: obj, kind: 'valet', zone };
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
const DRAWER_SLIDE_LABELS = { ball: 'шариковые', soft: 'скрытые, доводчик', push: 'скрытые, push', blum: 'скрытые BLUM' };

// Общий рефреш после тумблера в инфопанели (толщина полки, вертикальная/горизонтальная стойка
// штанги — все меняют state и просят пересборку): пересобирает 3D (старые меши уничтожены),
// переподсвечивает элемент на новых, перерисовывает саму панель с обновлёнными подписями/кнопками.
function refreshActive() {
  buildFurniture();
  active.meshes = lastBuildItemMeshes.get(active.sectionIndex + '|' + active.item.id) || [];
  setHighlight(active.meshes, SELECT_EMISSIVE);
  showInfoPanel();
}

function describeActive() {
  const { kind, sec, item, itemType } = active;
  if (kind === 'valet') return { title: 'Торцевое вешало', lines: [`Длина: ${sec.valetLength} мм`] };
  switch (itemType) {
    case 'shelf':
      return {
        title: item.pinned ? 'Полка (опорная)' : 'Полка',
        lines: [
          ...(item.pinned ? ['С планкой жёсткости снизу'] : []),
          `Толщина: ${item.thick32 ? 32 : 16} мм`,
        ],
        // Тумблер толщины прямо в инфопанели — «по выделению», как просил пользователь.
        actions: [{
          label: item.thick32 ? 'Сделать 16 мм' : 'Сделать 32 мм',
          onClick: () => { item.thick32 = !item.thick32; refreshActive(); },
        }],
      };
    case 'rod':
      return {
        title: 'Штанга',
        lines: [
          'Хром, ⌀25 мм',
          ...(item.verticalSupport ? ['+ вертикальная стойка до полки/дна'] : []),
          ...(item.verticalSupport && item.horizontalSupportLeft ? ['+ перемычка влево'] : []),
          ...(item.verticalSupport && item.horizontalSupportRight ? ['+ перемычка вправо'] : []),
        ],
        // Тумблеры прямо в инфопанели — «по выделению», тот же приём, что и толщина полки. Опора
        // вертикальной стойки — ближайшая ЛДСП-поверхность снизу (полка секции или пол), см.
        // nearestSupportSurfaceY/addRodSupport в wardrobe-geometry.js. Влево/вправо — независимые
        // перемычки к боковой стойке, доступны только когда вертикальная стойка уже есть (см.
        // задание «трубы вертикально плюс»); высота стыка с трубой — мышкой (см. addHorizontalSupport,
        // pickDraggable/onPointerDown ниже — kind:'hsupport').
        actions: [
          {
            label: item.verticalSupport ? 'Убрать вертикальную стойку' : 'Добавить вертикальную стойку',
            onClick: () => {
              item.verticalSupport = !item.verticalSupport;
              if (!item.verticalSupport) { item.horizontalSupportLeft = false; item.horizontalSupportRight = false; }
              refreshActive();
            },
          },
          ...(item.verticalSupport ? [
            {
              label: item.horizontalSupportLeft ? 'Убрать перемычку влево' : 'Перемычка к левой стойке',
              onClick: () => { item.horizontalSupportLeft = !item.horizontalSupportLeft; refreshActive(); },
            },
            {
              label: item.horizontalSupportRight ? 'Убрать перемычку вправо' : 'Перемычка к правой стойке',
              onClick: () => { item.horizontalSupportRight = !item.horizontalSupportRight; refreshActive(); },
            },
          ] : []),
        ],
      };
    case 'drawer': {
      // Смещающий элемент (задание «ящики-двери 19,07») — заглушка слева/справа той же высоты,
      // сам ящик становится уже секции на её ширину и сдвигается к противоположному краю. Ширина
      // заглушки — редактируемое поле (numberField), сторона — переключатель (actions), тот же
      // приём «по выделению», что и толщина полки/стойки штанги выше.
      const sw = sec.width;
      const offW = item.offsetSide ? clampDrawerOffsetWidth(sw, item.offsetWidth) : 0;
      return {
        title: 'Ящик',
        lines: [
          `Фасад: ${sec.drawerHeight} мм`, `Глубина короба: ${sec.drawerDepth} мм`,
          `Направляющие: ${DRAWER_SLIDE_LABELS[sec.drawerSlideType] || sec.drawerSlideType}`,
          ...(item.offsetSide ? [`Смещающий элемент: ${item.offsetSide === 'left' ? 'слева' : 'справа'}, ${Math.round(offW)} мм`] : []),
        ],
        actions: item.offsetSide ? [
          {
            label: item.offsetSide === 'left' ? 'Перенести элемент вправо' : 'Перенести элемент влево',
            onClick: () => { item.offsetSide = item.offsetSide === 'left' ? 'right' : 'left'; refreshActive(); },
          },
          {
            label: 'Убрать смещающий элемент',
            onClick: () => { item.offsetSide = null; refreshActive(); },
          },
        ] : [
          {
            label: 'Смещающий элемент слева',
            onClick: () => { item.offsetSide = 'left'; item.offsetWidth = clampDrawerOffsetWidth(sw, item.offsetWidth || DEFAULT_DRAWER_OFFSET_WIDTH); refreshActive(); },
          },
          {
            label: 'Смещающий элемент справа',
            onClick: () => { item.offsetSide = 'right'; item.offsetWidth = clampDrawerOffsetWidth(sw, item.offsetWidth || DEFAULT_DRAWER_OFFSET_WIDTH); refreshActive(); },
          },
        ],
        numberField: item.offsetSide ? {
          label: 'Ширина заглушки, мм',
          value: offW,
          min: MIN_DRAWER_OFFSET_WIDTH,
          max: Math.max(MIN_DRAWER_OFFSET_WIDTH, sw - MIN_DRAWER_REMAINING_WIDTH),
          onChange: v => { item.offsetWidth = clampDrawerOffsetWidth(sw, v); refreshActive(); },
        } : null,
      };
    }
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
  const { title, lines, actions, numberField } = describeActive();
  infoPanel.innerHTML = `<div class="drag-info-panel-title">${title}</div>${lines.map(l => `<div>${l}</div>`).join('')}`;
  (actions || []).forEach(({ label, onClick }) => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn';
    btn.style.cssText = 'margin-top:6px;width:100%';
    btn.textContent = label;
    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    infoPanel.appendChild(btn);
  });
  // Редактируемое числовое поле прямо в инфопанели (ширина заглушки смещающего элемента, задание
  // «ящики-двери 19,07») — тот же приём, что и тумблеры-actions выше, просто с числом вместо кнопки.
  if (numberField) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:6px';
    const label = document.createElement('span');
    label.textContent = numberField.label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'dim-input';
    inp.style.width = '64px';
    inp.min = numberField.min;
    inp.max = numberField.max;
    inp.value = Math.round(numberField.value);
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    inp.addEventListener('change', () => numberField.onChange(Number(inp.value)));
    row.appendChild(label);
    row.appendChild(inp);
    infoPanel.appendChild(row);
  }
  infoPanel.classList.add('visible');
}

function hideInfoPanel() {
  infoPanel.classList.remove('visible');
}

// ---------- редактируемые поля точного размера просвета (kind:'item' и 'hsupport') ----------

// Текущая Y элемента/ручки: во время живого драга — кандидатная позиция под курсором, иначе —
// уже зафиксированная в state (после отпускания мышки, но пока элемент ещё выбран).
function currentItemY() {
  if (dragState && dragState.item === active.item && dragState.kind === active.kind) return dragState.candidateY;
  return active.kind === 'hsupport' ? active.item[active.yField] : active.item.y;
}

// Соседние границы ищутся по ФИЗИЧЕСКИМ краям (как и статичные размерные линии) — поля при
// драге показывают реальные используемые расстояния, а не зазоры между полосами коллизии.
function neighborGaps(sec, itemId, lo, hi, fillBottom, fillTop) {
  let belowHi = fillBottom, aboveLo = fillTop;
  itemPhysicalBands(sec, itemId).forEach(b => {
    if (b.hi <= lo && b.hi > belowHi) belowHi = b.hi;
    if (b.lo >= hi && b.lo < aboveLo) aboveLo = b.lo;
  });
  return { belowHi, aboveLo };
}

// Стрелка-кнопка «сдвинуть вплотную» — сидит чуть правее своего поля (то же center-anchoring
// через translate(-50%,-50%) в CSS, просто со сдвигом по X, см. .dim-snap-btn).
function positionSnapBtn(btn, pos) {
  btn.style.left = (pos.x + 34) + 'px';
  btn.style.top = pos.y + 'px';
  btn.style.display = pos.behind ? 'none' : '';
}

// Поля просвета ручки перемычки (kind:'hsupport') — те же belowInput/aboveInput, но «соседи»
// тут не другие элементы секции, а фиксированные концы отрезка трубы: опора снизу (полка/пол) и
// сама штанга сверху (см. задание «трубы вертикально плюс», HORIZONTAL_SUPPORT_MARGIN).
function updateHSupportInputs() {
  const { sec, item, sectionIndex, zone } = active;
  const { fillBottom: fillBottomPhysical } = boundsForZonePhysical(zone);
  const surfaceY = nearestSupportSurfaceY(sec, item, fillBottomPhysical);
  const rodY = item.y;
  const y = currentItemY();
  active.hSurfaceY = surfaceY;
  active.hRodY = rodY;

  const cx = centerForZone(zone, sectionIndex);
  if (cx === undefined) return;

  const belowPos = projectToOverlay(cx, lastBuildY0 + (y + surfaceY) / 2, 0);
  belowInput.style.left = belowPos.x + 'px';
  belowInput.style.top = belowPos.y + 'px';
  belowInput.style.display = belowPos.behind ? 'none' : '';
  if (document.activeElement !== belowInput) belowInput.value = Math.round(y - surfaceY);
  updateArrow('drag-below', cx, lastBuildY0 + surfaceY, lastBuildY0 + y);
  positionSnapBtn(snapBelowBtn, belowPos);

  const abovePos = projectToOverlay(cx, lastBuildY0 + (y + rodY) / 2, 0);
  aboveInput.style.left = abovePos.x + 'px';
  aboveInput.style.top = abovePos.y + 'px';
  aboveInput.style.display = abovePos.behind ? 'none' : '';
  if (document.activeElement !== aboveInput) aboveInput.value = Math.round(rodY - y);
  updateArrow('drag-above', cx, lastBuildY0 + y, lastBuildY0 + rodY);
  positionSnapBtn(snapAboveBtn, abovePos);
}

function updateEditInputs() {
  if (!active || (active.kind !== 'item' && active.kind !== 'hsupport')) {
    belowInput.style.display = 'none';
    aboveInput.style.display = 'none';
    snapBelowBtn.style.display = 'none';
    snapAboveBtn.style.display = 'none';
    hideArrow('drag-below');
    hideArrow('drag-above');
    return;
  }
  if (active.kind === 'hsupport') { updateHSupportInputs(); return; }
  const { sec, item, itemType, sectionIndex, zone } = active;
  // Физические границы (поверхность дна/низ крыши) — те же, что у статичных размерных линий.
  const { fillBottom, fillTop } = boundsForZonePhysical(zone);
  const h = itemPhysicalHeight(itemType, sec, item); // физические края — согласовано с neighborGaps
  const y = currentItemY();
  const lo = y - h / 2, hi = y + h / 2;
  const { belowHi, aboveLo } = neighborGaps(sec, item.id, lo, hi, fillBottom, fillTop);
  active.belowHi = belowHi;
  active.aboveLo = aboveLo;
  active.h = h;

  const cx = centerForZone(zone, sectionIndex);
  if (cx === undefined) return;

  const belowPos = projectToOverlay(cx, lastBuildY0 + (lo + belowHi) / 2, 0);
  belowInput.style.left = belowPos.x + 'px';
  belowInput.style.top = belowPos.y + 'px';
  belowInput.style.display = belowPos.behind ? 'none' : '';
  if (document.activeElement !== belowInput) belowInput.value = Math.round(lo - belowHi);
  updateArrow('drag-below', cx, lastBuildY0 + belowHi, lastBuildY0 + lo);
  positionSnapBtn(snapBelowBtn, belowPos);

  const abovePos = projectToOverlay(cx, lastBuildY0 + (hi + aboveLo) / 2, 0);
  aboveInput.style.left = abovePos.x + 'px';
  aboveInput.style.top = abovePos.y + 'px';
  aboveInput.style.display = abovePos.behind ? 'none' : '';
  if (document.activeElement !== aboveInput) aboveInput.value = Math.round(aboveLo - hi);
  updateArrow('drag-above', cx, lastBuildY0 + hi, lastBuildY0 + aboveLo);
  positionSnapBtn(snapAboveBtn, abovePos);
}

// Коммит числа для ручки перемычки — просто клампит в допустимый диапазон (никаких соседей/
// каскада/фиксации просветов, это точка на отрезке трубы фиксированной длины).
function commitHSupportEdit(fromBelow) {
  const inp = fromBelow ? belowInput : aboveInput;
  const val = Number(inp.value);
  if (!Number.isFinite(val) || val < 0) { updateEditInputs(); return; }
  const { sec, item, side, yField, zone } = active;
  const { fillBottom: fillBottomPhysical } = boundsForZonePhysical(zone);
  const { lo, hi } = horizontalSupportYRange(sec, item, fillBottomPhysical);
  const raw = fromBelow ? active.hSurfaceY + val : active.hRodY - val;
  item[yField] = Math.min(Math.max(raw, lo), hi);
  buildFurniture();
  active.meshes = (lastBuildItemMeshes.get(active.sectionIndex + '|' + item.id) || []).filter(m => m.userData.hSupportSide === side);
  setHighlight(active.meshes, SELECT_EMISSIVE);
  updateEditInputs();
}

function commitGapEdit(fromBelow) {
  if (!active) return;
  if (active.kind === 'hsupport') { commitHSupportEdit(fromBelow); return; }
  if (active.kind !== 'item') return;
  const inp = fromBelow ? belowInput : aboveInput;
  const val = Number(inp.value);
  if (!Number.isFinite(val) || val < 0) { updateEditInputs(); return; }
  const { sec, item, zone } = active;
  const { fillBottom, fillTop } = boundsForZone(zone);
  const h = active.h;
  const newY = fromBelow ? active.belowHi + val + h / 2 : active.aboveLo - val - h / 2;
  // Зафиксированные просветы дальше по цепочке (sec.lockedGaps) двигают следующий свободный
  // элемент вместо себя — см. resolveLockedMove. Если упёрлись в границу секции, сдвиг просто
  // урезается по месту упора (без отдельного тоста — число в поле само покажет, что получилось).
  const { updates } = resolveLockedMove(sec, item.id, newY, fillBottom, fillTop);
  updates.forEach(u => {
    const it = sec.items.find(x => x.id === u.id);
    if (it) it.y = u.y;
  });
  absorbIntoLockedGap(sec, item.id);
  buildFurniture();
  // buildFurniture пересобрал меши — active.meshes устарели (старая группа очищена), обновляем
  // ссылку и переподсвечиваем на новых мешах (подсветка не переживает пересборку сама по себе).
  active.meshes = lastBuildItemMeshes.get(active.sectionIndex + '|' + item.id) || [];
  setHighlight(active.meshes, SELECT_EMISSIVE);
  updateEditInputs();
}

// Смещение до края одним нажатием (задание «смещение элемента до края 19,07») — dispatcher по
// kind, тот же принцип, что и у commitGapEdit. Для hsupport подстановка val=0 в существующий
// commitHSupportEdit уже корректна (тот КЛАМПИТ к границам диапазона, не отклоняет невалидное
// значение целиком). Для kind:'item' — отдельная реализация (snapToNeighbor), не через val=0 в
// commitGapEdit: тот считает целевую позицию от ФИЗИЧЕСКОЙ границы соседа/пола (active.belowHi/
// aboveLo, из itemPhysicalBands), а проверяет результат checkOverlap'ом по границе КОЛЛИЗИЙ
// (sectionVerticalBounds, у той есть свои +10мм отступа расстановки от пола/потолка секции) —
// у самого пола/потолка (когда физического соседа нет) эти две границы РАЗНЫЕ, и достигнутая
// физическая граница проваливает проверку коллизий — движение молча отклонялось.
function snapGap(fromBelow) {
  if (!active) return;
  if (active.kind === 'hsupport') {
    const inp = fromBelow ? belowInput : aboveInput;
    inp.value = 0;
    commitHSupportEdit(fromBelow);
    return;
  }
  if (active.kind !== 'item') return;
  snapToNeighbor(fromBelow);
}

function snapToNeighbor(fromBelow) {
  const { sec, item, itemType, zone } = active;
  const { fillBottom, fillTop } = boundsForZone(zone);
  const h = itemBandHeight(itemType, sec, item);
  const bands = itemBands(sec, item.id);
  let targetY;
  if (fromBelow) {
    const below = bands.filter(b => b.hi <= item.y).sort((a, b) => b.hi - a.hi)[0];
    targetY = (below ? below.hi : fillBottom) + h / 2;
  } else {
    const above = bands.filter(b => b.lo >= item.y).sort((a, b) => a.lo - b.lo)[0];
    targetY = (above ? above.lo : fillTop) - h / 2;
  }
  const { updates } = resolveLockedMove(sec, item.id, targetY, fillBottom, fillTop);
  updates.forEach(u => {
    const it = sec.items.find(x => x.id === u.id);
    if (it) it.y = u.y;
  });
  absorbIntoLockedGap(sec, item.id);
  buildFurniture();
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
  snapBelowBtn.style.display = 'none';
  snapAboveBtn.style.display = 'none';
  hideArrow('drag-below');
  hideArrow('drag-above');
  active = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && active && document.activeElement !== belowInput && document.activeElement !== aboveInput) closeActive();
  // Del/Backspace удаляет выделенный элемент — тот же приём, что и «×» на чипе в карточке
  // секции (см. tabs.js), просто без похода мышкой до сайдбара. Не трогаем валет (свой
  // чекбокс, не чип) и структурную (pinned) полку — та неудаляемая и через «×».
  if ((e.key === 'Delete' || e.key === 'Backspace') && active?.kind === 'item') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // не мешаем редактированию текстовых полей
    e.preventDefault(); // Backspace без фокуса на поле иначе уводит браузер «назад»
    if (active.item.pinned) return;
    const { sec, item } = active;
    sec.items = sec.items.filter(it => it.id !== item.id);
    closeActive();
    renderSectionsList();
    buildFurniture();
  }
});

function onPointerDown(e) {
  // Вид в плоскости (см. scene.js) выключается любым нажатием ЛКМ на 3D-виде — драг элемента
  // в этот момент не начинаем, клик расходуется на возврат в 3D.
  if (isFrontView()) {
    if (e.button === 0) showPerspectiveView();
    return;
  }
  const picked = pickDraggable(e);
  closeActive();
  if (!picked) { selectSectionFromScene(null); return; }
  e.preventDefault();
  controls.enabled = false;
  renderer.domElement.style.cursor = 'grabbing';

  const { sectionIndex } = picked.mesh.userData;
  const zone = picked.zone;
  const sec = secForZone(zone, sectionIndex);
  // Обратное направление клика по карточке (задание «выделение секции 19,07») — секция, в
  // которую попали в 3D, подсвечивается и в панели, без переключения вкладки сайдбара.
  selectSectionFromScene(sec);
  const { fillBottom, fillTop } = boundsForZone(zone);

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
    active = { kind: 'item', sectionIndex, zone, sec, item, itemType, meshes };
    dragState = {
      kind: 'item', sec, item, itemType, meshes,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startItemY: item.y, candidateY: item.y,
      fillBottom, fillTop, overlapping: false,
    };
    setHighlight(meshes, SELECT_EMISSIVE);
    showInfoPanel();
    updateEditInputs();
  } else if (picked.kind === 'hsupport') {
    // Перемычка штанги, левая или правая — независимо (см. задание «трубы вертикально плюс»):
    // тащим ВСЮ группу мешей ЭТОЙ стороны (краб+труба+фланец, см. hSupportSide в
    // wardrobe-geometry.js), клик по любой их части работает одинаково. Диапазон — между опорой
    // снизу и штангой сверху, с отступом (см. horizontalSupportYRange) — общий для обеих сторон,
    // но своё поле-высота (yField) у каждой.
    const { itemId } = picked.mesh.userData;
    const item = sec.items.find(it => it.id === itemId);
    if (!item) return;
    const side = picked.side;
    const yField = side === 'left' ? 'horizontalSupportLeftY' : 'horizontalSupportRightY';
    const meshes = (lastBuildItemMeshes.get(sectionIndex + '|' + itemId) || []).filter(m => m.userData.hSupportSide === side);
    if (!meshes.length) return;
    const { fillBottom: fillBottomPhysical } = boundsForZonePhysical(zone);
    const { lo, hi } = horizontalSupportYRange(sec, item, fillBottomPhysical);
    active = { kind: 'hsupport', sectionIndex, zone, sec, item, itemType: 'rod', meshes, side, yField };
    dragState = {
      kind: 'hsupport', sec, item, meshes, side, yField,
      originalY: meshes.map(m => m.position.y),
      startPointerY: startHit.y, startValueY: item[yField], candidateY: item[yField],
      lo, hi,
    };
    setHighlight(meshes, SELECT_EMISSIVE);
    showInfoPanel();
    updateEditInputs();
  } else {
    const meshes = lastBuildValetMeshes.get(zone + '|' + sectionIndex) || [];
    if (!meshes.length) return;
    const startAnchorY = resolveValetAnchorY(sec);
    const candidates = valetAnchorCandidates(sec);
    active = { kind: 'valet', sectionIndex, zone, sec, meshes };
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
    // Живой драг — меш свободно следует за мышью (может визуально проходить мимо/через другие
    // элементы, только подсвечивается красным), а не клампится в реальном времени: так было и
    // до фиксации просветов (сессия 28), пользователь заметил регресс — с клампом в моменте
    // драг ощущался «залипающим», элемент переставал протаскиваться мимо соседей. Финальная
    // позиция (в т.ч. каскад по sec.lockedGaps) считается один раз на отпускании — см. onPointerUp.
    dragState.meshes.forEach((m, i) => { m.position.y = dragState.originalY[i] + deltaY; });
    const candidateY = dragState.startItemY + deltaY;
    dragState.candidateY = candidateY;
    const overlapping = checkOverlap(candidateY, dragState.itemType, dragState.item.id, dragState.sec, dragState.fillBottom, dragState.fillTop, dragState.item);
    if (overlapping !== dragState.overlapping) {
      setHighlight(dragState.meshes, overlapping ? RED_EMISSIVE : SELECT_EMISSIVE);
      dragState.overlapping = overlapping;
    }
    updateEditInputs();
  } else if (dragState.kind === 'hsupport') {
    // Перемычка двигается строго между опорой и штангой (dragState.lo/hi, с отступом 30мм с
    // каждой стороны) — тут, в отличие от обычных элементов, клампинг в реальном времени уместен:
    // это не позиция среди свободно расставляемых соседей, а точка на отрезке трубы фиксированной
    // длины, дальше границ ей в принципе некуда деться.
    const rawY = dragState.startValueY + deltaY;
    const clampedY = Math.min(Math.max(rawY, dragState.lo), dragState.hi);
    dragState.candidateY = clampedY;
    dragState.meshes.forEach((m, i) => { m.position.y = dragState.originalY[i] + (clampedY - dragState.startValueY); });
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

  const dragKind = dragState.kind;
  if (dragKind === 'item') {
    // dragState.candidateY — сырая позиция под курсором (см. onPointerMove, live-драг ничего не
    // клампит). Здесь, один раз на отпускании, считаем каскад/клампинг по месту упора и по
    // зафиксированным просветам (sec.lockedGaps) — buildFurniture() ниже перерисует всё разом,
    // включая цепочку соседей, которые тоже сдвинулись.
    const { updates } = resolveLockedMove(dragState.sec, dragState.item.id, dragState.candidateY, dragState.fillBottom, dragState.fillTop);
    updates.forEach(u => {
      const it = dragState.sec.items.find(x => x.id === u.id);
      if (it) it.y = u.y;
    });
    // Если элемент попал между парой с зафиксированным просветом (см. задание «фиксация
    // размеров»), фиксируем и новую нижнюю половину — иначе исходный промежуток держится жёстким
    // только сверху.
    absorbIntoLockedGap(dragState.sec, dragState.item.id);
  } else if (dragKind === 'hsupport') {
    dragState.item[dragState.yField] = dragState.candidateY;
  } else {
    dragState.sec.valetAnchorId = dragState.currentAnchorId;
  }
  dragState = null;
  buildFurniture();

  // Элемент остаётся "выбранным" после отпускания — переподсвечиваем на свежих мешах (старые
  // уничтожены пересборкой) и для kind:'item'/'hsupport' держим редактируемые поля точного
  // размера открытыми, чтобы можно было допечатать число с клавиатуры без повторной мышиной
  // точности.
  if (active) {
    if (dragKind === 'hsupport') {
      active.meshes = (lastBuildItemMeshes.get(active.sectionIndex + '|' + active.item.id) || []).filter(m => m.userData.hSupportSide === active.side);
    } else if (dragKind === 'item') {
      active.meshes = lastBuildItemMeshes.get(active.sectionIndex + '|' + active.item.id) || [];
    } else {
      active.meshes = lastBuildValetMeshes.get(active.zone + '|' + active.sectionIndex) || [];
    }
    setHighlight(active.meshes, SELECT_EMISSIVE);
    if (dragKind === 'item' || dragKind === 'hsupport') updateEditInputs();
  }
}

export function initItemDrag() {
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}
