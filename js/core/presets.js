import { state, materials } from './state.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { buildFurniture } from './build.js';

export function applyPreset(p) {
  state.type           = p.type || 'wardrobe';
  state.width          = p.width;
  state.height         = p.height;
  state.depth          = p.depth;
  state.sections       = p.sections || 2;
  state.shelves        = p.shelves  || 0;
  state.drawers        = p.drawers  || 0;
  state.rod            = !!p.rod;
  state.korpusProducer = p.korpusProducer;
  state.korpusId       = p.korpusId;
  state.fasadProducer  = p.fasadProducer;
  state.fasadId        = p.fasadId;
  state.fillProducer   = p.fillProducer;
  state.fillId         = p.fillId;
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
