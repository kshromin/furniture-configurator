import { materials, state } from './state.js';
import { buildFurniture } from './build.js';

export function getProducers(group) { return materials[group]?.producers || []; }

export function getColors(group, producerId) {
  const p = getProducers(group).find(p => p.id === producerId);
  return p ? p.colors : [];
}

export function getColor(group) {
  const id = state[group + 'Id'];
  const pid = state[group + 'Producer'];
  const colors = getColors(group, pid);
  return colors.find(c => c.id === id) || colors[0] || { color: '#cccccc', pricePerM2: 0 };
}

// ── ХДФ задней стенки: свой список исполнений (задание «разобр с хдф») ──────────────────────
// В корпус/фасад/наполнение ХДФ не идёт — это материал только задней стенки, поэтому и список
// отдельный (materials.hdf.colors), и выбор свой, рядом с кнопками «Задняя стенка».
export function hdfColors() { return materials.hdf?.colors || []; }

export function hdfColor() {
  const cols = hdfColors();
  return cols.find(c => c.id === state.hdfId) || cols[0] || null;
}

// ── Наполнение двери: типы со списком цветов ────────────────────────────────────────────────
// Встроенное «Стекло» + ПРОИЗВОЛЬНЫЕ типы из каталога (slidingDoor.fills.extra — заводятся
// выгрузкой/загрузкой ассортимента, сессия 68). ЛДСП/Зеркало/Спеццвет своих цветов не имеют и
// сюда не входят — они выбираются как отдельные варианты. Пустой каталог → только «Стекло».
export function doorFillTypes() {
  const f = materials.slidingDoor?.fills || {};
  const list = [];
  if (f.glass?.colors?.length) list.push({ id: 'glass', name: f.glass.name || 'Стекло', colors: f.glass.colors });
  (f.extra || []).forEach(t => {
    if (t?.colors?.length) list.push({ id: t.id, name: t.name, colors: t.colors });
  });
  return list;
}

// Цвета выбранного типа наполнения (или null, если у типа их нет — ЛДСП/зеркало/спеццвет).
export function doorFillTypeColors(fillId) {
  return doorFillTypes().find(t => t.id === fillId)?.colors || null;
}

// Конкретный цвет типа: по id, иначе первый (каталог мог измениться — не падаем).
export function doorFillColorEntry(fillId, colorId) {
  const cols = doorFillTypeColors(fillId);
  if (!cols) return null;
  return cols.find(c => c.id === colorId) || cols[0] || null;
}

// ── Фурнитура из каталога (fittingOptions) ──────────────────────────────────────────────────
// Позиции, которые пользователь ведёт сам: {gid, group, name, unit, price} — заводятся выгрузкой
// ассортимента (лист «Фурнитура», нижняя таблица; раздел = колонка «От чего зависит»). Раздел
// пользователь пишет текстом, поэтому ручки ящиков ищем по слову «ручк» в названии раздела.
export const HANDLE_GROUP_RE = /ручк/i;

export function fittingOptionsOf(groupRe) {
  return (materials.fittingOptions || []).filter(o => groupRe.test(String(o.group || '')));
}

export function fittingOption(gid) {
  return (materials.fittingOptions || []).find(o => o.gid === gid) || null;
}

// Ручки ящиков из каталога (пусто, пока раздел не заведён — тогда работают только встроенные).
export function handleOptions() { return fittingOptionsOf(HANDLE_GROUP_RE); }

// sec.drawerHandleType вида 'fitopt:<gid>' → позиция каталога (иначе null: standard/manual/none).
export function handleOptionOf(type) {
  return typeof type === 'string' && type.startsWith('fitopt:') ? fittingOption(type.slice(7)) : null;
}

const SWATCH_NAME_IDS = { korpus: 'korpusColorName', fasad: 'fasadColorName', fill: 'fillColorName' };

// Выбор материала — ВЫПАДАЮЩИМ СПИСКОМ, а не плиткой цветных образцов (решение пользователя
// 7.08): декоров в реальном прайсе сотни, образцами такой список не читается. Под списком —
// короткая подпись: тип и толщина. Цену не пишем — она видна только в спецификации.
export function renderColorSelect(group, selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const colors = getColors(group, state[group + 'Producer']);
  sel.innerHTML = colors.map(c =>
    `<option value="${c.id}"${c.id === state[group + 'Id'] ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('');
  if (!sel.dataset.bound) {                 // слушатель один на элемент, не на каждый перерендер
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
      state[group + 'Id'] = sel.value;
      renderColorSelect(group, selectId);
      buildFurniture();
    });
  }
  const nameEl = document.getElementById(SWATCH_NAME_IDS[group]);
  if (nameEl) {
    const cur = colors.find(c => c.id === state[group + 'Id']);
    nameEl.textContent = cur ? [cur.kind, cur.thickness ? cur.thickness + ' мм' : ''].filter(Boolean).join(' · ') : '';
  }
}

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

export function renderProducerSelect(group, selectId, colorSelectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  getProducers(group).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = state[group + 'Producer'];
  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
      state[group + 'Producer'] = sel.value;
      const colors = getColors(group, sel.value);
      state[group + 'Id'] = colors[0]?.id || null;
      renderColorSelect(group, colorSelectId);
      buildFurniture();
    });
  }
  renderColorSelect(group, colorSelectId);
}
