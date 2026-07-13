import { state, markStateSafe } from './state.js';
import { fmt } from './pricing.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { supabase } from './supabaseClient.js';
import { auth, signOut } from './auth.js';
import { showToast } from './toast.js';
import { loadDrawingForEdit } from './order.js';

const STATUS_LABELS = { new: 'Новая', confirmed: 'Подтверждена', production: 'В производстве', done: 'Готово' };

export async function renderCabinet() {
  if (!auth.session) {
    document.getElementById('cabinetDrawingsEmpty').style.display = 'block';
    document.getElementById('cabinetDrawingsEmpty').textContent = 'Личный кабинет недоступен локально — только на опубликованном сайте после входа.';
    document.getElementById('cabinetOrdersEmpty').style.display = 'none';
    document.getElementById('cabinetConfigsEmpty').style.display = 'none';
    return;
  }
  await Promise.all([renderMyDrawings(), renderMyOrders(), renderMyConfigs()]);
}

// Мои проекты (прорисовки) — плоский список прорисовок текущего менеджера, у каждой свои данные
// клиента (могут повторяться для нескольких прорисовок одного клиента, могут различаться —
// формальной группировки в отдельную сущность "проект" нет, только сортировка/фильтр по полю
// клиента в списке). См. js/core/order.js bindOrderForm — сохраняет сюда.
async function renderMyDrawings() {
  const list  = document.getElementById('cabinetDrawingsList');
  const empty = document.getElementById('cabinetDrawingsEmpty');
  const sortSelect = document.getElementById('drawingsSortSelect');
  const sortByClient = sortSelect && sortSelect.value === 'client';

  const { data, error } = await supabase
    .from('drawings')
    .select('*')
    .eq('user_id', auth.session.user.id)
    .order(sortByClient ? 'client_name' : 'created_at', { ascending: sortByClient });

  list.innerHTML = '';
  if (error || !data || data.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  data.forEach(d => {
    const date = new Date(d.created_at).toLocaleDateString('ru-RU');
    const client = [d.client_name, d.client_phone].filter(Boolean).join(', ') || 'Без клиента';
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">${date}</span>
        <span class="order-card-name">${client}<br>${d.summary.replace(/\n/g, '<br>')}</span>
        <button class="order-card-remove" data-id="${d.id}" title="Удалить">×</button>
      </div>
      <div class="order-card-price">${fmt(d.total)}</div>
      <button class="order-card-edit" data-id="${d.id}">Открыть</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.from('drawings').delete().eq('id', Number(btn.dataset.id));
      renderMyDrawings();
    });
  });
  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = data.find(x => x.id === Number(btn.dataset.id));
      if (d) loadDrawingForEdit(d);
    });
  });
}

async function renderMyOrders() {
  const list  = document.getElementById('cabinetOrdersList');
  const empty = document.getElementById('cabinetOrdersEmpty');
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', auth.session.user.id)
    .order('created_at', { ascending: false });

  list.innerHTML = '';
  if (error || !data || data.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  data.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    const date = new Date(order.created_at).toLocaleDateString('ru-RU');
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">${date}</span>
        <span class="order-card-name">${order.summary.replace(/\n/g, '<br>')}</span>
      </div>
      <div class="order-card-price">${fmt(order.total)}</div>
      <span class="status-pill status-${order.status}">${STATUS_LABELS[order.status] || order.status}</span>
    `;
    list.appendChild(card);
  });
}

async function renderMyConfigs() {
  const list  = document.getElementById('cabinetConfigsList');
  const empty = document.getElementById('cabinetConfigsEmpty');
  const { data, error } = await supabase
    .from('saved_configs')
    .select('*')
    .eq('user_id', auth.session.user.id)
    .order('created_at', { ascending: false });

  list.innerHTML = '';
  if (error || !data || data.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  data.forEach(cfg => {
    const date = new Date(cfg.created_at).toLocaleDateString('ru-RU');
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">${date}</span>
        <span class="order-card-name">${cfg.name}</span>
        <button class="order-card-remove" data-id="${cfg.id}" title="Удалить">×</button>
      </div>
      <button class="order-card-edit" data-id="${cfg.id}">Загрузить</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.from('saved_configs').delete().eq('id', Number(btn.dataset.id));
      renderMyConfigs();
    });
  });
  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg = data.find(c => c.id === Number(btn.dataset.id));
      if (cfg) loadConfigForEdit(cfg.snapshot);
    });
  });
}

function loadConfigForEdit(snapshot) {
  Object.assign(state, JSON.parse(JSON.stringify(snapshot)));
  syncUIFromState();
  ['korpus', 'fasad', 'fill'].forEach(g => {
    document.getElementById(g + 'Producer').value = state[g + 'Producer'];
    renderSwatches(g, g + 'Swatches');
  });
  buildFurniture();
  document.querySelector('[data-tab="type"]').click();
  showToast('Конфигурация загружена');
  markStateSafe();
}

async function saveCurrentConfig() {
  if (!auth.session) { showToast('Доступно только на опубликованном сайте после входа'); return; }
  const name = window.prompt('Название конфигурации:', '');
  if (!name) return;
  const { error } = await supabase.from('saved_configs').insert({
    user_id: auth.session.user.id,
    name: name.trim(),
    snapshot: JSON.parse(JSON.stringify(state)),
  });
  if (error) { showToast('Не удалось сохранить конфигурацию'); return; }
  showToast('Конфигурация сохранена');
  renderMyConfigs();
  markStateSafe();
}

export function bindCabinetControls() {
  document.getElementById('saveConfigBtn').addEventListener('click', saveCurrentConfig);
  document.getElementById('logoutBtn').addEventListener('click', () => signOut());
  document.getElementById('drawingsSortSelect').addEventListener('change', () => renderMyDrawings());
}
