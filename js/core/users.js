// Вкладка «Пользователи» — управление менеджерами компании (для админа компании,
// profiles.is_company_admin). Все изменения идут через Edge Function create-company-user
// (service_role), чтобы админ компании физически не мог выдать себе супер-права: список читается
// напрямую (RLS profiles_select_company_for_admin), а создание/правка/пароль/блок — только функцией.
import { supabase } from './supabaseClient.js';
import { auth } from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

let editingUserId = null;

export function openUsersModal() {
  $('usersModalOverlay').classList.add('visible');
  editingUserId = null;
  renderModal();
}
export function closeUsersModal() {
  $('usersModalOverlay').classList.remove('visible');
}

export function bindUsersControls() {
  $('usersModalClose').addEventListener('click', closeUsersModal);
  $('usersModalOverlay').addEventListener('click', e => { if (e.target === $('usersModalOverlay')) closeUsersModal(); });
}

function renderModal() {
  $('usersModalBody').innerHTML = `
    <div class="users-add">
      <div class="field-group-title">Добавить менеджера</div>
      <div class="users-form-row">
        <input id="uAddLogin" class="mini-input users-inp" placeholder="Логин (напр. ivanov)">
        <input id="uAddPass"  class="mini-input users-inp" placeholder="Пароль">
        <input id="uAddName"  class="mini-input users-inp" placeholder="ФИО (необяз.)">
        <input id="uAddPhone" class="mini-input users-inp" placeholder="Телефон (необяз.)">
        <button id="uAddBtn" class="opt-btn users-add-btn" type="button">Создать</button>
      </div>
      <div id="uAddMsg" class="users-msg"></div>
    </div>
    <div id="usersList" class="users-list"></div>`;
  $('uAddBtn').addEventListener('click', createUser);
  loadUsers();
}

// Единая обёртка вызова Edge Function с чтением текста ошибки.
async function callFn(body) {
  const { data, error } = await supabase.functions.invoke('create-company-user', { body });
  if (error) {
    let text = error.message;
    try { text = JSON.parse(await error.context.text()).error || text; } catch { /* оставляем как есть */ }
    return { ok: false, error: text };
  }
  return { ok: !!data?.success, data, error: data?.success ? null : 'Неизвестная ошибка' };
}

async function loadUsers() {
  const list = $('usersList');
  list.innerHTML = '<div class="users-msg">Загрузка...</div>';
  const { data, error } = await supabase.from('profiles')
    .select('id, email, full_name, phone, is_active, is_company_admin')
    .eq('company_id', auth.profile?.company_id).order('email');
  if (error) { list.innerHTML = `<div class="users-msg err">Ошибка: ${esc(error.message)}</div>`; return; }
  list.innerHTML = (data || []).map(u => u.id === editingUserId ? editRow(u) : viewRow(u)).join('')
    || '<div class="users-msg">Пока нет пользователей.</div>';
  bindRowActions();
}

function viewRow(u) {
  const self = u.id === auth.session?.user?.id;
  const tag = u.is_company_admin ? '<span class="user-tag">админ</span>' : '';
  const badge = u.is_active ? '<span class="badge on">активен</span>' : '<span class="badge off">заблокирован</span>';
  const blockBtn = self ? '' : (u.is_active
    ? `<button class="opt-btn" data-block="${u.id}" data-to="false">Блок</button>`
    : `<button class="opt-btn" data-block="${u.id}" data-to="true">Разблок</button>`);
  return `<div class="user-row">
    <div class="user-main">
      <div class="user-name">${esc(u.full_name || '—')} ${tag}</div>
      <div class="user-sub">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div>
    </div>
    <div class="user-status">${badge}</div>
    <div class="user-actions">
      <button class="opt-btn" data-edit="${u.id}">Изменить</button>${blockBtn}
    </div>
  </div>`;
}

function editRow(u) {
  return `<div class="user-row user-row-edit">
    <div class="users-form-row">
      <input id="eName" class="mini-input users-inp" value="${esc(u.full_name || '')}" placeholder="ФИО">
      <input id="ePhone" class="mini-input users-inp" value="${esc(u.phone || '')}" placeholder="Телефон">
      <input id="ePass" class="mini-input users-inp" placeholder="Новый пароль (если менять)">
      <button class="opt-btn users-add-btn" data-save="${u.id}" type="button">Сохранить</button>
      <button class="opt-btn" data-cancel="1" type="button">Отмена</button>
    </div>
    <div class="user-sub" style="margin-top:4px">${esc(u.email)}</div>
    <div id="eMsg" class="users-msg"></div>
  </div>`;
}

function bindRowActions() {
  document.querySelectorAll('#usersList [data-edit]').forEach(b =>
    b.addEventListener('click', () => { editingUserId = b.dataset.edit; loadUsers(); }));
  document.querySelectorAll('#usersList [data-cancel]').forEach(b =>
    b.addEventListener('click', () => { editingUserId = null; loadUsers(); }));
  document.querySelectorAll('#usersList [data-save]').forEach(b =>
    b.addEventListener('click', () => saveUser(b.dataset.save, b)));
  document.querySelectorAll('#usersList [data-block]').forEach(b =>
    b.addEventListener('click', () => blockUser(b.dataset.block, b.dataset.to === 'true', b)));
}

async function createUser() {
  const msg = $('uAddMsg');
  const email = $('uAddLogin').value.trim();
  const password = $('uAddPass').value;
  if (!email || !password) { msg.className = 'users-msg err'; msg.textContent = 'Нужны логин и пароль'; return; }
  $('uAddBtn').disabled = true; msg.className = 'users-msg'; msg.textContent = 'Создаём...';
  const r = await callFn({ email, password, full_name: $('uAddName').value.trim(), phone: $('uAddPhone').value.trim() });
  $('uAddBtn').disabled = false;
  if (!r.ok) { msg.className = 'users-msg err'; msg.textContent = r.error; return; }
  msg.className = 'users-msg ok'; msg.textContent = 'Создан: ' + (r.data.email || '');
  ['uAddLogin', 'uAddPass', 'uAddName', 'uAddPhone'].forEach(id => $(id).value = '');
  loadUsers();
}

async function saveUser(id, btn) {
  const msg = $('eMsg');
  btn.disabled = true; msg.className = 'users-msg'; msg.textContent = 'Сохраняем...';
  const body = { user_id: id, full_name: $('eName').value.trim(), phone: $('ePhone').value.trim() };
  if ($('ePass').value) body.password = $('ePass').value;
  const r = await callFn(body);
  if (!r.ok) { msg.className = 'users-msg err'; msg.textContent = r.error; btn.disabled = false; return; }
  editingUserId = null; loadUsers();
}

async function blockUser(id, to, btn) {
  btn.disabled = true;
  const r = await callFn({ user_id: id, is_active: to });
  if (!r.ok) { alert('Ошибка: ' + r.error); btn.disabled = false; return; }
  loadUsers();
}
