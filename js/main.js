import { state, materials, setMaterials, markStateSafe } from './core/state.js';
import { renderProducerSelect } from './core/materials.js';
import { renderPresets } from './core/presets.js';
import { buildFurniture } from './core/build.js';
import {
  bindTypeButtons, bindSlider, bindFasadTab, bindVariantControls,
  bindTabSwitching, bindToggleDoors, bindBackWall, bindSectionsControls, syncUIFromState,
} from './core/tabs.js';
import { addCurrentToOrder, renderOrderCards, bindOrderForm } from './core/order.js';
import { renderExtras, bindExtras } from './core/extras.js';
import { renderProjects, bindProjectsControls } from './core/projects.js';
import { initAuth, bindLoginForm } from './core/auth.js';
import { renderCabinet, bindCabinetControls } from './core/cabinet.js';
import { renderAdminOrders } from './core/admin.js';
import { initItemDrag } from './core/itemDrag.js';
import { initDimensions } from './core/dimensions.js';

async function init() {
  bindLoginForm();
  await initAuth();

  // no-store: браузер охотно кэширует json, из-за чего после обновления каталога
  // (цены, extras) пользователи видели старые данные или пустые списки.
  const res = await fetch('data/materials.json', { cache: 'no-store' });
  setMaterials(await res.json());

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

  bindSlider('width',    'width',    ' мм');
  bindSlider('height',   'height',   ' мм');
  bindSlider('depth',    'depth',    ' мм');
  bindSlider('drawers',  'drawers',  '');

  bindFasadTab();

  document.getElementById('addItemBtn').addEventListener('click', () => {
    addCurrentToOrder();
    renderOrderCards();
  });

  bindVariantControls();
  bindBackWall();
  bindToggleDoors();
  bindSectionsControls();
  bindOrderForm();
  renderExtras();
  bindExtras();

  bindCabinetControls();
  bindProjectsControls();
  document.querySelector('[data-tab="cabinet"]').addEventListener('click', renderCabinet);
  document.querySelector('[data-tab="projects"]').addEventListener('click', renderProjects);
  document.getElementById('adminTabBtn').addEventListener('click', renderAdminOrders);

  initItemDrag();
  initDimensions();

  syncUIFromState();
  buildFurniture();
  markStateSafe();
}

init();
