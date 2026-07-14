import { state, markStateSafe } from './state.js';
import { getColor } from './materials.js';
import { fmt } from './pricing.js';
import { TYPES } from '../types/registry.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';
import { showToast } from './toast.js';

let orderItems = []; // накопленные прорисовки текущего проекта (локально, до сохранения)
let editingItemId = null; // id локально редактируемой прорисовки в этом накоплении

// Если задан — «Сохранить проект» обновляет ИМЕННО эту строку в drawings (текущим state), минуя
// локальное накопление — см. loadDrawingForEdit (открыта прорисовка из личного кабинета).
let editingDrawingId = null;
let editingDrawingClient = null; // { name, phone, address } — подставляются в модалку при обновлении

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
    document.getElementById('addItemBtn').textContent = '+ Добавить в проект';
  } else {
    orderItems.push({ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: snap });
  }
  // Текущий дизайн только что попал в проект — безопасно переключать тип изделия без
  // предупреждения (см. hasUnsavedChanges/tabs.js bindTypeButtons), пока ничего снова не поменяли.
  markStateSafe();
  renderOrderCards();
}

// Доп. элемент/услуга (вкладка «Добавить к заказу») — без 3D-снапшота, только строка с ценой.
export function addExtraItem(label, total) {
  orderItems.push({ id: Date.now(), kind: 'extra', label, total, snapshot: null });
  renderOrderCards();
}

export function loadItemForEdit(id) {
  const item = orderItems.find(it => it.id === id);
  if (!item || !item.snapshot) return;
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
  markStateSafe();
}

// Открыть уже сохранённую (на сервере) прорисовку из личного кабинета для просмотра/правки —
// см. js/core/cabinet.js. В отличие от loadItemForEdit (локальная корзина текущего проекта),
// тут прорисовка одна и уже существует в drawings — «Сохранить проект» без накопления в
// корзине сразу обновит именно эту строку текущим state (см. bindOrderForm).
export function loadDrawingForEdit(drawing) {
  if (!drawing.snapshot) { showToast('Это услуга/доп. элемент — прорисовки нет.'); return; }
  editingDrawingId = drawing.id;
  editingDrawingClient = { name: drawing.client_name || '', phone: drawing.client_phone || '', address: drawing.client_address || '' };
  Object.assign(state, JSON.parse(JSON.stringify(drawing.snapshot)));
  syncUIFromState();
  ['korpus', 'fasad', 'fill'].forEach(g => {
    document.getElementById(g + 'Producer').value = state[g + 'Producer'];
    renderSwatches(g, g + 'Swatches');
  });
  buildFurniture();
  document.querySelector('[data-tab="type"]').click();
  showToast('Прорисовка загружена. Внесите изменения и нажмите «Сохранить проект» на вкладке «Проект», чтобы обновить.');
  markStateSafe();
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
      ${item.kind === 'extra' ? '' : `
      <button class="order-card-edit ${isEditing ? 'editing' : ''}" data-id="${item.id}">
        ${isEditing ? '✏️ Редактируется сейчас...' : 'Изменить'}
      </button>`}
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      orderItems = orderItems.filter(it => it.id !== id);
      if (editingItemId === id) {
        editingItemId = null;
        document.getElementById('addItemBtn').textContent = '+ Добавить в проект';
      }
      renderOrderCards();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => loadItemForEdit(Number(btn.dataset.id)));
  });

  grandEl.textContent = fmt(grand);
  counterTxt.textContent = `В проекте: ${orderItems.length} изд. • ${fmt(grand)}`;
}

export function orderSummaryFull() {
  if (orderItems.length === 0) return describeConfig();
  const lines = orderItems.map((it, i) => `${i + 1}. ${it.label}`);
  const grand = orderItems.reduce((s, it) => s + it.total, 0);
  return lines.join('\n') + `\n\nИтого по проекту: ${fmt(grand)}`;
}

export function bindOrderForm() {
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('orderBtn').addEventListener('click', () => {
    document.getElementById('orderSummary').textContent = orderSummaryFull();
    document.getElementById('orderResult').textContent = '';
    document.getElementById('orderName').value    = editingDrawingClient?.name    || '';
    document.getElementById('orderPhone').value   = editingDrawingClient?.phone   || '';
    document.getElementById('orderAddress').value = editingDrawingClient?.address || '';
    overlay.classList.add('visible');
  });
  document.getElementById('orderCancel').addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
  document.getElementById('orderSubmit').addEventListener('click', async () => {
    const name    = document.getElementById('orderName').value.trim();
    const phone   = document.getElementById('orderPhone').value.trim();
    const address = document.getElementById('orderAddress').value.trim();
    const result = document.getElementById('orderResult');
    if (!name)  { result.style.color = 'red'; result.textContent = 'Укажите имя';     return; }
    if (!phone) { result.style.color = 'red'; result.textContent = 'Укажите телефон'; return; }
    if (!auth.session) {
      result.style.color = 'red';
      result.textContent = 'Сохранение недоступно локально — только на опубликованном сайте после входа.';
      return;
    }

    result.style.color = '#555';
    result.textContent = 'Сохранение...';

    // Открыта существующая прорисовка (см. loadDrawingForEdit) — обновляем именно её текущим
    // state, а не заводим новые строки из локальной корзины.
    if (editingDrawingId !== null) {
      const { error } = await supabase.from('drawings').update({
        client_name: name, client_phone: phone, client_address: address,
        summary: describeConfig(), total: state.lastTotal || 0,
        snapshot: JSON.parse(JSON.stringify(state)),
        updated_at: new Date().toISOString(),
      }).eq('id', editingDrawingId);
      if (error) {
        console.error('drawings update failed:', error);
        result.style.color = 'red';
        result.textContent = 'Ошибка сохранения: ' + error.message;
        return;
      }
      result.style.color = 'green';
      result.textContent = 'Проект обновлён.';
      editingDrawingId = null;
      editingDrawingClient = null;
      markStateSafe();
      setTimeout(() => overlay.classList.remove('visible'), 1500);
      return;
    }

    // Обычный поток: локальная корзина (если пуста — текущая открытая позиция), каждая
    // прорисовка — отдельная строка в drawings, все с одними и теми же данными клиента.
    const items = orderItems.length ? orderItems
      : [{ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: JSON.parse(JSON.stringify(state)) }];
    const rows = items.map(it => ({
      user_id: auth.session.user.id,
      client_name: name,
      client_phone: phone,
      client_address: address,
      summary: it.label,
      total: it.total,
      snapshot: it.snapshot,
    }));
    const { error } = await supabase.from('drawings').insert(rows);
    if (error) {
      console.error('drawings insert failed:', error);
      result.style.color = 'red';
      result.textContent = 'Ошибка сохранения: ' + error.message;
      return;
    }
    result.style.color = 'green';
    result.textContent = 'Проект сохранён.';
    orderItems = [];
    renderOrderCards();
    markStateSafe();
    setTimeout(() => overlay.classList.remove('visible'), 1500);
  });
}
