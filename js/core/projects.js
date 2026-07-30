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
    manager: 'projectsManager', emptyText: 'Сохранённых проектов пока нет.',
  },
  order: {
    kind: 'order', list: 'ordersList', empty: 'ordersEmpty', sort: 'ordersSortSelect',
    search: 'ordersSearch', range: 'ordersRange', from: 'ordersFrom', to: 'ordersTo',
    clear: 'ordersRangeClear', loadMore: 'ordersLoadMore', storageKey: 'ordersDateRange',
    manager: 'ordersManager', emptyText: 'Заказов пока нет.',
  },
};

// Сколько строк уже подгружено — свой счётчик на каждый список, «Показать ещё» продолжает с него.
const paging = { project: 0, order: 0 };

// Папка заказов (задание «поделиться 29,07»): active | completed | cancelled — фильтр по projects.status.
let orderStatusFilter = 'active';

// Папка по менеджеру — только у админа компании (видит записи всех сотрудников). '' = все сотрудники.
const managerFilter = { project: '', order: '' };

// Сотрудники своей компании — для окна «Поделиться» и подписи создателя у расшаренных карточек.
// Грузятся один раз (RLS profiles_select_company из saas-02 отдаёт только свою компанию).
let team = null;
let teamById = {};
async function loadTeam() {
  if (team) return team;
  const { data } = await supabase.from('profiles').select('id, full_name, email').order('full_name');
  team = data || [];
  teamById = Object.fromEntries(team.map(u => [u.id, u]));
  return team;
}
const teamName = id => { const u = teamById[id]; return u ? (u.full_name || u.email) : 'сотрудник'; };

// Владельцы записей, ДОСТУПНЫХ текущему пользователю (свои + расшаренные мне; у админа компании —
// вся компания через RLS). distinct user_id по этому kind — из них наполняем селектор-папку.
async function loadOwners(cfg) {
  const me = auth.session.user.id;
  let q = supabase.from('projects').select('user_id').eq('kind', cfg.kind);
  if (!auth.profile?.is_company_admin) q = q.or(`user_id.eq.${me},shared_with.cs.{${me}}`);
  const { data } = await q;
  return [...new Set((data || []).map(r => r.user_id))];
}

