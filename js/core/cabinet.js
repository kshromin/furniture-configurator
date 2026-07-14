import { state, markStateSafe } from './state.js';
import { fmt } from './pricing.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { supabase } from './supabaseClient.js';
import { auth, signOut } from './auth.js';
import { showToast } from './toast.js';

const STATUS_LABELS = { new: 'Новая', confirmed: 'Подтверждена', production: 'В производстве', done: 'Готово' };

// Список сохранённых комплектов прорисовок переехал в отдельную вкладку «Проекты»
// (js/core/projects.js, таблица projects) — кабинет остался про заявки/конфигурации/выход.
export async function renderCabinet() {
  if (!auth.session) {
    document.getElementById('cabinetOrdersEmpty').style.display = 'block';
    document.getElementById('cabinetOrdersEmpty').textContent = 'Личный кабинет недоступен без входа.';
    document.getElementById('cabinetConfigsEmpty').style.display = 'none';
    return;
  }
  await Promise.all([renderMyOrders(), renderMyConfigs()]);
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
}
