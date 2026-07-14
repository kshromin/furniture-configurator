import { state, newItemId, hasUnsavedChanges, markStateSafe } from './state.js';
import { TYPES } from '../types/registry.js';
import { renderProducerSelect, renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { showToast } from './toast.js';
import { renderStaticDimensions } from './dimensions.js';
import {
  rebalanceSections, MIN_SECTION_WIDTH, maxDrawerDepth, availableMeshDepths, availableValetLengths, clampSectionSizes,
  basketSizeOptions, basketFits, requiredBasketProyom, canAddSection, canRemoveSection, BASKET_WIDTHS,
  sectionVerticalBounds, findFreeSlot, defaultItemsForSection, isSectionWidthLocked, sectionMissingSideSupport,
  sectionBackWallSegments,
} from '../types/_wardrobe-shared.js';

// Общий список допустимых проёмов под корзины (не привязан к конкретной выбранной ширине) —
// добавляется в тосты о несовпадении, чтобы пользователь сразу видел все варианты, а не только
// требование текущей корзины.
const BASKET_PROYOMS_HINT = `Допустимые проёмы для корзин: ${BASKET_WIDTHS.map(requiredBasketProyom).join(', ')}мм.`;

// Свёрнутость карточки секции — чисто UI-состояние (не часть state, не сохраняется в заказ/
// конфигурацию), поэтому живёт локально в модуле, а не в state.sections[i]. WeakSet по ссылке
// на сам объект секции — переживает re-render (renderSectionsList вызывается часто), но не
// требует привязки к индексу, который может съехать при добавлении/удалении секций.
const collapsedSections = new WeakSet();

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

  document.querySelectorAll('#backWallGroup .opt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.back === state.backWall);
  });
  // На случай, если пресет/загруженная позиция заказа принесла несовместимую комбинацию
  // (задняя стенка + снятая стойка/крыша/дно) — блокирует кнопки и сбрасывает стенку так же,
  // как и ручное снятие галочки на вкладке «Внешнее».
  syncBackWallAvailability();

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
function applyTypeSwitch(newType) {
  state.type = newType;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === newType));
  updateAllContexts();
  buildFurniture();
  // Смена типа сама по себе меняет state (type), уводя его от снимка, снятого ДО переключения
  // (что бы к нему ни привело — обычный клик без предупреждения, «сохранить и продолжить» или
  // «продолжить без сохранения») — без этого следующая же проверка снова решила бы, что есть
  // несохранённые изменения, хотя пользователь ничего не трогал в новом типе.
  markStateSafe();
}

// Если текущий дизайн не добавлен в проект (или добавлен, но с тех пор что-то поменяли) —
// переключение типа изделия скрывает его наполнение под другой ctx, фактически теряя работу.
// Предупреждаем и даём выбор: добавить в проект перед переключением (клик по addItemBtn — не
// импортируем addCurrentToOrder напрямую, чтобы не завести цикл tabs.js↔order.js, там уже есть
// обратный импорт syncUIFromState), продолжить без сохранения, или отменить переключение.
function showTypeSwitchWarning(newType) {
  const overlay = document.getElementById('typeSwitchWarningOverlay');
  const saveBtn = document.getElementById('typeSwitchSaveBtn');
  const discardBtn = document.getElementById('typeSwitchDiscardBtn');
  const cancelBtn = document.getElementById('typeSwitchCancelBtn');

  function cleanup() {
    overlay.classList.remove('visible');
    saveBtn.removeEventListener('click', onSave);
    discardBtn.removeEventListener('click', onDiscard);
    cancelBtn.removeEventListener('click', onCancel);
  }
  function onSave() {
    document.getElementById('addItemBtn').click();
    cleanup();
    applyTypeSwitch(newType);
  }
  function onDiscard() { cleanup(); applyTypeSwitch(newType); }
  function onCancel() { cleanup(); }

  saveBtn.addEventListener('click', onSave);
  discardBtn.addEventListener('click', onDiscard);
  cancelBtn.addEventListener('click', onCancel);
  overlay.classList.add('visible');
}

