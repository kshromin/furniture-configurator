import { state, materials } from './state.js';
import { buildFurniture } from './build.js';
import { getColor } from './materials.js';
import { showToast } from './toast.js';
import { syncFasadUI } from './tabs.js';
import { getActiveDoorIndex } from './itemDrag.js';
import { doorCustomSegments, lastBuildDoorLayout } from '../types/_wardrobe-shared.js';

// Окно «Редактировать дверь» (задание «двери-начали 20,07»): показывает ОДНУ дверь (выделенную
// в 3D или выбранную кнопками в шапке) схемой SVG + редактор. Профиль и цвет здесь — те же
// глобальные state.profile/profileColor, что и на «Фасаде» (меняются синхронно на весь шкаф —
// решение пользователя); индивидуальны для двери только горизонтальные перемычки и наполнение
// получившихся секций полотна (state.doorCustom[i], см. state.js).
//
// Правки применяются к 3D/цене сразу (наглядно), но окно транзакционное: на открытии снимается
// снапшот всего, что окно умеет менять, — «Сохранить» закрывает с сохранением, закрытие
// крестиком/кликом мимо/Escape откатывает к снапшоту (просьба пользователя — явная кнопка
// сохранения после редактирования).
//
// SVG — схема, не 3D: рамка и перемычки цветом профиля, секции полотна цветом наполнения
// (ЛДСП — цвет фасада, зеркало — голубоватое, спеццвет — розоватый), те же цвета, что и в
// buildSlidingDoor. Разбивка на секции — doorCustomSegments, та же функция, что и в цене.

const FILL_LABELS = { ldsp: 'ЛДСП', mirror: 'Зеркало', special: 'Спец. цвет' };
const FILL_COLORS = { mirror: '#cfe8ec', special: '#e8b4c8' };
const SVG_H = 380; // высота схемы двери в px, ширина масштабируется по реальным пропорциям
// Минимум между центрами соседних перемычек: 40 профиль + 30 видимая секция (как отступ от рамки).
// Общий для полей ввода и перетаскивания — перемычка не перескакивает соседнюю.
const MIN_GAP = 70;

let currentDoor = 0;

const doorCount = () => lastBuildDoorLayout?.xs.length || 0;

// Кастом двери создаётся лениво при первом редактировании; наполнение единственной секции
// стартует с текущего глобального, чтобы дальнейшая смена глобального не меняла уже
// настроенную дверь исподтишка.
function ensureCustom(i) {
  if (!state.doorCustom) state.doorCustom = {};
  if (!state.doorCustom[i]) state.doorCustom[i] = { dividers: [], fills: [state.doorFill] };
  return state.doorCustom[i];
}

function fillColor(fill) {
  return FILL_COLORS[fill] || getColor('fasad').color;
}

function rerender() {
  buildFurniture(); // 3D за модалом обновляется сразу — наглядно
  render();
}

