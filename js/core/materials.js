import { materials, state } from './state.js';
import { buildFurniture } from './build.js';

export function getProducers(group) { return materials[group]?.producers || []; }

export function getColors(group, producerId) {
  const p = getProducers(group).find(p => p.id === producerId);
  return p ? p.colors : [];
}

export function getColor(group) {
  const id = state[group + 'Id'];
  const pid = state[group + 'Producer'];
  const colors = getColors(group, pid);
  return colors.find(c => c.id === id) || colors[0] || { color: '#cccccc', pricePerM2: 0 };
}

const SWATCH_NAME_IDS = { korpus: 'korpusColorName', fasad: 'fasadColorName', fill: 'fillColorName' };

export function renderSwatches(group, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const colors = getColors(group, state[group + 'Producer']);
  colors.forEach(c => {
    const el = document.createElement('div');
    el.className = 'swatch' + (c.id === state[group + 'Id'] ? ' selected' : '');
    el.style.background = c.color;
    el.title = c.name + ' — ' + c.pricePerM2 + ' ₽/м²';
    el.addEventListener('click', () => {
      state[group + 'Id'] = c.id;
      renderSwatches(group, containerId);
      buildFurniture();
    });
    container.appendChild(el);
  });
  const nameEl = document.getElementById(SWATCH_NAME_IDS[group]);
  if (nameEl) {
    const sel = colors.find(c => c.id === state[group + 'Id']);
    nameEl.textContent = sel ? sel.name + (sel.pricePerM2 ? '  ·  ' + sel.pricePerM2 + ' ₽/м²' : '') : '';
  }
}

export function renderProducerSelect(group, selectId, swatchesId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  getProducers(group).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = state[group + 'Producer'];
  sel.addEventListener('change', () => {
    state[group + 'Producer'] = sel.value;
    const colors = getColors(group, sel.value);
    state[group + 'Id'] = colors[0]?.id || null;
    renderSwatches(group, swatchesId);
    buildFurniture();
  });
  renderSwatches(group, swatchesId);
}
