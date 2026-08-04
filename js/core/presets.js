import { state, materials, markStateSafe } from './state.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { buildFurniture } from './build.js';
import { resetHistory } from './history.js';
import { rebalanceSections, defaultItemsForSection } from '../types/_wardrobe-shared.js';

export function applyPreset(p) {
  state.type    = p.type || 'wardrobe';
  state.width   = p.width;
  state.height  = p.height;
  state.depth   = p.depth;
  state.drawers = p.drawers || 0; // плоское значение — для комода и т.п.

  // Пресеты хранят секции по-старому (одно число + общие полки/ящики/штанга на все секции) —
  // раскладываем это в массив секций с равными ширинами, дальше rebalanceSections() их посчитает.
  // items — расставлены defaultItemsForSection в первое свободное место (см. _wardrobe-shared.js);
  // state.height/depth уже присвоены выше, поэтому границы секции считаются под новый пресет.
  const n = p.sections || 2;
  state.sections = Array.from({ length: n }, () => ({
    width: 0,
    items: defaultItemsForSection({ shelves: 1 + (p.shelves || 0), drawers: p.drawers || 0, rod: p.rod ? 1 : 0, drawerHeight: 150 }),
    drawerHeight: 150, drawerDepth: 500, drawerSlideType: 'soft',
    drawerHandleType: 'standard', drawerHandleName: '', drawerHandlePrice: 0,
    meshDepth: 400, meshColor: 'silver', valet: 0, valetAnchorId: null, valetLength: 400,
    basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver',
    widthLocked: false,
    backWallSegments: [],
    lockedGaps: [],
  }));

  state.korpusProducer = p.korpusProducer;
  state.korpusId       = p.korpusId;
  state.fasadProducer  = p.fasadProducer;
  state.fasadId        = p.fasadId;
  state.fillProducer   = p.fillProducer;
  state.fillId         = p.fillId;
  rebalanceSections();
  syncUIFromState();
  buildFurniture();
  markStateSafe();
  resetHistory(); // другой пресет — не откатываться в историю прежнего дизайна (см. history.js)
}

// ── Пользовательские шаблоны (задание «сохранять шаблоны 3,08») ────────────────────────────────
// «Та прорисовка, что нравится» сохраняется в шаблон и запускается быстрым нажатием. Храним ПОЛНЫЙ
// снимок state (как позиции заказа) в localStorage — на эту машину/браузер (один пользователь).
const USER_TPL_KEY = 'userTemplates';
function loadUserTemplates() {
  try { return JSON.parse(localStorage.getItem(USER_TPL_KEY)) || []; } catch { return []; }
}
function saveUserTemplates(list) { localStorage.setItem(USER_TPL_KEY, JSON.stringify(list)); }

// Сохранить текущую прорисовку как шаблон (имя спрашиваем; дефолт — тип+габариты).
export function saveCurrentAsTemplate() {
  const def = `${TYPES[state.type]?.name || state.type} ${state.width}×${state.height}`;
  const name = (window.prompt('Название шаблона:', def) || '').trim();
  if (!name) return;
  const list = loadUserTemplates();
  list.push({
    id: Date.now(), name, type: state.type,
    width: state.width, height: state.height, depth: state.depth,
    snapshot: JSON.parse(JSON.stringify(state)),
  });
  saveUserTemplates(list);
  renderPresets();
}
function deleteUserTemplate(id) {
  saveUserTemplates(loadUserTemplates().filter(t => t.id !== id));
  renderPresets();
}
// Быстрый старт из шаблона — восстановить полный снимок state.
function applyUserTemplate(tpl) {
  Object.assign(state, JSON.parse(JSON.stringify(tpl.snapshot)));
  syncUIFromState();
  buildFurniture();
  markStateSafe();
  resetHistory();
}

// Скрытие предустановленных шаблонов «из списка» (задание): каталог (materials.presets) —
// общий/админский, физически из него не удаляем; прячем локально по названию (localStorage).
const HIDDEN_KEY = 'hiddenPresets';
function loadHidden() { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []; } catch { return []; } }
function hidePreset(name) {
  const h = loadHidden();
  if (!h.includes(name)) h.push(name);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(h));
  renderPresets();
}

export function renderPresets() {
  const container = document.getElementById('presets');
  if (!container) return;
  container.innerHTML = '';
  const hidden = loadHidden();
  // Шаблоны типов «в разработке» скрываем — шаблон открыл бы заблокированный тип. Плюс скрытые
  // пользователем предустановленные (по названию) не показываем.
  (materials.presets || []).filter(p => p.type === 'wardrobe' && !hidden.includes(p.name)).forEach(p => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    const typeName = TYPES[p.type]?.name || p.type;

    card.innerHTML = `
      <div class="preset-card-name">${p.name}</div>
      <div class="preset-card-desc">${typeName} · ${p.width}×${p.height}×${p.depth} мм</div>
      <button class="preset-del-btn" title="Убрать из списка">×</button>
    `;
    card.addEventListener('click', () => {
      applyPreset(p);
      document.querySelector('[data-tab="type"]').click();
    });
    card.querySelector('.preset-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      hidePreset(p.name);
    });
    container.appendChild(card);
  });

  // Пользовательские шаблоны (сохранённые прорисовки) — после предустановленных, с удалением.
  loadUserTemplates().forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'preset-card preset-card-user';
    const typeName = TYPES[tpl.type]?.name || tpl.type;
    card.innerHTML = `
      <div class="preset-card-name">${tpl.name}</div>
      <div class="preset-card-desc">${typeName} · ${tpl.width}×${tpl.height}×${tpl.depth} мм · мой шаблон</div>
      <button class="preset-del-btn" title="Удалить шаблон">×</button>`;
    card.addEventListener('click', () => {
      applyUserTemplate(tpl);
      document.querySelector('[data-tab="type"]').click();
    });
    card.querySelector('.preset-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteUserTemplate(tpl.id);
    });
    container.appendChild(card);
  });
}
