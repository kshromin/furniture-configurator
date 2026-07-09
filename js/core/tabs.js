import { state } from './state.js';
import { TYPES } from '../types/registry.js';
import { renderProducerSelect, renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { rebalanceSections, MIN_SECTION_WIDTH } from '../types/_wardrobe-shared.js';

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
  setSlider('drawers',  state.drawers,  '');
  renderSectionsList();

  document.getElementById('plinthEnabled').checked = state.plinthEnabled;
  document.getElementById('plinthHeightField').style.display = state.plinthEnabled ? 'block' : 'none';
  setSlider('plinthHeight', state.plinthHeight);

  ['noSideLeft', 'noSideRight', 'noCeiling', 'noBottom', 'alignerLeft', 'alignerRight', 'alignerTop'].forEach(key => {
    const el = document.getElementById(key);
    if (el) el.checked = state[key];
  });
  document.getElementById('alignerLeftField').style.display  = state.alignerLeft  ? 'block' : 'none';
  document.getElementById('alignerRightField').style.display = state.alignerRight ? 'block' : 'none';
  document.getElementById('alignerTopField').style.display   = state.alignerTop   ? 'block' : 'none';
  setSlider('alignerLeftW', state.alignerLeftW);
  setSlider('alignerRightW', state.alignerRightW);
  setSlider('alignerTopH', state.alignerTopH);

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

// ---------- вкладка «Внутр.» — список секций ----------
export function renderSectionsList() {
  const container = document.getElementById('sectionsListItems');
  if (!container) return;
  container.innerHTML = '';

  state.sections.forEach((sec, i) => {
    const card = document.createElement('div');
    card.className = 'section-card';
    const removeBtn = state.sections.length > 1
      ? `<button class="section-remove-btn" data-idx="${i}" title="Удалить секцию">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
         </button>`
      : '';
    card.innerHTML = `
      <div class="section-card-header">
        <span class="section-card-title">Секция ${i + 1}</span>
        <div class="section-card-width">
          <input type="number" class="dim-input section-width-input" data-idx="${i}" value="${Math.round(sec.width)}" min="${MIN_SECTION_WIDTH}">
          <span class="section-card-unit">мм</span>
          ${removeBtn}
        </div>
      </div>
      <div class="section-card-grid">
        <div class="section-field">
          <label>Полки</label>
          <input type="number" class="dim-input section-shelves-input" data-idx="${i}" value="${sec.shelves}" min="0" max="8">
        </div>
        <div class="section-field">
          <label>Ящики</label>
          <input type="number" class="dim-input section-drawers-input" data-idx="${i}" value="${sec.drawers}" min="0" max="4">
        </div>
        <div class="section-field checkbox-field">
          <label><input type="checkbox" class="section-rod-input" data-idx="${i}" ${sec.rod ? 'checked' : ''}> Штанга</label>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.section-width-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const i = Number(e.target.dataset.idx);
      state.sections[i].width = Math.max(MIN_SECTION_WIDTH, Number(e.target.value));
      rebalanceSections(i);
      renderSectionsList();
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-shelves-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].shelves = Math.max(0, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-drawers-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].drawers = Math.max(0, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-rod-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].rod = e.target.checked;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sections.splice(Number(btn.dataset.idx), 1);
      rebalanceSections();
      renderSectionsList();
      buildFurniture();
    });
  });
}

export function bindSectionsControls() {
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    state.sections.push({ width: MIN_SECTION_WIDTH, shelves: 3, drawers: 0, rod: true });
    rebalanceSections();
    renderSectionsList();
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

  // noBottom обрабатывается через bindSide ниже; здесь только syncPlinth при его изменении
  noBottomCb.addEventListener('change', () => syncPlinth());

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

  bindSide('noSideLeft',  'leftReplaceBlock',   'leftReplaceGroup',   'noSideLeft',  'leftReplace',   'leftBoxWField',   'leftBoxW',   'leftBoxWVal',   'leftBoxW');
  bindSide('noSideRight', 'rightReplaceBlock',  'rightReplaceGroup',  'noSideRight', 'rightReplace',  'rightBoxWField',  'rightBoxW',  'rightBoxWVal',  'rightBoxW');
  bindSide('noCeiling',   'topReplaceBlock',    'topReplaceGroup',    'noCeiling',   'topReplace',    'topBoxHField',    'topBoxH',    'topBoxHVal',    'topBoxH');
  bindSide('noBottom',    'bottomReplaceBlock', 'bottomReplaceGroup', 'noBottom',    'bottomReplace', 'bottomBoxHField', 'bottomBoxH', 'bottomBoxHVal', 'bottomBoxH');

  // Выравнивающие элементы — планка у переднего края рядом со стойкой/крышей, стойка/крыша сдвигается на её размер
  function bindAligner(cbId, fieldId, sizeSliderId, sizeKey) {
    const cb = document.getElementById(cbId);
    const field = document.getElementById(fieldId);
    cb.addEventListener('change', e => {
      state[cbId] = e.target.checked;
      field.style.display = e.target.checked ? 'block' : 'none';
      buildFurniture();
    });
    bindSlider(sizeSliderId, sizeKey, ' мм');
  }
  bindAligner('alignerLeft',  'alignerLeftField',  'alignerLeftW',  'alignerLeftW');
  bindAligner('alignerRight', 'alignerRightField', 'alignerRightW', 'alignerRightW');
  bindAligner('alignerTop',   'alignerTopField',   'alignerTopH',   'alignerTopH');

  // Выравнивающий элемент имеет смысл только вместе со стойкой/крышей — если её сняли
  // («Без левой стойки» и т.п.), соответствующий выравнивающий элемент отключаем и блокируем.
  function syncAlignerAvailability(noCbId, alignerKey) {
    const noCb = document.getElementById(noCbId);
    const alignerCb = document.getElementById(alignerKey);
    const alignerFld = document.getElementById(alignerKey + 'Field');
    const disabled = noCb.checked;
    alignerCb.disabled = disabled;
    alignerCb.closest('label').style.opacity = disabled ? '0.4' : '';
    if (disabled && alignerCb.checked) {
      alignerCb.checked = false;
      state[alignerKey] = false;
      alignerFld.style.display = 'none';
    }
  }
  [['noSideLeft', 'alignerLeft'], ['noSideRight', 'alignerRight'], ['noCeiling', 'alignerTop']].forEach(([noKey, alignerKey]) => {
    document.getElementById(noKey).addEventListener('change', () => {
      syncAlignerAvailability(noKey, alignerKey);
      buildFurniture();
    });
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
