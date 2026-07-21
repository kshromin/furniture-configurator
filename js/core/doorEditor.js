import { state, materials } from './state.js';
import { buildFurniture } from './build.js';
import { getColor, getColors } from './materials.js';
import { fmt } from './pricing.js';
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

const FILL_LABELS = { ldsp: 'ЛДСП', mirror: 'Зеркало', glass: 'Стекло', special: 'Спец. цвет' };
const FILL_COLORS = { mirror: '#cfe8ec', special: '#e8b4c8' };
const SVG_H = 380; // высота схемы двери в px, ширина масштабируется по реальным пропорциям
// Минимум между центрами соседних перемычек: 40 профиль + 30 видимая секция (как отступ от рамки).
// Общий для полей ввода и перетаскивания — перемычка не перескакивает соседнюю.
const MIN_GAP = 70;

let currentDoor = 0;
// Выделенная строка «Наполнения секций» (индекс секции снизу вверх, как fills) — у выделенного
// спеццвета показываются цена за м² и стоимость секции. Сбрасывается при смене двери/открытии.
let selectedFillRow = null;

const doorCount = () => lastBuildDoorLayout?.xs.length || 0;

// Кастом двери создаётся лениво при первом редактировании; наполнение единственной секции
// стартует с текущего глобального, чтобы дальнейшая смена глобального не меняла уже
// настроенную дверь исподтишка.
function ensureCustom(i) {
  if (!state.doorCustom) state.doorCustom = {};
  if (!state.doorCustom[i]) state.doorCustom[i] = { dividers: [], fills: [state.doorFill] };
  return state.doorCustom[i];
}

// specialInfo — параллельный fills массив {name, price}|null (индивидуальные спеццвета секций,
// задание 21.07); создаётся лениво и добивается null до нужной длины (старые сохранённые
// проекты его не имеют вовсе).
function ensureSpecialInfo(c, len) {
  if (!c.specialInfo) c.specialInfo = [];
  while (c.specialInfo.length < len) c.specialInfo.push(null);
  return c.specialInfo;
}

// fillColors — то же для индивидуальных цветов секций (id цвета фасада у ЛДСП, id цвета стекла
// у glass), null = глобальный цвет.
function ensureFillColors(c, len) {
  if (!c.fillColors) c.fillColors = [];
  while (c.fillColors.length < len) c.fillColors.push(null);
  return c.fillColors;
}