// Селектор-папка по собственнику — теперь у ВСЕХ пользователей (задание 30,07): в списке те
// коллеги, чьи записи тебе доступны. Прячем, если владелец только один (я) — выбирать не из кого.
async function syncManagerUI(cfg) {
  const sel = document.getElementById(cfg.manager);
  if (!sel) return;
  const me = auth.session.user.id;
  const owners = await loadOwners(cfg);
  if (owners.filter(id => id !== me).length === 0) {
    sel.style.display = 'none';
    if (managerFilter[cfg.kind]) managerFilter[cfg.kind] = ''; // сбросить фильтр, если папок не стало
    return;
  }
  sel.style.display = '';
  const sorted = [...owners].sort((a, b) =>
    a === me ? -1 : b === me ? 1 : teamName(a).localeCompare(teamName(b), 'ru'));
  sel.innerHTML = '<option value="">Все</option>' +
    sorted.map(id => `<option value="${id}">${teamName(id)}${id === me ? ' (я)' : ''}</option>`).join('');
  // Прежний выбор мог исчезнуть (запись перестала быть доступной) — тогда сбрасываем на «Все».
  if (!owners.includes(managerFilter[cfg.kind])) managerFilter[cfg.kind] = '';
  sel.value = managerFilter[cfg.kind];
}

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
  const me = auth.session.user.id;
  let query = supabase
    .from('projects')
    .select('id, kind, user_id, shared_with, status, locked_by, title, client_name, client_phone, project_code, total, item_count, thumbnail, created_at, updated_at')
    .eq('kind', cfg.kind);
  // Область видимости: админ компании — вся компания (RLS company-admin); остальные — «мои +
  // расшаренные мне». Поверх — папка по собственнику (managerFilter), доступна теперь всем.
  if (!auth.profile?.is_company_admin) {
    query = query.or(`user_id.eq.${me},shared_with.cs.{${me}}`);
  }
  if (managerFilter[cfg.kind]) query = query.eq('user_id', managerFilter[cfg.kind]);
  // Заказы разложены по папкам active/completed/cancelled; проекты — без папок.
  if (cfg.kind === 'order') query = query.eq('status', orderStatusFilter);

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
  const me = auth.session.user.id;
  const mine = p.user_id === me; // чужая карточка = расшарена мне (создатель другой)
  const sharedNote = mine ? '' : `<div class="order-card-shared">поделился: ${teamName(p.user_id)}</div>`;
  const shareBadge = (mine && p.shared_with?.length) ? ` <span class="order-card-shareinfo" title="Доступ открыт">↗${p.shared_with.length}</span>` : '';
  // Кнопки папок — только у своих заказов; набор зависит от текущей папки.
  const statusBtns = (mine && p.kind === 'order') ? (
    orderStatusFilter === 'active'
      ? '<button class="order-card-status" data-status="completed">✓ Завершить</button><button class="order-card-status warn" data-status="cancelled">✕ Отмена</button>'
      : '<button class="order-card-status" data-status="active">↩ В активные</button>'
  ) : '';
  // «Изменять нельзя» — совместная блокировка заказа (задание «поделиться 29,07»): доступна всем,
  // кто видит заказ; заблокирован, пока массив locked_by не пуст. Галочка отражает МОЮ блокировку
  // (снять можно только свою, RPC); под ней — кто именно заблокировал (задание 30,07), чтобы
  // остальные знали, к кому идти за разблокировкой.
  const lockers = p.locked_by || [];
  const iLocked = lockers.includes(me);
  const lockerNames = lockers.map(id => id === me ? 'вы' : teamName(id)).join(', ');
  const lockRow = p.kind === 'order'
    ? `<label class="order-card-lock" title="${lockers.length ? 'Заблокировали: ' + lockerNames : 'Запретить изменения этого заказа'}">
         <input type="checkbox" class="order-lock-cb" ${iLocked ? 'checked' : ''}> изменять нельзя
       </label>
       ${lockers.length ? `<div class="order-card-lockers">🔒 заблокировали: ${lockerNames}</div>` : ''}`
    : '';
  card.innerHTML = `
    ${thumb}
    <div class="order-card-header">
      <div class="order-card-info">
        <span class="order-card-num">${p.project_code ? `${p.project_code} · ` : ''}${created}</span>
        <span class="order-card-name">${p.title ? `<b>${p.title}</b><br>` : ''}${client}${nLine}</span>
        ${sharedNote}
      </div>
      ${mine ? '<button class="order-card-remove" title="Удалить">×</button>' : ''}
    </div>
    <div class="order-card-price">${fmt(p.total)}</div>
    <span class="status-pill status-${p.kind === 'order' ? 'confirmed' : 'new'}">${KIND_LABELS[p.kind]}${shareBadge}</span>
    ${lockRow}
    <div class="order-card-actions">
      <button class="order-card-share">Поделиться</button>
      <button class="order-card-edit">Открыть</button>
    </div>
    ${statusBtns ? `<div class="order-card-actions">${statusBtns}</div>` : ''}
  `;

  card.querySelector('.order-card-remove')?.addEventListener('click', async () => {
    if ((p.locked_by || []).length > 0) {
      window.alert('Заказ заблокирован («изменять нельзя»). Сначала снимите блокировку.');
      return;
    }
    const who = [p.title, p.client_name, p.project_code].filter(Boolean).join(', ') || 'без данных';
    if (!window.confirm(`Удалить ${cfg.kind === 'order' ? 'заказ' : 'проект'} (${who})? Действие необратимо.`)) return;
    await supabase.from('projects').delete().eq('id', p.id);
    card.remove(); // без полной перезагрузки списка — карточка и так уже в руках
  });

  // Галочка «изменять нельзя» — ставит/снимает СВОЮ блокировку через RPC (снять чужую нельзя).
  card.querySelector('.order-lock-cb')?.addEventListener('change', async e => {
    const cb = e.currentTarget;
    const wantLock = cb.checked;
    cb.disabled = true;
    const { data, error } = await supabase.rpc('set_order_lock', { p_id: p.id, lock: wantLock });
    cb.disabled = false;
    if (error) { window.alert('Ошибка: ' + error.message); cb.checked = !wantLock; return; }
    p.locked_by = data || [];
    const me2 = auth.session.user.id;
    cb.checked = p.locked_by.includes(me2); // галочка — про МОЮ блокировку
    const names = p.locked_by.map(id => id === me2 ? 'вы' : teamName(id)).join(', ');
    const label = cb.closest('.order-card-lock');
    label?.setAttribute('title', p.locked_by.length ? 'Заблокировали: ' + names : 'Запретить изменения этого заказа');
    // Строка «кто заблокировал» под галочкой — создаём/обновляем/убираем.
    let line = label?.parentElement?.querySelector('.order-card-lockers');
    if (p.locked_by.length) {
      if (!line) { line = document.createElement('div'); line.className = 'order-card-lockers'; label.after(line); }
      line.textContent = '🔒 заблокировали: ' + names;
    } else if (line) { line.remove(); }
    // Пытались снять, но заказ ещё заблокирован другими — снять могут только они.
    if (!wantLock && p.locked_by.length) window.alert('Заказ ещё заблокирован другим сотрудником — снять может только он.');
  });

  card.querySelector('.order-card-share')?.addEventListener('click', e => openSharePopover(p, e.currentTarget));

  card.querySelectorAll('.order-card-status').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase.from('projects').update({ status: b.dataset.status }).eq('id', p.id);
    if (error) { window.alert('Ошибка: ' + error.message); b.disabled = false; return; }
    card.remove(); // запись ушла в другую папку
  }));

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

