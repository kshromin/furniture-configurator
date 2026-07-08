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
  const range = document.getElementById(id);
  const numInput = document.getElementById(id + 'Val');
  if (range) range.value = value;
  if (numInput) numInput.value = value;
}

export function bindSlider(id, key, suffix) {
  const range = document.getElementById(id);
  const numInput = document.getElementById(id + 'Val');
  if (!range) return;

  function apply(val) {
    const min = Number(range.min), max = Number(range.max);
    val = Math.max(min, Math.min(max, Math.round(val / 10) * 10));
    state[key] = val;
    range.value = val;
    if (numInput) numInput.value = val;
    if (key === 'width' || key === 'height') updateTypeBar();
    buildFurniture();
  }

  range.addEventListener('input', () => apply(Number(range.value)));
  if (numInput) {
    numInput.addEventListener('change', () => apply(Number(numInput.value)));
  }
}

export function syncUIFromState() {
  setSlider('width',    state.width,    ' мм');
  setSlider('height',   state.height,   ' мм');
  setSlider('depth',    state.depth,    ' мм');
  setSlider('sections', state.sections, '');
  setSlider('shelves',  state.shelves,  '');
  setSlider('drawers',  state.drawers,  '');
  document.getElementById('rod').checked = state.rod;

  document.getElementById('plinthEnabled').checked = state.plinthEnabled;
  document.getElementById('plinthHeightField').style.display = state.plinthEnabled ? 'block' : 'none';
  setSlider('plinthHeight', state.plinthHeight);

  ['noSideLeft', 'noSideRight', 'noCeiling', 'noBottom', 'alignerLeft', 'alignerRight', 'alignerTop'].forEach(key => {
    const el = document.getElementById(key);
    if (el) el.checked = state[key];
  });

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

// ---------- кнопки «Задняя стенка» ----------
export function bindBackWall() {
  document.querySelectorAll('#backWallGroup .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#backWallGroup .opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.backWall = btn.dataset.back;
      buildFurniture();
    });
  });
}

// ---------- кнопка «Не показывать двери» ----------
export function bindToggleDoors() {
  const btn = document.getElementById('toggleDoorsBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.showDoors = !state.showDoors;
    btn.classList.toggle('active', !state.showDoors);
    document.getElementById('toggleDoorsBtnLabel').textContent =
      state.showDoors ? 'Не показывать двери' : 'Показать двери';
    buildFurniture();
  });
}

// ---------- вкладка «Внешнее» — доп. опции ----------

function bindReplaceBlock(cbId, blockId, groupId, stateKey, boxFieldId, boxSliderId, boxValId, boxStateKey) {
  const cb = document.getElementById(cbId);
  const block = document.getElementById(blockId);

  function syncBlock() {
    block.style.display = cb.checked ? 'block' : 'none';
  }

  cb.addEventListener('change', e => {
    state[stateKey] = e.target.checked;
    syncBlock();
    buildFurniture();
  });

  document.querySelectorAll(`#${groupId} .opt-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${groupId} .opt-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[stateKey.replace('no', '').replace('SideLeft', 'left').replace('SideRight', 'right').replace('Ceiling', 'top') + 'Replace'] = btn.dataset.replace;
      // map to correct state key
      const replaceKey = groupId.replace('ReplaceGroup', 'Replace').replace('left', 'left').replace('right', 'right').replace('top', 'top');
      state[replaceKey] = btn.dataset.replace;
      document.getElementById(boxFieldId).style.display = btn.dataset.replace === 'box' ? 'block' : 'none';
      buildFurniture();
    });
  });

  bindSlider(boxSliderId, boxStateKey, ' мм');
}

export function bindVariantControls() {
  const plinthCb  = document.getElementById('plinthEnabled');
  const plinthFld = document.getElementById('plinthHeightField');
  const noBottomCb = document.getElementById('noBottom');

  function syncPlinth() {
    const disabled = noBottomCb.checked;
    plinthCb.disabled = disabled;
    plinthCb.closest('label').style.opacity = disabled ? '0.4' : '';
    if (disabled && plinthCb.checked) {
      plinthCb.checked = false;
      state.plinthEnabled = false;
      plinthFld.style.display = 'none';
    }
  }

  plinthCb.addEventListener('change', () => {
    state.plinthEnabled = plinthCb.checked;
    plinthFld.style.display = plinthCb.checked ? 'block' : 'none';
    buildFurniture();
  });

  noBottomCb.addEventListener('change', e => {
    state.noBottom = e.target.checked;
    syncPlinth();
    buildFurniture();
  });

  // Крыша и стойки с sub-блоками выбора замены
  function bindSide(cbId, blockId, groupId, noKey, replaceKey, boxFieldId, boxSlider, boxValId, boxKey) {
    const cb    = document.getElementById(cbId);
    const block = document.getElementById(blockId);

    cb.addEventListener('change', e => {
      state[noKey] = e.target.checked;
      block.style.display = e.target.checked ? 'block' : 'none';
      buildFurniture();
    });

    document.querySelectorAll(`#${groupId} .opt-btn`).forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll(`#${groupId} .opt-btn`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state[replaceKey] = btn.dataset.replace;
        document.getElementById(boxFieldId).style.display = btn.dataset.replace === 'box' ? 'block' : 'none';
        buildFurniture();
      });
    });

    bindSlider(boxSlider, boxKey, ' мм');
  }

  bindSide('noSideLeft',  'leftReplaceBlock',  'leftReplaceGroup',  'noSideLeft',  'leftReplace',  'leftBoxWField',  'leftBoxW',  'leftBoxWVal',  'leftBoxW');
  bindSide('noSideRight', 'rightReplaceBlock', 'rightReplaceGroup', 'noSideRight', 'rightReplace', 'rightBoxWField', 'rightBoxW', 'rightBoxWVal', 'rightBoxW');
  bindSide('noCeiling',   'topReplaceBlock',   'topReplaceGroup',   'noCeiling',   'topReplace',   'topBoxHField',   'topBoxH',   'topBoxHVal',   'topBoxH');

  // Простые чекбоксы без sub-блока
  ['alignerLeft', 'alignerRight', 'alignerTop'].forEach(key => {
    const el = document.getElementById(key);
    if (el) el.addEventListener('change', e => { state[key] = e.target.checked; buildFurniture(); });
  });

  bindSlider('plinthHeight', 'plinthHeight', ' мм');
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
