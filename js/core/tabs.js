import { state } from './state.js';
import { TYPES } from '../types/registry.js';
import { renderProducerSelect, renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';

function activeType() { return TYPES[state.type] || TYPES['wardrobe']; }

// ---------- type bar (полоса с названием текущего типа) ----------
export function updateTypeBar() {
  const name = activeType().name;
  document.getElementById('typeBarName').textContent =
    `${name}  ·  ${state.width} × ${state.height} мм`;
}

// ---------- generic per-tab context (какие поля видны для текущего типа) ----------
const CTX_DATASET_KEY = { variant: 'variantCtx', fill: 'fillCtx', fasad: 'fasadCtx' };

function applyCtxTab(tabName) {
  const ctx = activeType().ctx[tabName] || {};
  const dsKey = CTX_DATASET_KEY[tabName];
  document.querySelectorAll(`[data-${tabName}-ctx]`).forEach(el => {
    el.style.display = ctx[el.dataset[dsKey]] ? '' : 'none';
  });
  return ctx;
}

export function updateVariantContext() {
  applyCtxTab('variant');
}

export function updateFillContext() {
  const ctx = applyCtxTab('fill');
  const colorGroup = document.getElementById('fillColorGroup');
  const emptyNote  = document.getElementById('fillEmptyNote');
  const hasAny = Object.values(ctx).some(Boolean);
  if (colorGroup) colorGroup.style.display = ctx.color ? '' : 'none';
  if (emptyNote)  emptyNote.style.display  = hasAny ? 'none' : 'block';
}

export function updateFasadContext() {
  const ctx = activeType().ctx.fasad || {};
  const content   = document.getElementById('fasadContent');
  const emptyNote = document.getElementById('fasadEmptyNote');
  if (content)   content.style.display   = ctx.available ? '' : 'none';
  if (emptyNote) emptyNote.style.display = ctx.available ? 'none' : 'block';
}

export function updateAllContexts() {
  updateTypeBar();
  updateVariantContext();
  updateFillContext();
  updateFasadContext();
}

// ---------- sliders / generic fields ----------
export function setSlider(id, value, suffix) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value;
  const label = document.getElementById(id + 'Val');
  if (label) label.textContent = value + (suffix || '');
}

export function bindSlider(id, key, suffix) {
  const input = document.getElementById(id);
  const label = document.getElementById(id + 'Val');
  if (!input) return;
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    if (label) label.textContent = input.value + (suffix || '');
    if (key === 'width' || key === 'height') updateTypeBar();
    buildFurniture();
  });
}

export function syncUIFromState() {
  setSlider('width',    state.width,    ' мм');
  setSlider('height',   state.height,   ' мм');
  setSlider('depth',    state.depth,    ' мм');
  setSlider('sections', state.sections, '');
  setSlider('shelves',  state.shelves,  '');
  setSlider('drawers',  state.drawers,  '');
  document.getElementById('rod').checked = state.rod;

  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === state.type);
  });

  ['korpus', 'fasad', 'fill'].forEach(g => {
    const sel = document.getElementById(g + 'Producer');
    if (sel) {
      sel.value = state[g + 'Producer'];
      renderSwatches(g, g + 'Swatches');
    }
  });

  updateAllContexts();
}

// ---------- вкладка «Тип изделия» ----------
export function bindTypeButtons() {
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateAllContexts();
      buildFurniture();
    });
  });
}

// ---------- вкладка «Фасад» ----------
export function bindFasadTab() {
  document.querySelectorAll('.fasad-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fasad-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.fasadDoorType = btn.dataset.fasad;
      document.getElementById('fasadSlidingBlock').style.display = state.fasadDoorType === 'sliding' ? 'block' : 'none';
      document.getElementById('fasadSwingBlock').style.display   = state.fasadDoorType === 'swing'   ? 'block' : 'none';
      buildFurniture();
    });
  });

  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.profile = btn.dataset.profile;
    });
  });

  function showDoorFill(fill) {
    ['ldsp', 'mirror', 'glass'].forEach(f => {
      const el = document.getElementById('fill' + f.charAt(0).toUpperCase() + f.slice(1));
      if (el) el.style.display = f === fill ? 'block' : 'none';
    });
  }

  document.querySelectorAll('.door-fill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.door-fill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.doorFill = btn.dataset.fill;
      showDoorFill(state.doorFill);
      buildFurniture();
    });
  });

  document.querySelectorAll('.door-fill-btn2').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.door-fill-btn2').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.doorFill2 = btn.dataset.fill2;
    });
  });

  const comboCb = document.getElementById('doorCombo');
  comboCb.addEventListener('change', () => {
    document.getElementById('doorComboBlock').style.display = comboCb.checked ? 'block' : 'none';
    state.doorFill2 = comboCb.checked ? 'mirror' : null;
  });

  document.getElementById('glassType').addEventListener('change', e => { state.glassType = e.target.value; });

  renderProducerSelect('fasad', 'fasadProducer', 'fasadSwatches');
}

// ---------- вкладка «Внешнее» — доп. опции ----------
export function bindVariantControls() {
  const antresolCb = document.getElementById('antresolEnabled');
  const antresolFld = document.getElementById('antresolHeightField');
  antresolCb.addEventListener('change', () => {
    antresolFld.style.display = antresolCb.checked ? 'block' : 'none';
  });
  document.getElementById('antresolHeight').addEventListener('input', e => {
    document.getElementById('antresolHeightVal').textContent = e.target.value + ' мм';
  });

  const plinthCb = document.getElementById('plinthEnabled');
  const plinthFld = document.getElementById('plinthHeightField');
  plinthCb.addEventListener('change', () => {
    plinthFld.style.display = plinthCb.checked ? 'block' : 'none';
  });
  document.getElementById('plinthHeight').addEventListener('input', e => {
    document.getElementById('plinthHeightVal').textContent = e.target.value + ' мм';
  });
}

// ---------- переключение вкладок сайдбара ----------
export function bindTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      const hideBar = btn.dataset.tab === 'type' || btn.dataset.tab === 'presets';
      document.getElementById('typeBar').style.display = hideBar ? 'none' : 'block';
    });
  });
}
