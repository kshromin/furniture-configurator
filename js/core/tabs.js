import { state } from './state.js';
import { TYPES } from '../types/registry.js';
import { renderProducerSelect, renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { rebalanceSections, MIN_SECTION_WIDTH, maxDrawerDepth, availableMeshDepths, availableValetLengths } from '../types/_wardrobe-shared.js';

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
    // build() клампит state.sections[i].drawerDepth под новую глубину короба — перерисовываем
    // карточки секций, чтобы поле ввода показывало актуальное (уже урезанное) значение и max.
    if (key === 'depth') renderSectionsList();
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
  const maxDD = maxDrawerDepth(state.depth);
  const meshDepths = availableMeshDepths(state.depth);
  const valetLengths = availableValetLengths(state.depth);

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
          <label>Полки сверху</label>
          <input type="number" class="dim-input section-shelves-top-input" data-idx="${i}" value="${sec.shelvesTop}" min="0" max="8">
        </div>
        <div class="section-field">
          <label>Полки снизу</label>
          <input type="number" class="dim-input section-shelves-bottom-input" data-idx="${i}" value="${sec.shelvesBottom}" min="0" max="8">
        </div>
        <div class="section-field">
          <label>Ящики</label>
          <input type="number" class="dim-input section-drawers-input" data-idx="${i}" value="${sec.drawers}" min="0" max="4">
        </div>
        <div class="section-field">
          <label>Высота фасада ящика</label>
          <input type="number" class="dim-input section-drawer-height-input" data-idx="${i}" value="${sec.drawerHeight}" min="50" max="500" step="10">
        </div>
        <div class="section-field">
          <label>Глубина ящика (250-${maxDD})</label>
          <input type="number" class="dim-input section-drawer-depth-input" data-idx="${i}" value="${sec.drawerDepth}" min="250" max="${maxDD}" step="50">
        </div>
        <div class="section-field checkbox-field">
          <label><input type="checkbox" class="section-drawer-no-softclose-input" data-idx="${i}" ${sec.drawerSoftClose ? '' : 'checked'}> Без доводчика</label>
        </div>
        <div class="section-field">
          <label>Штанга (0-2)</label>
          <input type="number" class="dim-input section-rod-input" data-idx="${i}" value="${sec.rod}" min="0" max="2">
        </div>
        <div class="section-field checkbox-field">
          <label><input type="checkbox" class="section-bottom-shelf-input" data-idx="${i}" ${sec.bottomShelf ? 'checked' : ''}> Нижняя полка</label>
        </div>
        <div class="section-field">
          <label>Сетчатые полки (0-3)</label>
          <input type="number" class="dim-input section-mesh-count-input" data-idx="${i}" value="${sec.meshShelves}" min="0" max="3">
        </div>
        <div class="section-field">
          <label>Глубина сетки</label>
          <select class="dim-input section-mesh-depth-input" data-idx="${i}">
            ${meshDepths.map(d => `<option value="${d}" ${sec.meshDepth === d ? 'selected' : ''}>${d} мм</option>`).join('')}
          </select>
        </div>
        <div class="section-field">
          <label>Цвет сетки</label>
          <select class="dim-input section-mesh-color-input" data-idx="${i}">
            <option value="silver" ${sec.meshColor === 'silver' ? 'selected' : ''}>Серебро</option>
            <option value="white" ${sec.meshColor === 'white' ? 'selected' : ''}>Белая</option>
          </select>
        </div>
        <div class="section-field checkbox-field">
          <label><input type="checkbox" class="section-valet-input" data-idx="${i}" ${sec.valet ? 'checked' : ''}> Торцевое вешало</label>
        </div>
        <div class="section-field">
          <label>Размер вешала</label>
          <select class="dim-input section-valet-length-input" data-idx="${i}">
            ${valetLengths.map(v => `<option value="${v}" ${sec.valetLength === v ? 'selected' : ''}>${v} мм</option>`).join('')}
          </select>
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
  container.querySelectorAll('.section-shelves-top-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].shelvesTop = Math.max(0, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-shelves-bottom-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].shelvesBottom = Math.max(0, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-drawers-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].drawers = Math.max(0, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-drawer-height-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].drawerHeight = Math.max(50, Number(e.target.value));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-drawer-depth-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const localMax = maxDrawerDepth(state.depth);
      const raw = Math.max(250, Math.min(localMax, Number(e.target.value)));
      const snapped = Math.round(raw / 50) * 50;
      e.target.value = snapped;
      state.sections[Number(e.target.dataset.idx)].drawerDepth = snapped;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-drawer-no-softclose-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].drawerSoftClose = !e.target.checked;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-rod-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].rod = Math.max(0, Math.min(2, Number(e.target.value)));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-bottom-shelf-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].bottomShelf = e.target.checked ? 1 : 0;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-mesh-count-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].meshShelves = Math.max(0, Math.min(3, Number(e.target.value)));
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-mesh-depth-input').forEach(sel => {
    sel.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].meshDepth = Number(e.target.value);
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-mesh-color-input').forEach(sel => {
    sel.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].meshColor = e.target.value;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-valet-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].valet = e.target.checked ? 1 : 0;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-valet-length-input').forEach(sel => {
    sel.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].valetLength = Number(e.target.value);
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
    state.sections.push({
      width: MIN_SECTION_WIDTH, shelvesTop: 0, shelvesBottom: 0, bottomShelf: 1,
      drawers: 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true, rod: 1,
      meshShelves: 0, meshDepth: 400, meshColor: 'silver', valet: 0, valetLength: 400,
    });
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
