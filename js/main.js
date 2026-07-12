import { state, materials, setMaterials } from './core/state.js';
import { renderProducerSelect } from './core/materials.js';
import { renderPresets } from './core/presets.js';
import { buildFurniture } from './core/build.js';
import {
  bindTypeButtons, bindSlider, bindFasadTab, bindVariantControls,
  bindTabSwitching, bindToggleDoors, bindBackWall, bindSectionsControls, syncUIFromState,
} from './core/tabs.js';
import { addCurrentToOrder, renderOrderCards, bindOrderForm } from './core/order.js';
import { initItemDrag } from './core/itemDrag.js';

async function init() {
  const res = await fetch('data/materials.json');
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

  initItemDrag();

  syncUIFromState();
  buildFurniture();
}

init();
