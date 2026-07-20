import { state, markStateSafe } from './state.js';
import { syncUIFromState } from './tabs.js';
import { renderSwatches } from './materials.js';
import { buildFurniture } from './build.js';
import { supabase } from './supabaseClient.js';
import { auth, signOut } from './auth.js';
import { showToast } from './toast.js';
import { renderOrders } from './projects.js';

// Список сохранённых комплектов переехал во вкладку «Проекты» (js/core/projects.js, таблица
// projects); заказы новой модели — там же (kind='order'). Старый блок «Мои заказы» (таблица
// orders, заявки с формы) из кабинета убран, чтобы не путать с новыми заказами — сама таблица
// и админ-панель по ней не тронуты.
export async function renderCabinet() {
  if (!auth.session) {
    document.getElementById('cabinetConfigsEmpty').style.display = 'block';
    document.getElementById('cabinetConfigsEmpty').textContent = 'Личный кабинет недоступен без входа.';
    return;
  }
  await renderMyConfigs();
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

// Большое окно «Заказы» (сессия 38) — то же решение, что и у «Проекты» (js/core/projects.js):
// вместо узкой вкладки в сайдбаре, модал поверх текущей вкладки, тот же .projects-modal-* CSS.
// Список заказов и «Мои сохранённые конфигурации» — те же элементы (id совпадают с прежней
// .tab-pane), просто теперь внутри модала.
export function openCabinetModal() {
  document.getElementById('cabinetModalOverlay').classList.add('visible');
  renderCabinet();
  renderOrders();
}
export function closeCabinetModal() {
  document.getElementById('cabinetModalOverlay').classList.remove('visible');
}

export function bindCabinetControls() {
  document.getElementById('saveConfigBtn').addEventListener('click', saveCurrentConfig);
  document.getElementById('logoutBtn').addEventListener('click', () => signOut());

  const overlay = document.getElementById('cabinetModalOverlay');
  document.getElementById('cabinetModalClose').addEventListener('click', closeCabinetModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCabinetModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeCabinetModal();
  });
}
