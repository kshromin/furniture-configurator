import { fmt } from './pricing.js';
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';
import { openProject } from './order.js';

// Списки сохранённых комплектов (таблица projects): вкладка «Проекты» (kind='project') и
// вкладка «Заказы» (kind='order', компактные карточки). Общий механизм: текстовый поиск по
// совпадению подстроки (название + клиент, в любом месте строки), сортировка по датам
// создания/изменения (с диапазоном, диапазон фиксируется в localStorage) и по названию/клиенту.

const KIND_LABELS = { project: 'Проект', order: 'Заказ' };

// Конфиг двух списков: id элементов управления + kind. «Проекты» и «Заказы» работают одинаково.
const LISTS = {
  project: {
    kind: 'project', list: 'projectsList', empty: 'projectsEmpty', sort: 'projectsSortSelect',
    search: 'projectsSearch', range: 'projectsRange', from: 'projectsFrom', to: 'projectsTo',
    clear: 'projectsRangeClear', storageKey: 'projectsDateRange',
    emptyText: 'Сохранённых проектов пока нет.',
  },
  order: {
    kind: 'order', list: 'ordersList', empty: 'ordersEmpty', sort: 'ordersSortSelect',
    search: 'ordersSearch', range: 'ordersRange', from: 'ordersFrom', to: 'ordersTo',
    clear: 'ordersRangeClear', storageKey: 'ordersDateRange',
    emptyText: 'Заказов пока нет.',
  },
};

function sortField(cfg) { return document.getElementById(cfg.sort).value; } // created|updated|title|client

function loadRange(cfg) {
  try { return JSON.parse(localStorage.getItem(cfg.storageKey)) || {}; } catch { return {}; }
}
function saveRange(cfg, from, to) {
  localStorage.setItem(cfg.storageKey, JSON.stringify({ from, to }));
}

export async function renderList(kindKey) {
  const cfg = LISTS[kindKey];
  const list  = document.getElementById(cfg.list);
  const empty = document.getElementById(cfg.empty);
  if (!list) return;
  if (!auth.session) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Недоступно без входа.';
    document.getElementById(cfg.range).style.display = 'none';
    return;
  }

  const field = sortField(cfg);
  const byDate = field === 'created' || field === 'updated';

  // Диапазон дат показывается только при сортировке по датам; поиск виден всегда
  document.getElementById(cfg.range).style.display = byDate ? 'flex' : 'none';

  const { data, error } = await supabase
    .from('projects').select('*')
    .eq('user_id', auth.session.user.id)
    .eq('kind', cfg.kind);

  list.innerHTML = '';
  if (error) {
    empty.style.display = 'block';
    empty.textContent = 'Ошибка загрузки: ' + error.message;
    return;
  }

  let rows = data || [];

  // Текстовый поиск: подстрока в любом месте названия, имени клиента или телефона
  const q = document.getElementById(cfg.search).value.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.client_name || '').toLowerCase().includes(q) ||
      (r.client_phone || '').toLowerCase().includes(q));
  }

  // Диапазон дат (при сортировке по датам)
  if (byDate) {
    const { from, to } = loadRange(cfg);
    const dateCol = field === 'created' ? 'created_at' : 'updated_at';
    if (from) rows = rows.filter(r => r[dateCol] >= from);
    if (to)   rows = rows.filter(r => r[dateCol] <= to + 'T23:59:59');
    document.getElementById(cfg.from).value = from || '';
    document.getElementById(cfg.to).value   = to || '';
  }

  // Сортировка
  rows.sort((a, b) => {
    if (field === 'created') return b.created_at.localeCompare(a.created_at);
    if (field === 'updated') return (b.updated_at || '').localeCompare(a.updated_at || '');
    if (field === 'title')   return (a.title || '').localeCompare(b.title || '', 'ru');
    return (a.client_name || '').localeCompare(b.client_name || '', 'ru');
  });

  if (rows.length === 0) {
    empty.style.display = 'block';
    empty.textContent = cfg.emptyText;
    return;
  }
  empty.style.display = 'none';

  rows.forEach(p => {
    const created = new Date(p.created_at).toLocaleDateString('ru-RU');
    const client = [p.client_name, p.client_phone].filter(Boolean).join(', ') || 'Без клиента';
    const n = (p.items || []).length;
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-num">${p.project_code ? `${p.project_code} · ` : ''}${created}</span>
        <span class="order-card-name">${p.title ? `<b>${p.title}</b><br>` : ''}${client}<br>Прорисовок: ${n}</span>
        <button class="order-card-remove" data-id="${p.id}" title="Удалить">×</button>
      </div>
      <div class="order-card-price">${fmt(p.total)}</div>
      <span class="status-pill status-${p.kind === 'order' ? 'confirmed' : 'new'}">${KIND_LABELS[p.kind]}</span>
      <button class="order-card-edit" data-id="${p.id}">Открыть</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.order-card-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = rows.find(x => x.id === Number(btn.dataset.id));
      const who = p ? ([p.title, p.client_name, p.project_code].filter(Boolean).join(', ') || 'без данных') : '';
      if (!window.confirm(`Удалить ${cfg.kind === 'order' ? 'заказ' : 'проект'} (${who})? Действие необратимо.`)) return;
      await supabase.from('projects').delete().eq('id', Number(btn.dataset.id));
      renderList(kindKey);
    });
  });

  list.querySelectorAll('.order-card-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = rows.find(x => x.id === Number(btn.dataset.id));
      if (p) openProject(p);
    });
  });
}

export const renderProjects = () => renderList('project');
export const renderOrders   = () => renderList('order');

function bindListControls(kindKey) {
  const cfg = LISTS[kindKey];
  document.getElementById(cfg.sort).addEventListener('change', () => renderList(kindKey));
  document.getElementById(cfg.search).addEventListener('input', () => renderList(kindKey));
  const commitRange = () => {
    saveRange(cfg, document.getElementById(cfg.from).value, document.getElementById(cfg.to).value);
    renderList(kindKey);
  };
  document.getElementById(cfg.from).addEventListener('change', commitRange);
  document.getElementById(cfg.to).addEventListener('change', commitRange);
  document.getElementById(cfg.clear).addEventListener('click', () => {
    saveRange(cfg, '', '');
    renderList(kindKey);
  });
}

export function bindProjectsControls() {
  bindListControls('project');
  bindListControls('order');
  window.addEventListener('projects-changed', () => { renderProjects(); renderOrders(); });
}
