import { state, materials, setMaterials, markStateSafe, captureDefaultState } from './core/state.js';
import { renderProducerSelect } from './core/materials.js';
import { renderPresets } from './core/presets.js';
import { buildFurniture } from './core/build.js';
import {
  bindTypeButtons, bindSlider, bindFasadTab, bindVariantControls,
  bindTabSwitching, bindToggleDoors, bindBackWall, bindThickness, bindSectionsControls, syncUIFromState,
  markUnfinishedTypes, bindRoomControls, setCompanyActiveTypes,
} from './core/tabs.js';
import { addCurrentToOrder, renderOrderCards, bindOrderForm, hasUnsavedWork, requestLogout, refreshProcessIndicator } from './core/order.js';
import { bindPrint } from './core/print.js';
import { renderExtras, bindExtras } from './core/extras.js';
import { bindProjectsControls, openProjectsModal } from './core/projects.js';
import { initAuth, bindLoginForm, auth } from './core/auth.js';
import { supabase } from './core/supabaseClient.js';
import { bindCabinetControls, openCabinetModal } from './core/cabinet.js';
import { bindUsersControls, openUsersModal } from './core/users.js';
import { renderAdminOrders } from './core/admin.js';
import { initItemDrag } from './core/itemDrag.js';
import { initDimensions } from './core/dimensions.js';
import { initHistory, undo, onHistoryChange } from './core/history.js';
import { initAutofillGuard } from './core/autofillGuard.js';
import { bindDoorEditor } from './core/doorEditor.js';

// Каталог материалов: у залогиненного пользователя — из его компании (companies.materials в
// Supabase), иначе (devMode / не залогинен / пустой или битый ответ / ошибка) — локальный
// data/materials.json. Локальный каталог — всегда рабочий фолбэк, чтобы товары и цены не могли
// «исчезнуть», даже если Supabase недоступен или у компании каталог ещё не залит.
async function loadMaterials() {
  const local = async () => (await fetch('data/materials.json', { cache: 'no-store' })).json();
  const valid = m => !!(m && m.korpus?.producers?.length && m.fasad?.producers?.length);
  setCompanyActiveTypes(null); // по умолчанию типы не гейтим (devMode / супер-админ / нет компании)

  if (localStorage.getItem('devMode') === 'true') return local();
  const companyId = auth.session && auth.profile?.company_id;
  if (!companyId) return local();

  try {
    const { data, error } = await supabase
      .from('companies').select('materials, active_types').eq('id', companyId).single();
    if (error) { console.warn('Каталог из Supabase не загрузился, фолбэк на локальный:', error.message); return local(); }
    // Гейт типов — только для НЕ супер-админа (супер-админ видит все готовые типы).
    if (!auth.profile?.is_admin) setCompanyActiveTypes(data?.active_types);
    return valid(data?.materials) ? data.materials : local();
  } catch (e) {
    console.warn('Ошибка загрузки каталога, фолбэк на локальный:', e);
    return local();
  }
}

async function init() {
  bindLoginForm();
  await initAuth();

  // Каталог — из компании пользователя (Supabase) с фолбэком на локальный (см. loadMaterials()).
  setMaterials(await loadMaterials());

  // default state from first producer/color
  ['korpus', 'fasad', 'fill'].forEach(g => {
    const firstProducer = materials[g]?.producers?.[0];
    state[g + 'Producer'] = firstProducer?.id || null;
    state[g + 'Id']       = firstProducer?.colors?.[0]?.id || null;
  });

  // producer selects + swatches
  renderProducerSelect('korpus', 'korpusProducer', 'korpusSwatches');
  renderProducerSelect('fasad',  'fasadProducer',  'fasadSwatches');
  renderProducerSelect('fill',   'fillProducer',   'fillSwatches');

  renderPresets();

  bindTabSwitching();
  bindTypeButtons();
  markUnfinishedTypes();

  bindSlider('width',    'width',    ' мм');
  bindSlider('height',   'height',   ' мм');
  bindSlider('depth',    'depth',    ' мм');
  bindSlider('drawers',  'drawers',  '');

  bindSlider('roomWidth',  'roomWidth',  ' мм');
  bindSlider('roomDepth',  'roomDepth',  ' мм');
  bindSlider('roomHeight', 'roomHeight', ' мм');
  bindRoomControls();

  bindFasadTab();

  document.getElementById('addItemBtn').addEventListener('click', () => {
    addCurrentToOrder();
    renderOrderCards();
  });

  bindVariantControls();
  bindBackWall();
  bindThickness();
  bindToggleDoors();
  bindSectionsControls();
  bindOrderForm();
  // Предупреждение перед закрытием/F5, если есть несохранённые прорисовки (нативный диалог
  // браузера — текст задаёт сам браузер; «типа может сохранишь прорисовки в проект»).
  window.addEventListener('beforeunload', e => {
    if (hasUnsavedWork()) { e.preventDefault(); e.returnValue = ''; }
  });
  bindPrint();
  renderExtras();
  bindExtras();

  bindCabinetControls();
  bindProjectsControls();
  document.querySelector('[data-tab="cabinet"]').addEventListener('click', openCabinetModal);
  bindUsersControls();
  document.querySelector('[data-tab="users"]').addEventListener('click', openUsersModal);
  document.getElementById('sidebarLogoutBtn').addEventListener('click', requestLogout);
  document.querySelector('[data-tab="projects"]').addEventListener('click', openProjectsModal);
  document.getElementById('adminTabBtn').addEventListener('click', renderAdminOrders);

  initItemDrag();
  initDimensions();
  initHistory();
  const undoBtn = document.getElementById('undoBtn');
  undoBtn.addEventListener('click', undo);
  onHistoryChange(count => { undoBtn.disabled = count < 2; });
  // Индикатор процесса реагирует на любое изменение модели сразу (цвет/размер/наполнение) —
  // напрямую по событию пересбора, не дожидаясь дебаунса истории (задание 30,07).
  window.addEventListener('furniture-rebuilt', refreshProcessIndicator);

  initAutofillGuard();
  bindDoorEditor();

  syncUIFromState();
  buildFurniture();
  markStateSafe();
  captureDefaultState(); // запомнить типовую модель — к ней вернёт «Новая прорисовка»
}

init();
