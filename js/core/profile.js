// Профиль пользователя (configuratortask1): ник + должность.
// Пользователь дозаполняет ник/должность (обязательные) при ПЕРВОМ входе — модалка не закрывается,
// пока не заполнит; позже может изменить их и ФИО. Пишется через ту же Edge Function
// create-company-user (self-edit: user_id = свой) — клиент профили напрямую не пишет.
import { supabase } from './supabaseClient.js';
import { auth, refreshAccountName } from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Профиль не заполнен, если нет ника или должности (обязательные поля).
export function needsProfileCompletion() {
  const p = auth.profile;
  return !!auth.session && (!p?.nick || !p?.job_title);
}

let mandatoryMode = false;

export function openProfileModal(mandatory = false) {
  mandatoryMode = mandatory;
  const p = auth.profile || {};
  $('profileModalTitle').textContent = mandatory ? 'Заполните профиль' : 'Мой профиль';
  // Крестик закрытия прячем в обязательном режиме (первый вход — заполнить нельзя пропустить).
  $('profileModalClose').style.display = mandatory ? 'none' : '';
  $('profileModalBody').innerHTML = `
    ${mandatory ? '<div class="users-msg">Ник и должность обязательны — заполните, чтобы продолжить.</div>' : ''}
    <div class="users-form-row" style="flex-direction:column;align-items:stretch;gap:10px">
      <label>Ник (отображаемое имя, до 10)
        <input id="pNick" class="mini-input users-inp" maxlength="10" value="${esc(p.nick || '')}" placeholder="напр. Иван" autocomplete="off"></label>
      <label>Должность (до 10)
        <input id="pJob" class="mini-input users-inp" maxlength="10" value="${esc(p.job_title || '')}" placeholder="напр. Менеджер" autocomplete="off"></label>
      <label>ФИО (необязательно)
        <input id="pName" class="mini-input users-inp" value="${esc(p.full_name || '')}" placeholder="Фамилия Имя Отчество" autocomplete="off"></label>
    </div>
    <div class="users-form-row" style="margin-top:12px">
      <button id="pSave" class="opt-btn users-add-btn" type="button">Сохранить</button>
      ${mandatory ? '' : '<button id="pCancel" class="opt-btn" type="button">Отмена</button>'}
    </div>
    <div id="pMsg" class="users-msg"></div>`;
  $('profileModalOverlay').classList.add('visible');
  $('pSave').addEventListener('click', saveProfile);
  if ($('pCancel')) $('pCancel').addEventListener('click', closeProfileModal);
}

export function closeProfileModal() {
  if (mandatoryMode && needsProfileCompletion()) return; // в обязательном режиме без заполнения не закрываем
  $('profileModalOverlay').classList.remove('visible');
}

export function bindProfileControls() {
  $('profileModalClose').addEventListener('click', closeProfileModal);
  $('profileModalOverlay').addEventListener('click', e => { if (e.target === $('profileModalOverlay')) closeProfileModal(); });
  // Клик по чипу аккаунта — открыть/править профиль (не в обязательном режиме).
  const chip = $('currentAccount');
  if (chip) { chip.style.cursor = 'pointer'; chip.addEventListener('click', () => openProfileModal(false)); }
}

async function saveProfile() {
  const msg = $('pMsg');
  const nick = $('pNick').value.trim();
  const job_title = $('pJob').value.trim();
  const full_name = $('pName').value.trim();
  if (!nick || !job_title) { msg.className = 'users-msg err'; msg.textContent = 'Ник и должность обязательны'; return; }
  const btn = $('pSave'); btn.disabled = true;
  msg.className = 'users-msg'; msg.textContent = 'Сохраняем...';
  const { data, error } = await supabase.functions.invoke('create-company-user', {
    body: { user_id: auth.session.user.id, nick, job_title, full_name },
  });
  btn.disabled = false;
  let errText = null;
  if (error) { try { errText = JSON.parse(await error.context.text()).error; } catch { errText = error.message; } }
  else if (!data?.success) errText = 'Не удалось сохранить';
  if (errText) { msg.className = 'users-msg err'; msg.textContent = errText; return; }
  // Перечитать профиль, обновить чип аккаунта, закрыть.
  const { data: fresh } = await supabase.from('profiles').select('*').eq('id', auth.session.user.id).single();
  if (fresh) auth.profile = fresh;
  refreshAccountName();
  mandatoryMode = false;
  closeProfileModal();
}