function render() {
  const L = lastBuildDoorLayout;
  if (!L) return;
  if (currentDoor >= doorCount()) currentDoor = 0;
  const custom = state.doorCustom?.[currentDoor];
  const { segments, dividers } = doorCustomSegments(custom, L.doorH);
  const globalFill = state.doorFill;
  const cat = materials.slidingDoor || {};
  const colorEntry = (cat.colors || []).find(c => c.id === state.profileColor);
  const frameHex = colorEntry?.hex || '#c4c4c8';

  // Кнопки выбора двери
  const doorBtns = document.getElementById('doorEditorDoorBtns');
  doorBtns.innerHTML = '';
  for (let i = 0; i < doorCount(); i++) {
    const b = document.createElement('button');
    b.className = 'opt-btn' + (i === currentDoor ? ' active' : '');
    b.textContent = `Дверь ${i + 1}`;
    b.addEventListener('click', () => { currentDoor = i; render(); });
    doorBtns.appendChild(b);
  }

  // SVG-схема двери: рамка/перемычки цветом профиля, секции цветом наполнения (снизу вверх)
  const scale = SVG_H / L.doorH;
  const svgW = Math.round(L.doorW * scale);
  const fw = Math.max(3, Math.round(40 * scale)); // видимая рамка на схеме
  const svg = document.getElementById('doorEditorSvg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${SVG_H}`);
  svg.style.width = svgW + 'px';
  svg.style.height = SVG_H + 'px';
  let rects = `<rect x="0" y="0" width="${svgW}" height="${SVG_H}" rx="3" fill="${frameHex}" stroke="#8a8a8e" stroke-width="1"/>`;
  // Секции: segments снизу вверх, в SVG y — сверху; идём по накопленной высоте
  let accMm = 40; // нижняя рамка
  segments.forEach(sgm => {
    const hPx = sgm.hMm * scale;
    const yPx = SVG_H - (accMm + sgm.hMm) * scale;
    rects += `<rect x="${fw}" y="${yPx.toFixed(1)}" width="${svgW - 2 * fw}" height="${hPx.toFixed(1)}" fill="${fillColor(sgm.fill || globalFill)}"/>`;
    accMm += sgm.hMm + 40; // + перемычка
  });
  dividers.forEach(d => {
    const yPx = SVG_H - (d + 20) * scale;
    rects += `<rect x="${fw}" y="${yPx.toFixed(1)}" width="${svgW - 2 * fw}" height="${Math.max(3, 40 * scale).toFixed(1)}" fill="${frameHex}"/>`;
  });
  // Табло размеров цепочкой (задание «двери доделка 20,07»): от низа до 1-й перемычки, между
  // перемычками (центр-центр, те же числа, что в полях справа) и остаток до верха двери —
  // сумма всегда равна высоте двери. Белая обводка — читается на любом наполнении.
  let prevMm = 0;
  [...dividers, L.doorH].forEach(to => {
    const midY = SVG_H - ((prevMm + to) / 2) * scale;
    rects += `<text x="${(svgW / 2).toFixed(1)}" y="${(midY + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#222" stroke="#fff" stroke-width="3" paint-order="stroke">${Math.round(to - prevMm)}</text>`;
    prevMm = to;
  });
  // Невидимые зоны захвата (выше самих перемычек — при масштабе схемы перемычка всего ~7px):
  // тащим перемычку мышкой вверх/вниз, см. startDividerDrag.
  dividers.forEach((d, j) => {
    const yPx = SVG_H - d * scale;
    rects += `<rect data-div="${j}" x="0" y="${(yPx - 8).toFixed(1)}" width="${svgW}" height="16" fill="transparent" style="cursor:ns-resize"/>`;
  });
  svg.innerHTML = rects;
  svg.querySelectorAll('[data-div]').forEach(r => {
    r.addEventListener('pointerdown', e => startDividerDrag(e, Number(r.dataset.div)));
  });

  // Правая колонка: профиль/цвет (глобальные) + перемычки + секции
  const ctrl = document.getElementById('doorEditorControls');
  ctrl.innerHTML = '';

  const addTitle = t => { const d = document.createElement('div'); d.className = 'field-group-title'; d.textContent = t; ctrl.appendChild(d); };
  const addNote = t => { const d = document.createElement('div'); d.className = 'swatch-name'; d.textContent = t; ctrl.appendChild(d); };

  addTitle('Профиль (весь шкаф)');
  const profRow = document.createElement('div');
  profRow.className = 'door-editor-btn-row';
  (cat.profiles || []).forEach(p => {
    const b = document.createElement('button');
    b.className = 'opt-btn' + (state.profile === p.id ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => { state.profile = p.id; syncFasadUI(); rerender(); });
    profRow.appendChild(b);
  });
  ctrl.appendChild(profRow);

  const colorRow = document.createElement('div');
  colorRow.className = 'profile-colors';
  (cat.colors || []).forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'profile-color-btn' + (state.profileColor === c.id ? ' active' : '');
    b.style.background = c.hex;
    b.title = c.name;
    b.addEventListener('click', () => { state.profileColor = c.id; syncFasadUI(); rerender(); });
    colorRow.appendChild(b);
  });
  ctrl.appendChild(colorRow);

  addTitle('Перемычки');
  // Размеры цепочкой (задание «двери доделка 20,07»): не абсолютная высота каждой перемычки от
  // низа, а расстояние от низа до 1-й, от 1-й до 2-й и т.д. Хранение не менялось (абсолютные мм,
  // state.doorCustom[i].dividers) — пересчёт только на показе и на вводе.
  addNote('Расстояния в мм: от низа двери до 1-й, от 1-й до 2-й и т.д.');
  const lo = 40 + 30, hi = Math.round(L.doorH) - 40 - 30;
  dividers.forEach((d, j) => {
    const base = j === 0 ? 0 : dividers[j - 1];
    // Перемычка двигается между соседями (не перескакивает): цепочные значения соседних полей
    // при перескоке молча поменялись бы местами после сортировки.
    const loEff = Math.max(lo, j === 0 ? lo : base + MIN_GAP);
    const hiEff = Math.min(hi, j < dividers.length - 1 ? dividers[j + 1] - MIN_GAP : hi);
    const row = document.createElement('div');
    row.className = 'door-editor-divider-row';
    const label = document.createElement('span');
    label.className = 'el-row-label';
    label.textContent = j === 0 ? 'низ → 1' : `${j} → ${j + 1}`;
    row.appendChild(label);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'dim-input';
    inp.autocomplete = 'off';
    inp.value = Math.round(d - base);
    inp.min = Math.max(1, loEff - base); inp.max = Math.max(1, hiEff - base); inp.step = 10;
    inp.addEventListener('change', () => {
      const raw = base + (Number(inp.value) || 0);
      const v = Math.min(hiEff, Math.max(loEff, raw));
      const c = ensureCustom(currentDoor);
      c.dividers = [...dividers];
      c.dividers[j] = v;
      rerender();
    });
    const del = document.createElement('button');
    del.className = 'section-remove-btn';
    del.title = 'Убрать перемычку (секции объединятся)';
    del.textContent = '×';
    del.addEventListener('click', () => {
      const c = ensureCustom(currentDoor);
      c.dividers = dividers.filter((_, k) => k !== j);
      c.fills.splice(j + 1, 1); // верхняя из двух объединяемых секций исчезает, нижняя остаётся
      rerender();
    });
    row.appendChild(inp);
    row.appendChild(del);
    ctrl.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'add-item-btn';
  addBtn.type = 'button';
  addBtn.textContent = '+ Добавить перемычку';
  addBtn.addEventListener('click', () => {
    // Новая перемычка — в середину самой высокой секции, её наполнение наследуется обеими половинами
    let best = 0;
    segments.forEach((s, j) => { if (s.hMm > segments[best].hMm) best = j; });
    if (segments[best].hMm < 200) { showToast('Секции слишком низкие для ещё одной перемычки.'); return; }
    let base = 40;
    for (let j = 0; j < best; j++) base += segments[j].hMm + 40;
    const pos = Math.round(base + segments[best].hMm / 2);
    const c = ensureCustom(currentDoor);
    c.dividers = [...dividers, pos].sort((a, b) => a - b);
    const at = c.dividers.indexOf(pos);
    c.fills.splice(at + 1, 0, c.fills[at] ?? state.doorFill);
    rerender();
  });
  ctrl.appendChild(addBtn);

  addTitle('Наполнение секций');
  addNote(segments.length > 1 ? 'Секции — сверху вниз' : 'Одна секция (без перемычек)');
  [...segments].reverse().forEach((sgm, revIdx) => {
    const j = segments.length - 1 - revIdx; // индекс снизу вверх, как в fills
    const row = document.createElement('div');
    row.className = 'door-editor-fill-row';
    const label = document.createElement('span');
    label.className = 'el-row-label';
    label.textContent = segments.length > 1 ? `${revIdx + 1} (${Math.round(sgm.hMm)} мм)` : 'Вся дверь';
    row.appendChild(label);
    // Выпадающий список вместо ряда кнопок (задание 21.07): вариантов наполнения будет больше
    // (стёкла и т.п.), ряд кнопок в строке секции не масштабируется.
    const sel = document.createElement('select');
    sel.className = 'mini-select-wide';
    Object.entries(FILL_LABELS).forEach(([f, name]) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = name;
      sel.appendChild(o);
    });
    sel.value = sgm.fill || globalFill;
    sel.addEventListener('change', () => {
      const f = sel.value;
      const c = ensureCustom(currentDoor);
      while (c.fills.length < segments.length) c.fills.push(globalFill);
      c.fills[j] = f;
      if (f === 'special') {
        // название и цена — пользователь забивает сам (название выходит в смету)
        const n = window.prompt('Название спец. цвета:', state.specialFillName || '');
        if (n !== null) state.specialFillName = n.trim();
        const v = window.prompt('Цена спец. цвета, ₽/м²:', String(state.specialFillPrice));
        if (v !== null && !isNaN(Number(v)) && Number(v) >= 0) state.specialFillPrice = Number(v);
      }
      rerender();
    });
    row.appendChild(sel);
    ctrl.appendChild(row);
  });
  if (segments.some(s => (s.fill || globalFill) === 'special')) {
    const nm = state.specialFillName ? `«${state.specialFillName}», ` : '';
    addNote(`Спец. цвет: ${nm}${state.specialFillPrice} ₽/м² (общие название и цена, меняются на «Фасаде» или при выборе)`);
  }
}

