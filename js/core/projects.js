import { fmt } from './pricing.js';
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';
import { openProject } from './order.js';

// Списки сохранённых комплектов (таблица projects): вкладка «Проекты» (kind='project') и
// вкладка «Заказы» (kind='order', компактные карточки). Общий механизм: текстовый поиск (по
// названию/клиенту/телефону), сортировка по датам (с диапазоном, диапазон фиксируется в
// localStorage) или по названию/клиенту — все три теперь считаются на стороне Supabase (`.or`/
// `.gte`/`.lte`/`.order`), не на клиенте: со списком, который у пользователя реально растёт (см.
// пагинация ниже), тянуть всё и фильтровать в JS было бы всё тяжелее с каждым новым проектом.

const KIND_LABELS = { project: 'Проект', order: 'Заказ' };

// Пагинация «Показать ещё» (сессия 37, по просьбе — «даже 40-60 много») — сначала грузим только
// PAGE_SIZE строк, дальше пользователь сам решает, грузить ли ещё; вместе с лёгким select (см.
// SUPABASE-SETUP.md п.13) это и держит открытие списка быстрым независимо от того, сколько всего
// проектов накопилось.
const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 350;

// Конфиг двух списков: id элементов управления + kind. «Проекты» и «Заказы» работают одинаково.
const LISTS = {
  project: {
    kind: 'project', list: 'projectsList', empty: 'projectsEmpty', sort: 'projectsSortSelect',
    search: 'projectsSearch', range: 'projectsRange', from: 'projectsFrom', to: 'projectsTo',
    clear: 'projectsRangeClear', loadMore: 'projectsLoadMore', storageKey: 'projectsDateRange',
    emptyText: 'Сохранённых проектов пока нет.',
  },
  order: {
    kind: 'order', list: 'ordersList', empty: 'ordersEmpty', sort: 'ordersSortSelect',
    search: 'ordersSearch', range: 'ordersRange', from: 'ordersFrom', to: 'ordersTo',
    clear: 'ordersRangeClear', loadMore: 'ordersLoadMore', storageKey: 'ordersDateRange',
    emptyText: 'Заказов пока нет.',
  },
};

// Сколько строк уже подгружено — свой счётчик на каждый список, «Показать ещё» продолжает с него.
const paging = { project: 0, order: 0 };

function sortField(cfg) { return document.getElementById(cfg.sort).value; } // created|updated|title|client

function loadRange(cfg) {
  try { return JSON.parse(localStorage.getItem(cfg.storageKey)) || {}; } catch { return {}; }
}
function saveRange(cfg, from, to) {
  localStorage.setItem(cfg.storageKey, JSON.stringify({ from, to }));
}

// Запрос с текущими фильтрами (поиск/диапазон/сортировка) — БЕЗ .range(), тот добавляется на
// месте вызова (разный offset у свежей загрузки и «Показать ещё», сами фильтры одинаковые).
function buildQuery(cfg) {
  const field = sortField(cfg);
  const byDate = field === 'created' || field === 'updated';

  // Лёгкий список (сессия 37, см. SUPABASE-SETUP.md п.13) — без items (jsonb с полными 3D-
  // снапшотами каждой прорисовки, самое тяжёлое поле). item_count/thumbnail — отдельные лёгкие
  // колонки. Сам items грузится только точечно, при открытии конкретного проекта — см. ниже.
  let query = supabase
    .from('projects')
    .select('id, kind, title, client_name, client_phone, project_code, total, item_count, thumbnail, created_at, updated_at')
    .eq('user_id', auth.session.user.id)
    .eq('kind', cfg.kind);

  const q = document.getElementById(cfg.search).value.trim();
  if (q) {
    // Запятая ломает синтаксис .or() (разделитель условий), % — сам символ подстановки; оба
    // просто вырезаем, не экранируем — для строки поиска этого достаточно.
    const esc = q.replace(/[%,]/g, '');
    if (esc) query = query.or(`title.ilike.%${esc}%,client_name.ilike.%${esc}%,client_phone.ilike.%${esc}%`);
  }

  if (byDate) {
    const { from, to } = loadRange(cfg);
    const dateCol = field === 'created' ? 'created_at' : 'updated_at';
    if (from) query = query.gte(dateCol, from);
    if (to)   query = query.lte(dateCol, to + 'T23:59:59');
  }

  const sortColumn = { created: 'created_at', updated: 'updated_at', title: 'title', client: 'client_name' }[field];
  const ascending = field === 'title' || field === 'client';
  query = query.order(sortColumn, { ascending });

  return { query, byDate };
}