// colorId — индивидуальный цвет секции (id цвета стекла для glass, id цвета фасада для ЛДСП),
// null — глобальные (doorGlassColor / выбранный цвет фасада). Та же логика, что doorFillColor
// в wardrobe-geometry.js — схема и 3D красятся одинаково.
function fillColor(fill, colorId) {
  if (fill === 'glass') {
    const cols = materials.slidingDoor?.fills?.glass?.colors || [];
    const c = cols.find(x => x.id === (colorId || state.doorGlassColor)) || cols[0];
    return c?.color || FILL_COLORS.mirror;
  }
  if (FILL_COLORS[fill]) return FILL_COLORS[fill];
  if (colorId) {
    const c = getColors('fasad', state.fasadProducer).find(x => x.id === colorId);
    if (c) return c.color;
  }
  return getColor('fasad').color;
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
    b.addEventListener('click', () => { currentDoor = i; selectedFillRow = null; render(); });
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
    rects += `<rect x="${fw}" y="${yPx.toFixed(1)}" width="${svgW - 2 * fw}" height="${hPx.toFixed(1)}" fill="${fillColor(sgm.fill || globalFill, sgm.fillColor)}"/>`;
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
  // Строки — сверху вниз, как дверь на схеме (просьба 21.07): верхняя перемычка первой,
  // «низ → 1» — внизу списка (тот же порядок, что и у «Наполнение секций» ниже).
  [...dividers.keys()].reverse().forEach(j => {
    const d = dividers[j];
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
      if (c.specialInfo) c.specialInfo.splice(j + 1, 1);
      if (c.fillColors) c.fillColors.splice(j + 1, 1);
      selectedFillRow = null; // индексы секций съехали
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
    if (c.specialInfo) c.specialInfo.splice(at + 1, 0, c.specialInfo[at] ?? null);
    if (c.fillColors) c.fillColors.splice(at + 1, 0, c.fillColors[at] ?? null);
    selectedFillRow = null; // индексы секций съехали
    rerender();
  });
  ctrl.appendChild(addBtn);

  addTitle('Наполнение секций');
  addNote(segments.length > 1 ? 'Секции — сверху вниз' : 'Одна секция (без перемычек)');
  // Строки выделяются кликом (задание 21.07): справа от селекта — цвет/название (для спеццвета —
  // название, которое ввёл пользователь: спеццветов в одной двери может быть несколько разных);
  // у выделенной строки со спеццветом появляется поле цены за м² и стоимость секции ниже списка.
  const totalH = segments.reduce((s, x) => s + x.hMm, 0) || 1;
  [...segments].reverse().forEach((sgm, revIdx) => {
    const j = segments.length - 1 - revIdx; // индекс снизу вверх, как в fills
    const fill = sgm.fill || globalFill;
    const sp = sgm.special;
    const row = document.createElement('div');
    row.className = 'door-editor-fill-row' + (selectedFillRow === j ? ' active' : '');
    row.addEventListener('click', () => {
      if (selectedFillRow !== j) { selectedFillRow = j; render(); }
    });
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
    sel.value = fill;
    sel.addEventListener('change', () => {
      const f = sel.value;
      const c = ensureCustom(currentDoor);
      while (c.fills.length < segments.length) c.fills.push(globalFill);
      c.fills[j] = f;
      selectedFillRow = j;
      if (f === 'special') {
        // название и цена — индивидуальные для секции (в одной двери разные спеццвета);
        // подсказки стартуют с прежних значений секции либо глобальных с «Фасада»
        const info = ensureSpecialInfo(c, segments.length);
        const prev = info[j];
        const n = window.prompt('Название спец. цвета:', prev?.name ?? state.specialFillName ?? '');
        const v = window.prompt('Цена спец. цвета, ₽/м²:', String(prev?.price ?? state.specialFillPrice));
        info[j] = {
          name: n !== null ? n.trim() : (prev?.name || ''),
          price: v !== null && !isNaN(Number(v)) && Number(v) >= 0 ? Number(v) : (prev?.price ?? state.specialFillPrice),
        };
      }
      rerender();
    });
    row.appendChild(sel);
    // Выбор цвета прямо в строке (задание 21.07): у ЛДСП — цвета фасада текущего производителя,
    // у стекла — цвета из каталога (прозрачное/ультрапрозрачное/плёнки). Индивидуально на секцию.
    if (fill === 'ldsp' || fill === 'glass') {
      const colorSel = document.createElement('select');
      colorSel.className = 'mini-select-wide door-editor-color-sel';
      const opts = fill === 'glass'
        ? (materials.slidingDoor?.fills?.glass?.colors || [])
        : getColors('fasad', state.fasadProducer);
      opts.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        colorSel.appendChild(o);
      });
      const globalId = fill === 'glass' ? state.doorGlassColor : getColor('fasad').id;
      colorSel.value = sgm.fillColor || globalId;
      if (!colorSel.value && opts[0]) colorSel.value = opts[0].id;
      colorSel.addEventListener('click', e => e.stopPropagation());
      colorSel.addEventListener('change', () => {
        const c = ensureCustom(currentDoor);
        while (c.fills.length < segments.length) c.fills.push(globalFill);
        ensureFillColors(c, segments.length)[j] = colorSel.value;
        selectedFillRow = j;
        rerender();
      });
      row.appendChild(colorSel);
    }
    // Справа: у спеццвета — название (клик — переименовать)
    const info = document.createElement('span');
    info.className = 'door-editor-fill-info';
    if (fill === 'special') {
      info.textContent = sp?.name || state.specialFillName || 'без названия';
      info.classList.add('renamable');
      info.title = 'Изменить название';
      info.addEventListener('click', e => {
        e.stopPropagation();
        const c = ensureCustom(currentDoor);
        const arr = ensureSpecialInfo(c, segments.length);
        const cur = arr[j] || { name: state.specialFillName || '', price: state.specialFillPrice };
        const n = window.prompt('Название спец. цвета:', cur.name);
        if (n !== null) { arr[j] = { ...cur, name: n.trim() }; selectedFillRow = j; render(); }
      });
    }
    row.appendChild(info);
    // Цена за м² — редактируется прямо здесь у выделенной строки со спеццветом
    if (selectedFillRow === j && fill === 'special') {
      const priceInp = document.createElement('input');
      priceInp.type = 'number';
      priceInp.className = 'dim-input door-editor-fill-price';
      priceInp.autocomplete = 'off';
      priceInp.min = 0; priceInp.step = 100;
      priceInp.value = sp?.price ?? state.specialFillPrice;
      priceInp.title = 'Цена, ₽/м²';
      priceInp.addEventListener('click', e => e.stopPropagation());
      priceInp.addEventListener('change', () => {
        const v = Math.max(0, Number(priceInp.value) || 0);
        const c = ensureCustom(currentDoor);
        const arr = ensureSpecialInfo(c, segments.length);
        arr[j] = { name: arr[j]?.name ?? state.specialFillName ?? '', price: v };
        rerender();
      });
      row.appendChild(priceInp);
    }
    ctrl.appendChild(row);
  });
  // Посчитанная стоимость именно этого наполнения (той же формулой, что и в цене — wardrobe.js
  // areas): доля высоты секции от полотна × площадь двери × цена за м²
  if (selectedFillRow !== null && segments[selectedFillRow]) {
    const sgm = segments[selectedFillRow];
    if ((sgm.fill || globalFill) === 'special') {
      const price = sgm.special?.price ?? state.specialFillPrice ?? 0;
      const nm = sgm.special?.name || state.specialFillName || 'без названия';
      const cost = (L.doorW * L.doorH / 1e6) * (sgm.hMm / totalH) * price;
      addNote(`Стоимость за «${nm}»: ${fmt(Math.round(cost))}`);
    }
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
  selectedFillRow = null;
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