// Перетаскивание перемычки мышкой по схеме (задание «двери доделка 20,07»). Во время движения
// перерисовывается только окно (render — без 3D), полная пересборка сцены и цены — один раз на
// отпускании. Клампы к соседям фиксируются на старте (соседи во время драга не двигаются).
let dividerDrag = null;

function startDividerDrag(e, j) {
  const L = lastBuildDoorLayout;
  if (!L) return;
  e.preventDefault();
  const { dividers } = doorCustomSegments(state.doorCustom?.[currentDoor], L.doorH);
  const lo = 40 + 30, hi = Math.round(L.doorH) - 40 - 30;
  dividerDrag = {
    j,
    startClientY: e.clientY,
    startPos: dividers[j],
    scale: SVG_H / L.doorH, // svg рисуется в масштабе 1:1 к px (style.width/height = viewBox)
    loEff: Math.max(lo, j === 0 ? lo : dividers[j - 1] + MIN_GAP),
    hiEff: Math.min(hi, j < dividers.length - 1 ? dividers[j + 1] - MIN_GAP : hi),
  };
  window.addEventListener('pointermove', onDividerDrag);
  window.addEventListener('pointerup', endDividerDrag);
}

function onDividerDrag(e) {
  if (!dividerDrag) return;
  // Вверх по экрану (clientY меньше) = вверх по двери (мм больше); шаг 10мм, как у полей ввода
  const raw = dividerDrag.startPos + (dividerDrag.startClientY - e.clientY) / dividerDrag.scale;
  const v = Math.min(dividerDrag.hiEff, Math.max(dividerDrag.loEff, Math.round(raw / 10) * 10));
  const c = ensureCustom(currentDoor);
  const { dividers } = doorCustomSegments(c, lastBuildDoorLayout.doorH);
  c.dividers = [...dividers];
  c.dividers[dividerDrag.j] = v;
  render();
}

