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

// Вкладка «Прорисовки» — локальный рабочий комплект (несколько изделий/услуг), без адресного
// сохранения. Комплект целиком сохраняется одной строкой таблицы projects (см.
// SUPABASE-SETUP.md п.11): kind='project' (краткая карточка клиента, без адреса) или
// kind='order' (клиент заключает договор — расширенные поля, адрес обязателен).
let orderItems = []; // текущие прорисовки: { id, kind?: 'extra', label, total, snapshot|null }
let editingItemId = null; // id локально редактируемой прорисовки

// Открытый проект из вкладки «Проекты»: «Сохранить в проект»/«Добавить в заказ» обновляют
// именно эту строку projects, а не создают новую.
let editingProjectId = null;
let editingProjectClient = null; // { name, phone, address }
let itemsSavedToProject = false; // текущий комплект уже сохранён (для предупреждения при открытии другого)

let modalKind = 'project'; // какой режим открыт в модалке: project | order

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
    document.getElementById('addItemBtn').textContent = '+ Добавить в прорисовки';
  } else {
    orderItems.push({ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: snap });
  }
  itemsSavedToProject = false;
  markStateSafe();
  renderOrderCards();
}

// Доп. элемент/услуга (вкладка «Добавить к заказу») — без 3D-снапшота, только строка с ценой.
export function addExtraItem(label, total) {
  orderItems.push({ id: Date.now(), kind: 'extra', label, total, snapshot: null });
  itemsSavedToProject = false;
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

// Открыть сохранённый комплект из вкладки «Проекты». Если в «Прорисовках» лежит несохранённый
// комплект — предупреждаем, что он будет утерян.
export function openProject(project) {
  if (orderItems.length > 0 && !itemsSavedToProject) {
    const ok = window.confirm('Текущие прорисовки не сохранены и будут утеряны. Открыть проект?');
    if (!ok) return;
  }
  editingProjectId = project.id;
  editingProjectClient = {
    name: project.client_name || '', phone: project.client_phone || '', address: project.client_address || '',
  };
  orderItems = (project.items || []).map(it => ({ ...it, id: it.id || Date.now() + Math.random() }));
  itemsSavedToProject = true;
  editingItemId = null;
  renderOrderCards();
  // первую прорисовку с 3D сразу показываем на модели
  const first = orderItems.find(it => it.snapshot);
  if (first) {
    Object.assign(state, JSON.parse(JSON.stringify(first.snapshot)));
    syncUIFromState();
    ['korpus', 'fasad', 'fill'].forEach(g => {
      document.getElementById(g + 'Producer').value = state[g + 'Producer'];
      renderSwatches(g, g + 'Swatches');
    });
    buildFurniture();
    markStateSafe();
  }
  document.querySelector('[data-tab="order"]').click();
  showToast(`Проект${project.project_code ? ' № ' + project.project_code : ''} открыт — комплект в «Прорисовках».`);
}

function updateEditingProjectNote() {
  const note = document.getElementById('editingProjectNote');
  if (!note) return;
  if (editingProjectId !== null) {
    const c = editingProjectClient?.name ? ` (${editingProjectClient.name})` : '';
    note.textContent = `Открыт сохранённый проект${c} — «Сохранить в проект» обновит его же.`;
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }
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
  updateEditingProjectNote();

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
      const item = orderItems.find(it => it.id === id);
      if (!window.confirm(`Удалить «${(item?.label || '').slice(0, 60)}…»?`)) return;
      orderItems = orderItems.filter(it => it.id !== id);
      itemsSavedToProject = false;
      if (editingItemId === id) {
        editingItemId = null;
        document.getElementById('addItemBtn').textContent = '+ Добавить в прорисовки';
      }
      renderOrderCards();
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => loadItemForEdit(Number(btn.dataset.id)));
  });

  grandEl.textContent = fmt(grand);
  counterTxt.textContent = `Прорисовок: ${orderItems.length} • ${fmt(grand)}`;
}

export function orderSummaryFull() {
  if (orderItems.length === 0) return describeConfig();
  const lines = orderItems.map((it, i) => `${i + 1}. ${it.label}`);
  const grand = orderItems.reduce((s, it) => s + it.total, 0);
  return lines.join('\n') + `\n\nИтого по комплекту: ${fmt(grand)}`;
}

function openSaveModal(kind) {
  modalKind = kind;
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('orderModalTitle').textContent =
    kind === 'order' ? 'Добавить в заказ' : 'Сохранить в проект';
  document.getElementById('orderAddressField').style.display = kind === 'order' ? 'block' : 'none';
  document.getElementById('orderSummary').textContent = orderSummaryFull();
  document.getElementById('orderResult').textContent = '';
  document.getElementById('orderName').value    = editingProjectClient?.name    || '';
  document.getElementById('orderPhone').value   = editingProjectClient?.phone   || '';
  document.getElementById('orderAddress').value = editingProjectClient?.address || '';
  overlay.classList.add('visible');
}

export function bindOrderForm() {
  const overlay = document.getElementById('orderOverlay');
  document.getElementById('saveProjectBtn').addEventListener('click', () => openSaveModal('project'));
  document.getElementById('saveOrderBtn').addEventListener('click', () => openSaveModal('order'));
  document.getElementById('orderCancel').addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });

  document.getElementById('orderSubmit').addEventListener('click', async () => {
    const name    = document.getElementById('orderName').value.trim();
    const phone   = document.getElementById('orderPhone').value.trim();
    const address = document.getElementById('orderAddress').value.trim();
    const result = document.getElementById('orderResult');
    if (!name)  { result.style.color = 'red'; result.textContent = 'Укажите имя';     return; }
    if (!phone) { result.style.color = 'red'; result.textContent = 'Укажите телефон'; return; }
    if (modalKind === 'order' && !address) {
      result.style.color = 'red'; result.textContent = 'Для заказа укажите адрес'; return;
    }
    if (!auth.session) {
      result.style.color = 'red';
      result.textContent = 'Сохранение недоступно без входа.';
      return;
    }

    result.style.color = '#555';
    result.textContent = 'Сохранение...';

    // Комплект: текущие прорисовки (если пусто — текущая открытая модель одной прорисовкой)
    const items = orderItems.length ? orderItems
      : [{ id: Date.now(), label: describeConfig(), total: state.lastTotal || 0, snapshot: JSON.parse(JSON.stringify(state)) }];
    const total = items.reduce((s, it) => s + it.total, 0);
    const row = {
      kind: modalKind,
      client_name: name, client_phone: phone, client_address: address,
      items: items.map(({ id, ...rest }) => rest), // локальные id не сохраняем
      total,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingProjectId !== null) {
      ({ error } = await supabase.from('projects').update(row).eq('id', editingProjectId));
    } else {
      let data;
      ({ data, error } = await supabase.from('projects')
        .insert({ ...row, user_id: auth.session.user.id })
        .select('id, project_code').single());
      if (!error && data) {
        editingProjectId = data.id; // повторное сохранение обновит эту же строку
      }
    }

    if (error) {
      console.error('projects save failed:', error);
      result.style.color = 'red';
      result.textContent = 'Ошибка сохранения: ' + error.message;
      return;
    }

    editingProjectClient = { name, phone, address };
    itemsSavedToProject = true;
    result.style.color = 'green';
    result.textContent = modalKind === 'order' ? 'Заказ сохранён.' : 'Проект сохранён.';
    markStateSafe();
    renderOrderCards();
    setTimeout(() => overlay.classList.remove('visible'), 1200);
  });
}
