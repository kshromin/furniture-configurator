import { state } from './state.js';
import { getColor } from './materials.js';
import { fmt } from './pricing.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';

let orderItems = []; // накопленные позиции заказа
let editingItemId = null; // id редактируемой позиции

export function describeConfig() {
  const type = TYPES[state.type];
  const kName = getColor('korpus').name || '';
  const fName = getColor('fasad').name  || '';
  let s = `${type?.name || state.type}, ${state.width}×${state.height}×${state.depth} мм`;
  s += `, корпус: ${kName}, фасад: ${fName}`;
  s += type.describe();
  s += `. Итого: ${fmt(state.lastTotal || 0)}`;
  return s;
}

export function addCurrentToOrder() {
  const snap = JSON.parse(JSON.stringify(state));
  if (editingItemId !== null) {
    const idx = orderItems.findIndex(it => it.id === editingItemId);
    if (idx !== -1) {
      orderItems[idx].label    = describeConfig();
      orderItems[idx].total    = state.lastTotal || 0;
      orderItems[idx].snapshot = snap;
    }
    editingItemId = null;
    document.getElementById('addItemBtn').textContent = '+ Добавить в заказ';
  } else {
    orderItems.push({ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: snap });
  }
  renderOrderCards();
}

export function loadItemForEdit(id) {
  const item = orderItems.find(it => it.id === id);
  if (!item) return;
  editingItemId = id;
  Object.assign(state, JSON.parse(JSON.stringify(item.snapshot)));
  syncUIFromState();
  ['korpus', 'fasad', 'fill'].forEach(g => {
    document.getElementById(g + 'Producer').value = state[g + 'Producer'];
    renderSwatches(g, g + 'Swatches');
  });
  buildFurniture();
  document.getElementById('addItemBtn').textContent = '✓ Обновить позицию';
  document.querySelector('[data-tab="type"]').click();
  renderOrderCards();
}

export function renderOrderCards() {
  const list    = document.getElementById('orderCardsList');
  const empty   = document.getElementById('orderEmptyNote');
  const grandRow = document.getElementById('orderGrandRow');
  const grandEl  = document.getElementById('orderGrandTotal');
  const badge    = document.getElementById('orderBadge');
  const counter  = document.getElementById('orderCounterRow');
  const counterTxt = document.getElementById('orderCounterText');

  list.innerHTML = '';

  if (orderItems.length === 0) {
    empty.style.display   = 'block';
    grandRow.style.display = 'none';
    badge.style.display    = 'none';
    counter.style.display  = 'none';
    return;
  }

  empty.style.display    = 'none';
  grandRow.style.display = 'flex';
  badge.style.display    = 'block';
  counter.style.display  = 'flex';
  badge.textContent      = orderItems.length;

  let grand = 0;
  orderItems.forEach((item, idx) => {
    grand += item.total;
    const isEditing = item.id === editingItemId;
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">#${idx + 1}</span>
        <span class="order-card-name">${item.label}</span>
        <button class="order-card-remove" data-id="${item.id}" title="Удалить">×</button>
      </div>
      <div class="order-card-price">${fmt(item.total)}</div>
      <button class="order-card-edit ${isEditing ? 'editing' : ''}" data-id="${item.id}">
        ${isEditing ? '✏️ Редактируется сейчас...' : 'Изменить'}
      </button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      orderItems = orderItems.filter(it => it.id !== id);
      if (editingItemId === id) {
        editingItemId = null;
        document.getElementById('addItemBtn').textContent = '+ Добавить в заказ';
      }
      renderOrderCards();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => loadItemForEdit(Number(btn.dataset.id)));
  });

  grandEl.textContent = fmt(grand);
  counterTxt.textContent = `В заказе: ${orderItems.length} изд. • ${fmt(grand)}`;
}

export function orderSummaryFull() {
  if (orderItems.length === 0) return describeConfig();
  const lines = orderItems.map((it, i) => `${i + 1}. ${it.label}`);
  const grand = orderItems.reduce((s, it) => s + it.total, 0);
  return lines.join('\n') + `\n\nИтого по заказу: ${fmt(grand)}`;
}

export function bindOrderForm() {
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('orderBtn').addEventListener('click', () => {
    document.getElementById('orderSummary').textContent = describeConfig();
    document.getElementById('orderResult').textContent = '';
    document.getElementById('orderName').value = '';
    document.getElementById('orderPhone').value = '';
    overlay.classList.add('visible');
  });
  document.getElementById('orderCancel').addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
  document.getElementById('orderSubmit').addEventListener('click', () => {
    const name  = document.getElementById('orderName').value.trim();
    const phone = document.getElementById('orderPhone').value.trim();
    const result = document.getElementById('orderResult');
    if (!name)  { result.style.color = 'red'; result.textContent = 'Укажите имя';     return; }
    if (!phone) { result.style.color = 'red'; result.textContent = 'Укажите телефон'; return; }
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    orders.push({ id: Date.now(), name, phone, summary: describeConfig(), total: state.lastTotal, createdAt: new Date().toISOString() });
    localStorage.setItem('orders', JSON.stringify(orders));
    result.style.color = 'green';
    result.textContent = 'Заявка сохранена. Мы свяжемся с вами!';
    setTimeout(() => overlay.classList.remove('visible'), 1500);
  });
}