function endDividerDrag() {
  window.removeEventListener('pointermove', onDividerDrag);
  window.removeEventListener('pointerup', endDividerDrag);
  if (dividerDrag) { dividerDrag = null; rerender(); }
}

// Снапшот на открытии — всё, что окно умеет менять (в т.ч. глобальные профиль/цвет/цену
// спеццвета): закрытие без «Сохранить» возвращает ровно это состояние.
let openSnapshot = null;

export function openDoorEditor() {
  if (state.fasadDoorType !== 'sliding' || doorCount() === 0) {
    showToast('Редактирование двери доступно только у дверей-купе.');
    return;
  }
  currentDoor = getActiveDoorIndex() ?? 0;
  openSnapshot = JSON.stringify({
    doorCustom: state.doorCustom || {},
    profile: state.profile,
    profileColor: state.profileColor,
    doorFill: state.doorFill,
    specialFillPrice: state.specialFillPrice,
    specialFillName: state.specialFillName,
  });
  document.getElementById('doorEditorOverlay').classList.add('visible');
  render();
}

// «Сохранить» — правки уже в state (применялись живьём), просто фиксируем и закрываем.
function saveDoorEditor() {
  openSnapshot = null;
  document.getElementById('doorEditorOverlay').classList.remove('visible');
}

// Закрытие крестиком/кликом мимо/Escape — откат к снапшоту открытия.
export function closeDoorEditor() {
  if (openSnapshot) {
    Object.assign(state, JSON.parse(openSnapshot));
    openSnapshot = null;
    buildFurniture();
    syncFasadUI();
  }
  document.getElementById('doorEditorOverlay').classList.remove('visible');
}

export function bindDoorEditor() {
  document.getElementById('comboDoorBtn').addEventListener('click', openDoorEditor);
  document.getElementById('doorEditorSave').addEventListener('click', saveDoorEditor);
  const overlay = document.getElementById('doorEditorOverlay');
  document.getElementById('doorEditorClose').addEventListener('click', closeDoorEditor);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDoorEditor(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeDoorEditor();
  });
}
