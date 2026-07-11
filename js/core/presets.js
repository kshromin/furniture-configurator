import { state, materials } from './state.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { buildFurniture } from './build.js';
import { rebalanceSections } from '../types/_wardrobe-shared.js';

export function applyPreset(p) {
  state.type    = p.type || 'wardrobe';
  state.width   = p.width;
  state.height  = p.height;
  state.depth   = p.depth;
  state.drawers = p.drawers || 0; // плоское значение — для комода и т.п.

  // Пресеты хранят секции по-старому (одно число + общие полки/ящики/штанга на все секции) —
  // раскладываем это в массив секций с равными ширинами, дальше rebalanceSections() их посчитает.
  const n = p.sections || 2;
  state.sections = Array.from({ length: n }, () => ({
    width: 0, shelves: 1 + (p.shelves || 0),
    drawers: p.drawers || 0, drawerHeight: 150, drawerDepth: 500, drawerSoftClose: true,
    rod: p.rod ? 1 : 0, meshShelves: 0, meshDepth: 400, meshColor: 'silver', valet: 0, valetLength: 400,
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
}

export function renderPresets() {
  const container = document.getElementById('presets');
  if (!container) return;
  container.innerHTML = '';
  (materials.presets || []).forEach(p => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    const typeName = TYPES[p.type]?.name || p.type;

    card.innerHTML = `
      <div class="preset-card-name">${p.name}</div>
      <div class="preset-card-desc">${typeName} · ${p.width}×${p.height}×${p.depth} мм</div>
    `;
    card.addEventListener('click', () => {
      applyPreset(p);
      document.querySelector('[data-tab="type"]').click();
    });
    container.appendChild(card);
  });
}