// Одна карточка — со своими обработчиками сразу на создании (не через querySelectorAll по всему
// списку после рендера, как было раньше): при «Показать ещё» список только ДОПОЛНЯЕТСЯ, повторная
// массовая перепривязка навесила бы вторые обработчики на уже существующие карточки.
function renderCard(p, cfg, container) {
  const created = new Date(p.created_at).toLocaleDateString('ru-RU');
  const client = [p.client_name, p.client_phone].filter(Boolean).join(', ') || 'Без клиента';
  // «Прорисовок: 0» не пишем (правило 21.07) — пусто значит нет
  const n = p.item_count ?? 0;
  const nLine = n > 0 ? `<br>Прорисовок: ${n}` : '';
  const thumb = p.thumbnail ? `<img class="order-card-thumb" src="${p.thumbnail}" alt="">` : '';
  const card = document.createElement('div');
  card.className = 'order-card';
  card.innerHTML = `
    ${thumb}
    <div class="order-card-header">
      <div class="order-card-info">
        <span class="order-card-num">${p.project_code ? `${p.project_code} · ` : ''}${created}</span>
        <span class="order-card-name">${p.title ? `<b>${p.title}</b><br>` : ''}${client}${nLine}</span>
      </div>
      <button class="order-card-remove" title="Удалить">×</button>
    </div>
    <div class="order-card-price">${fmt(p.total)}</div>
    <span class="status-pill status-${p.kind === 'order' ? 'confirmed' : 'new'}">${KIND_LABELS[p.kind]}</span>
    <button class="order-card-edit">Открыть</button>
  `;

  card.querySelector('.order-card-remove').addEventListener('click', async () => {
    const who = [p.title, p.client_name, p.project_code].filter(Boolean).join(', ') || 'без данных';
    if (!window.confirm(`Удалить ${cfg.kind === 'order' ? 'заказ' : 'проект'} (${who})? Действие необратимо.`)) return;
    await supabase.from('projects').delete().eq('id', p.id);
    card.remove(); // без полной перезагрузки списка — карточка и так уже в руках
  });

  card.querySelector('.order-card-edit').addEventListener('click', async e => {
    const btn = e.currentTarget;
    // Лёгкий список не содержит items (см. select в buildQuery) — подгружаем ПОЛНУЮ строку (со
    // снапшотами прорисовок) только теперь, когда реально открываем этот конкретный проект.
    btn.disabled = true;
    btn.textContent = 'Загрузка…';
    const { data: full, error } = await supabase.from('projects').select('*').eq('id', p.id).single();
    btn.disabled = false;
    btn.textContent = 'Открыть';
    if (error || !full) { window.alert('Не удалось загрузить проект: ' + (error?.message || '')); return; }
    openProject(full);
  });

  container.appendChild(card);
}

// append=false — свежая загрузка (сброс на первую страницу, список очищается); append=true —
// «Показать ещё» (следующая страница тем же фильтром, дописывается в конец).
async function loadPage(kindKey, append) {
  const cfg = LISTS[kindKey];
  const list = document.getElementById(cfg.list);
  const empty = document.getElementById(cfg.empty);
  const loadMoreBtn = document.getElementById(cfg.loadMore);
  if (!list) return;
  if (!auth.session) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Недоступно без входа.';
    document.getElementById(cfg.range).style.display = 'none';
    loadMoreBtn.style.display = 'none';
    return;
  }

  const field = sortField(cfg);
  const byDate = field === 'created' || field === 'updated';
  document.getElementById(cfg.range).style.display = byDate ? 'flex' : 'none';
  if (byDate) {
    const { from, to } = loadRange(cfg);
    document.getElementById(cfg.from).value = from || '';
    document.getElementById(cfg.to).value = to || '';
  }

  if (!append) { paging[kindKey] = 0; list.innerHTML = ''; }
  const offset = paging[kindKey];

  const { query } = buildQuery(cfg);
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Загрузка…';
  const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Показать ещё';

  if (error) {
    empty.style.display = 'block';
    empty.textContent = 'Ошибка загрузки: ' + error.message;
    loadMoreBtn.style.display = 'none';
    return;
  }

  const rows = data || [];
  if (!append && rows.length === 0) {
    empty.style.display = 'block';
    empty.textContent = cfg.emptyText;
    loadMoreBtn.style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  rows.forEach(p => renderCard(p, cfg, list));
  paging[kindKey] = offset + rows.length;
  // Полная страница пришла — скорее всего есть ещё; неполная (или пустая) — точно последняя.
  loadMoreBtn.style.display = rows.length === PAGE_SIZE ? '' : 'none';
}

export function renderList(kindKey) { return loadPage(kindKey, false); }
function loadMoreList(kindKey) { return loadPage(kindKey, true); }

export const renderProjects = () => renderList('project');
export const renderOrders   = () => renderList('order');

// Большое окно «Проекты» (задание, сессия 37) — вместо узкой вкладки в сайдбаре, отдельный
// модал (тот же приём, что и .choice-dialog-overlay в js/core/toast.js, только крупнее). Список
// внутри — те же элементы (#projectsList и т.д.), просто теперь в модале, а не в .tab-pane —
// renderList/bindListControls их не различают, id совпадают.
export function openProjectsModal() {
  document.getElementById('projectsModalOverlay').classList.add('visible');
  renderProjects();
}
export function closeProjectsModal() {
  document.getElementById('projectsModalOverlay').classList.remove('visible');
}

// Поиск теперь бьёт по Supabase на каждое изменение (не по локальному массиву, как раньше) —
// без задержки долбил бы запрос на каждое нажатие клавиши.
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function bindListControls(kindKey) {
  const cfg = LISTS[kindKey];
  document.getElementById(cfg.sort).addEventListener('change', () => renderList(kindKey));
  document.getElementById(cfg.search).addEventListener('input', debounce(() => renderList(kindKey), SEARCH_DEBOUNCE_MS));
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
  document.getElementById(cfg.loadMore).addEventListener('click', () => loadMoreList(kindKey));
}

export function bindProjectsControls() {
  bindListControls('project');
  bindListControls('order');
  window.addEventListener('projects-changed', () => { renderProjects(); renderOrders(); });

  const overlay = document.getElementById('projectsModalOverlay');
  document.getElementById('projectsModalClose').addEventListener('click', closeProjectsModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeProjectsModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeProjectsModal();
  });
}