// Окно «Поделиться» (задание «поделиться 29,07») — список сотрудников компании с галочками;
// сохранение пишет projects.shared_with (владелец правит своей update-политикой). Расшаренному
// запись становится видна (RLS projects_select_shared, saas-02).
let sharePop = null;
function closeSharePopover() {
  if (!sharePop) return;
  sharePop.remove(); sharePop = null;
  document.removeEventListener('click', onDocClickShare, true);
}
function onDocClickShare(e) { if (sharePop && !sharePop.contains(e.target)) closeSharePopover(); }

function openSharePopover(p, anchorBtn) {
  closeSharePopover();
  const me = auth.session.user.id;
  const mates = (team || []).filter(u => u.id !== me);
  const shared = new Set(p.shared_with || []);
  const pop = document.createElement('div');
  pop.className = 'share-popover';
  pop.innerHTML = `
    <div class="share-pop-title">Поделиться с сотрудником</div>
    <div class="share-pop-list">${
      mates.length
        ? mates.map(u => `<label><input type="checkbox" value="${u.id}" ${shared.has(u.id) ? 'checked' : ''}> ${teamName(u.id)}</label>`).join('')
        : '<div class="share-pop-empty">В компании пока нет других сотрудников.</div>'
    }</div>
    <div class="share-pop-actions">
      <button class="share-pop-save">Сохранить</button>
      <button class="share-pop-cancel">Отмена</button>
    </div>
    <div class="share-pop-msg"></div>`;
  document.body.appendChild(pop);
  sharePop = pop;
  const r = anchorBtn.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + 'px';
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 10) + 'px';
  setTimeout(() => document.addEventListener('click', onDocClickShare, true), 0);

  pop.querySelector('.share-pop-cancel').addEventListener('click', closeSharePopover);
  pop.querySelector('.share-pop-save').addEventListener('click', async () => {
    const ids = [...pop.querySelectorAll('input:checked')].map(i => i.value);
    const msg = pop.querySelector('.share-pop-msg');
    msg.textContent = 'Сохранение…';
    const { error } = await supabase.rpc('set_project_share', { p_id: p.id, uids: ids });
    if (error) { msg.textContent = 'Ошибка: ' + error.message; return; }
    p.shared_with = ids;
    const card = anchorBtn.closest('.order-card');
    card?.querySelector('.order-card-shareinfo')?.remove();
    if (ids.length) card?.querySelector('.status-pill')
      ?.insertAdjacentHTML('beforeend', ` <span class="order-card-shareinfo" title="Доступ открыт">↗${ids.length}</span>`);
    closeSharePopover();
  });
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

  await loadTeam(); // имена коллег для карточек (создатель у расшаренных, окно «Поделиться»)
  await syncManagerUI(cfg); // селектор-папка по собственнику (у всех) — заполняет managerFilter
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
  document.getElementById(cfg.manager)?.addEventListener('change', e => {
    managerFilter[kindKey] = e.target.value; // папка по собственнику (у всех пользователей)
    renderList(kindKey);
  });
}

export function bindProjectsControls() {
  bindListControls('project');
  bindListControls('order');
  window.addEventListener('projects-changed', () => { renderProjects(); renderOrders(); });

  // Папки заказов (active/completed/cancelled) — переключают фильтр и перезагружают список.
  document.querySelectorAll('#orderFolders .order-folder-btn').forEach(b =>
    b.addEventListener('click', () => {
      orderStatusFilter = b.dataset.status;
      document.querySelectorAll('#orderFolders .order-folder-btn').forEach(x => x.classList.toggle('active', x === b));
      renderOrders();
    }));

  const overlay = document.getElementById('projectsModalOverlay');
  document.getElementById('projectsModalClose').addEventListener('click', closeProjectsModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeProjectsModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) closeProjectsModal();
  });
}