export function bindTypeButtons() {
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newType = btn.dataset.type;
      if (newType === state.type) return;
      if (hasUnsavedChanges()) showTypeSwitchWarning(newType);
      else applyTypeSwitch(newType);
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
      // Смена задней стенки меняет доступную глубину под ящики/сетку/корзины/вешало
      // (backWallClearance) — build() уже подрезал/обнулил значения в state.sections, но
      // карточки секций на вкладке «Внутр.» сами не перерисовываются, пока их не попросить
      // явно (тот же паттерн, что и у bindSlider('depth')) — иначе поля показывают то, что
      // было выбрано ДО пересчёта, а не то, что реально построено.
      renderSectionsList();
    });
  });
}

// Задняя стенка (ЛДСП/ХДФ) физически крепится к контуру короба — полу, крыше и обеим стойкам.
// Если убрать любую из этих 4 деталей (галочки «Без дна/крыши/левой/правой стойки» на вкладке
// «Внешнее»), закрепить стенку больше не на что — кнопки ЛДСП/ХДФ блокируются (как цоколь при
// «Без дна»), а если стенка уже была выбрана — сбрасываем на «Без стенки».
export function syncBackWallAvailability() {
  const unavailable = state.noBottom || state.noCeiling || state.noSideLeft || state.noSideRight;
  document.querySelectorAll('#backWallGroup .opt-btn').forEach(btn => {
    if (btn.dataset.back === 'none') return;
    btn.disabled = unavailable;
  });
  if (unavailable && state.backWall !== 'none') {
    state.backWall = 'none';
    document.querySelectorAll('#backWallGroup .opt-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#backWallGroup .opt-btn[data-back="none"]').classList.add('active');
    // build() уже вызовет вызывающий код (тот же паттерн, что и у соседних sync*Availability) —
    // здесь только перерисовываем карточки секций, т.к. buildFurniture() их не трогает.
    renderSectionsList();
  }
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

// Посегментная задняя стенка — доступна только когда общая state.backWall выключена (см.
// sectionBackWallSegments в wardrobe-items.js). Один компактный ряд пронумерованных кнопок
// снизу вверх, по одной на КАЖДЫЙ сегмент секции — показываю все, а не только пригодные:
// недоступные (нет реальной ЛДСП-опоры по бокам или хотя бы с одной стороны по высоте) рисую
// зачёркнутыми и неактивными, чтобы было видно, что там в принципе стоит, а не просто пусто.
function renderBackWallSegmentsRow(sec, i) {
  const segments = sectionBackWallSegments(sec, i);
  if (!segments.length) return '';
  const on = sec.backWallSegments || [];
  const buttons = segments.map((seg, si) => {
    const title = seg.eligible
      ? `${Math.round(seg.hiY - seg.loY)}мм`
      : `Нельзя — в контуре не хватает ЛДСП-элемента (стойки/перегородки/пола/крыши), стенку не на что закрепить`;
    return `<button class="section-backwall-seg-btn ${on.includes(seg.key) ? 'active' : ''} ${seg.eligible ? '' : 'ineligible'}" data-idx="${i}" data-key="${seg.key}" ${seg.eligible ? '' : 'disabled'} title="${title}">${si + 1}</button>`;
  }).join('');
  return `
    <div class="el-row" title="Задняя стенка ЛДСП по сегментам — снизу вверх: пол/полка → полка → потолок. Доступно только при выключенной общей задней стенке.">
      <span class="el-row-label">Стенка ЛДСП</span>
      ${buttons}
    </div>
  `;
}

// ---------- вкладка «Внутр.» — список секций ----------
export function renderSectionsList() {
  const container = document.getElementById('sectionsListItems');
  if (!container) return;
  container.innerHTML = '';
  // Подрезаем сохранённые значения ДО рендера — иначе <select> может молча показать первый
  // вариант списка (устаревшее значение не совпадает ни с одной опцией), пока не случится
  // следующая пересборка (build()), которая сама эти значения тоже подрежет.
  clampSectionSizes(state.sections, state.depth);
  const maxDD = maxDrawerDepth(state.depth);
  const meshDepths = availableMeshDepths(state.depth);
  const valetLengths = availableValetLengths(state.depth);
  const basketSizes = basketSizeOptions(state.depth);
  // Наполнение секции — свободно перетаскиваемые мышкой items (см. state.js), не счётчики.
  const byType = (sec, type) => sec.items.filter(it => it.type === type);

  state.sections.forEach((sec, i) => {
    const card = document.createElement('div');
    card.className = 'section-card';
    // Удалить нельзя, если освободившуюся ширину некому занять — все остальные секции
    // зафиксированы (корзиной или галочкой), см. canRemoveSection в _wardrobe-shared.js.
    const removable = state.sections.length > 1 && canRemoveSection(i);
    const removeBtn = state.sections.length > 1
      ? `<button class="section-remove-btn" data-idx="${i}" ${removable ? '' : 'disabled'}
           title="${removable ? 'Удалить секцию' : 'Нельзя удалить — все остальные секции зафиксированы, освободившееся место некому занять'}">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
         </button>`
      : '';
    const collapsed = collapsedSections.has(sec);
    card.innerHTML = `
      <div class="section-card-header">
        <button class="section-collapse-btn ${collapsed ? 'collapsed' : ''}" data-idx="${i}" title="${collapsed ? 'Развернуть секцию' : 'Свернуть секцию'}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <span class="section-card-title">Секция ${i + 1}</span>
        <div class="section-card-width">
          <input type="number" class="dim-input section-width-input" data-idx="${i}" value="${Math.round(sec.width)}" min="${MIN_SECTION_WIDTH}">
          <span class="section-card-unit">мм</span>
          <button class="section-lock-btn ${sec.widthLocked ? 'active' : ''}" data-idx="${i}" title="Зафиксировать ширину секции — не изменится при добавлении/удалении других секций">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </button>
          <button class="section-lock-btn section-dim-toggle ${sec.showDimensions === false ? '' : 'active'}" data-idx="${i}" title="Показывать размеры этой секции">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v3M15 8v3"/></svg>
          </button>
          ${removeBtn}
        </div>
      </div>
      <div class="section-rows" style="${collapsed ? 'display:none' : ''}">
        <div class="el-row" title="Полки ЛДСП — таскаются мышкой в 3D-виде">
          <span class="el-row-label">Полки</span>
          <span class="el-row-count">${byType(sec, 'shelf').length}</span>
          ${byType(sec, 'shelf').filter(it => !it.pinned).map(it => `<button class="item-chip-remove" data-item-id="${it.id}" data-idx="${i}" title="Удалить полку">×</button>`).join('')}
          <button class="section-add-btn" data-idx="${i}" data-type="shelf" title="Добавить полку">+</button>
        </div>
        <div class="el-row" title="Штанга для одежды — таскается мышкой в 3D-виде">
          <span class="el-row-label">Штанга</span>
          <span class="el-row-count">${byType(sec, 'rod').length}</span>
          ${byType(sec, 'rod').map(it => `<button class="item-chip-remove" data-item-id="${it.id}" data-idx="${i}" title="Удалить штангу">×</button>`).join('')}
          <button class="section-add-btn" data-idx="${i}" data-type="rod" title="Добавить штангу">+</button>
        </div>
        <div class="el-row" title="Сетчатая полка — таскается мышкой в 3D-виде">
          <span class="el-row-label">Сетка</span>
          <span class="el-row-count">${byType(sec, 'mesh').length}</span>
          ${byType(sec, 'mesh').map(it => `<button class="item-chip-remove" data-item-id="${it.id}" data-idx="${i}" title="Удалить сетчатую полку">×</button>`).join('')}
          <button class="section-add-btn" data-idx="${i}" data-type="mesh" title="Добавить сетчатую полку">+</button>
          <select class="mini-select section-mesh-depth-input" data-idx="${i}" title="Глубина">
            ${meshDepths.map(d => `<option value="${d}" ${sec.meshDepth === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <select class="mini-select section-mesh-color-input" data-idx="${i}" title="Цвет">
            <option value="silver" ${sec.meshColor === 'silver' ? 'selected' : ''}>Хром</option>
            <option value="white" ${sec.meshColor === 'white' ? 'selected' : ''}>Белая</option>
          </select>
        </div>
        <div class="el-row" title="Ящик — таскается мышкой в 3D-виде. Нужна боковая стойка секции.">
          <span class="el-row-label">Ящики</span>
          <span class="el-row-count">${byType(sec, 'drawer').length}</span>
          ${byType(sec, 'drawer').map(it => `<button class="item-chip-remove" data-item-id="${it.id}" data-idx="${i}" title="Удалить ящик">×</button>`).join('')}
          <button class="section-add-btn" data-idx="${i}" data-type="drawer" title="Добавить ящик">+</button>
          <input type="number" class="mini-input mini-input-wide section-drawer-height-input" data-idx="${i}" value="${sec.drawerHeight}" min="50" max="500" step="10" title="Высота фасада, мм">
          <input type="number" class="mini-input mini-input-wide section-drawer-depth-input" data-idx="${i}" value="${sec.drawerDepth}" min="250" max="${maxDD}" step="50" title="Глубина короба, мм (250-${maxDD})">
          <label class="el-row-check" title="Без доводчика"><input type="checkbox" class="section-drawer-no-softclose-input" data-idx="${i}" ${sec.drawerSoftClose ? '' : 'checked'}> SC</label>
        </div>
        <div class="el-row" title="Торцевое вешало — крепится к полке, мышкой прыгает между полками (не двигается свободно)">
          <span class="el-row-label">Вешало</span>
          <label class="el-row-check" title="Есть/нет"><input type="checkbox" class="section-valet-input" data-idx="${i}" ${sec.valet ? 'checked' : ''}></label>
          <select class="mini-select section-valet-length-input" data-idx="${i}" title="Размер, мм">
            ${valetLengths.map(v => `<option value="${v}" ${sec.valetLength === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="el-row" title="Сетчатая корзина — готовый типоразмер; ширина секции должна точно совпадать с обязательным проёмом (300→323мм, 400→423мм, 500→523мм), иначе не встанет. Таскается мышкой в 3D-виде.">
          <span class="el-row-label">Корзины</span>
          <span class="el-row-count">${byType(sec, 'basket').length}</span>
          ${byType(sec, 'basket').map(it => `<button class="item-chip-remove" data-item-id="${it.id}" data-idx="${i}" title="Удалить корзину">×</button>`).join('')}
          <button class="section-add-btn" data-idx="${i}" data-type="basket" title="Добавить корзину">+</button>
          <select class="mini-select mini-select-wide section-basket-size-input" data-idx="${i}" title="Ширина×глубина, высота корзины">
            ${basketSizes.map(o => `<option value="${o.w}x${o.d}x${o.h}" ${sec.basketWidth === o.w && sec.basketDepth === o.d && sec.basketHeight === o.h ? 'selected' : ''}>${o.w}×${o.d} h${o.h}</option>`).join('')}
          </select>
          <select class="mini-select section-basket-color-input" data-idx="${i}" title="Цвет">
            <option value="silver" ${sec.basketColor === 'silver' ? 'selected' : ''}>Хром</option>
            <option value="white"  ${sec.basketColor === 'white'  ? 'selected' : ''}>Белый</option>
            <option value="black"  ${sec.basketColor === 'black'  ? 'selected' : ''}>Чёрный</option>
          </select>
        </div>
        ${state.backWall === 'none' ? renderBackWallSegmentsRow(sec, i) : ''}
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.section-width-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const i = Number(e.target.dataset.idx);
      const sec = state.sections[i];
      // Если у ВСЕХ остальных секций ширина зафиксирована (замочком или корзиной), менять эту
      // секцию нечем — rebalanceSections(i) не найдёт свободных соседей, чтобы забрать/отдать
      // разницу, а build() при следующей сборке молча вернёт ширину назад (сумма должна совпадать
      // с реальной шириной короба). Раньше это тихо откатывалось только в 3D, а поле ввода
      // продолжало показывать введённое число — визуально казалось, что значение принялось.
      const others = state.sections.filter((s, idx) => idx !== i);
      if (others.length && others.every(isSectionWidthLocked)) {
        showToast('Нельзя изменить ширину — все остальные секции зафиксированы замочком.');
        e.target.value = Math.round(sec.width);
        return;
      }
      sec.width = Math.max(MIN_SECTION_WIDTH, Number(e.target.value));
      rebalanceSections(i);
      renderSectionsList();
      buildFurniture();
    });
  });
  // "+" — добавляет один экземпляр типа в первое свободное место секции по высоте
  // (findFreeSlot), либо тост «нет места». Крестик на чипе — удаляет конкретный экземпляр по id.
  // Позиционирование/перестановка — мышкой в 3D-виде (js/core/itemDrag.js), не здесь.
  container.querySelectorAll('.section-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      const type = btn.dataset.type;
      const sec = state.sections[i];
      if (type === 'basket' && !basketFits(sec)) {
        showToast(`Корзина ${sec.basketWidth}мм требует проём секции ровно ${requiredBasketProyom(sec.basketWidth)}мм (сейчас ${Math.round(sec.width)}мм). Измените ширину секции. ${BASKET_PROYOMS_HINT}`);
        return;
      }
      if ((type === 'drawer' || type === 'basket') && sectionMissingSideSupport(state.sections, i)) {
        showToast('Нужна боковая стойка секции — направляющие крепить некуда.');
        return;
      }
      const { fillBottom, fillTop } = sectionVerticalBounds();
      const y = findFreeSlot(sec, type, fillBottom, fillTop);
      if (y === null) {
        showToast('Нет места для нового элемента в этой секции.');
        return;
      }
      sec.items.push({ id: newItemId(), type, y });
      renderSectionsList();
      buildFurniture();
    });
  });
  container.querySelectorAll('.item-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = state.sections[Number(btn.dataset.idx)];
      const target = sec.items.find(it => it.id === btn.dataset.itemId);
      if (target && target.pinned) return; // структурная полка — неудаляемая, см. state.js
      sec.items = sec.items.filter(it => it.id !== btn.dataset.itemId);
      renderSectionsList();
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
  container.querySelectorAll('.section-basket-size-input').forEach(sel => {
    sel.addEventListener('change', e => {
      const sec = state.sections[Number(e.target.dataset.idx)];
      const [w, d, h] = e.target.value.split('x').map(Number);
      sec.basketWidth = w; sec.basketDepth = d; sec.basketHeight = h;
      // Смена ширины/высоты корзины может: (а) разойтись с проёмом секции (basketFits), (б)
      // изменить полосу коллизии (basketHeight) — уже стоящие корзины могут перестать влезать
      // друг с другом, поэтому при несовпадении проёма убираем их все явно, с тостом.
      const hasBaskets = sec.items.some(it => it.type === 'basket');
      if (hasBaskets && !basketFits(sec)) {
        showToast(`Корзина ${w}мм требует проём секции ровно ${requiredBasketProyom(w)}мм (сейчас ${Math.round(sec.width)}мм). Корзины в этой секции отключены. ${BASKET_PROYOMS_HINT}`);
        sec.items = sec.items.filter(it => it.type !== 'basket');
        renderSectionsList();
      }
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-basket-color-input').forEach(sel => {
    sel.addEventListener('change', e => {
      state.sections[Number(e.target.dataset.idx)].basketColor = e.target.value;
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-backwall-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = state.sections[Number(btn.dataset.idx)];
      const key = btn.dataset.key;
      if (!sec.backWallSegments) sec.backWallSegments = [];
      const idx = sec.backWallSegments.indexOf(key);
      if (idx === -1) sec.backWallSegments.push(key); else sec.backWallSegments.splice(idx, 1);
      btn.classList.toggle('active');
      buildFurniture();
    });
  });
  container.querySelectorAll('.section-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = state.sections[Number(btn.dataset.idx)];
      const card = btn.closest('.section-card');
      const rows = card.querySelector('.section-rows');
      const nowCollapsed = !collapsedSections.has(sec);
      if (nowCollapsed) collapsedSections.add(sec); else collapsedSections.delete(sec);
      rows.style.display = nowCollapsed ? 'none' : '';
      btn.classList.toggle('collapsed', nowCollapsed);
      btn.title = nowCollapsed ? 'Развернуть секцию' : 'Свернуть секцию';
    });
  });
  container.querySelectorAll('.section-lock-btn:not(.section-dim-toggle)').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = state.sections[Number(btn.dataset.idx)];
      sec.widthLocked = !sec.widthLocked;
      btn.classList.toggle('active', sec.widthLocked);
    });
  });
  container.querySelectorAll('.section-dim-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = state.sections[Number(btn.dataset.idx)];
      sec.showDimensions = sec.showDimensions === false ? true : false;
      btn.classList.toggle('active', sec.showDimensions !== false);
      renderStaticDimensions();
    });
  });
  container.querySelectorAll('.section-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (!canRemoveSection(idx)) {
        showToast('Нельзя удалить секцию — все остальные секции зафиксированы (корзиной или галочкой), освободившееся место некому занять.');
        return;
      }
      state.sections.splice(idx, 1);
      rebalanceSections();
      renderSectionsList();
      buildFurniture();
    });
  });
}

export function bindSectionsControls() {
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    // Зафиксированные секции (корзина или ручная галочка) не сжимаются при добавлении новой —
    // см. rebalanceSections/canAddSection в _wardrobe-shared.js. Если свободных секций не
    // хватает на ещё одну минимальную ширину, добавить некуда.
    if (!canAddSection()) {
      showToast('Не удаётся добавить секцию — все секции зафиксированы (корзиной или галочкой) и заняли всю ширину. Снимите фиксацию у одной из секций или уменьшите её ширину.');
      return;
    }
    state.sections.push({
      width: MIN_SECTION_WIDTH,
      items: defaultItemsForSection({ shelves: 1, drawers: 0, rod: 1, drawerHeight: 150 }),
      drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true,
      meshDepth: 400, meshColor: 'silver', valet: 0, valetAnchorId: null, valetLength: 400,
      basketWidth: 300, basketDepth: 400, basketHeight: 120, basketColor: 'silver',
      widthLocked: false,
      backWallSegments: [],
    });
    rebalanceSections();
    renderSectionsList();
    buildFurniture();
  });

  // Размерные линии наполнения — HTML-оверлей поверх 3D-вида (js/core/dimensions.js), а не
  // часть геометрии, поэтому переключение не требует полной пересборки (buildFurniture) —
  // достаточно перерисовать сам оверлей.
  document.getElementById('showDimensionsToggle').addEventListener('change', e => {
    state.showDimensions = e.target.checked;
    renderStaticDimensions();
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
      renderSectionsList(); // пересчитать пригодность сегментов задней стенки (см. sectionBackWallSegments)
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

  // Задняя стенка держится на всех 4 деталях контура (пол/крыша/обе стойки) — при снятии любой
  // из них она физически отваливается, см. syncBackWallAvailability.
  ['noSideLeft', 'noSideRight', 'noCeiling', 'noBottom'].forEach(noKey => {
    document.getElementById(noKey).addEventListener('change', () => {
      syncBackWallAvailability();
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
      const hideBar = ['type', 'presets', 'cabinet', 'admin', 'extras'].includes(btn.dataset.tab);
      document.getElementById('typeBar').style.display = hideBar ? 'none' : 'block';
    });
  });
}
