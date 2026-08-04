import { supabase } from './supabaseClient.js';
import { needsProfileCompletion, openProfileModal } from './profile.js';

export const auth = { session: null, profile: null };

// Имя в чипе аккаунта: ник → ФИО → часть e-mail (ник — отображаемое имя, задание «доп. поля»).
// Вынесено, чтобы profile.js мог обновить чип после сохранения профиля.
export function refreshAccountName() {
  const acc = document.getElementById('currentAccount');
  if (!acc) return;
  const loggedIn = !!auth.session;
  acc.style.display = loggedIn ? '' : 'none';
  if (!loggedIn) return;
  const email = auth.session?.user?.email || '';
  const nameEl = document.getElementById('currentAccountName');
  if (nameEl) nameEl.textContent = auth.profile?.nick || auth.profile?.full_name || email.split('@')[0] || '—';
  acc.title = 'Аккаунт: ' + email + (auth.profile?.job_title ? ' · ' + auth.profile.job_title : '');
}

async function loadProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  auth.profile = data || null;
}

function setGates(loggedIn) {
  document.getElementById('loginOverlay').classList.toggle('visible', !loggedIn);
  document.getElementById('viewport').style.display = loggedIn ? '' : 'none';
  document.getElementById('sidebar').style.display = loggedIn ? '' : 'none';
  document.getElementById('panel').style.display = loggedIn ? '' : 'none';
  const adminBtn = document.getElementById('adminTabBtn');
  if (adminBtn) adminBtn.style.display = (loggedIn && auth.profile?.is_admin) ? '' : 'none';
  const usersBtn = document.getElementById('usersTabBtn');
  if (usersBtn) usersBtn.style.display = (loggedIn && auth.profile?.is_company_admin) ? '' : 'none';
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  if (logoutBtn) logoutBtn.style.display = loggedIn ? '' : 'none';
  // Всегда видно, в каком аккаунте сидишь (ник → ФИО → e-mail).
  refreshAccountName();
  // Индикатор процесса виден только после входа (текст обновляет order.js/updateKitBar).
  const proc = document.getElementById('processIndicator');
  if (proc) proc.style.display = loggedIn ? '' : 'none';
  // Первый вход: ник/должность не заполнены — обязательная модалка дозаполнения (не закрыть, пока
  // не заполнит). Позже правится по клику на чип аккаунта (см. profile.js).
  if (loggedIn && needsProfileCompletion()) openProfileModal(true);
}

// id пользователя, под которым сейчас инициализировано приложение. undefined = ещё не знаем.
let knownUserId;

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  auth.session = data.session;
  if (auth.session) await loadProfile(auth.session.user.id);
  knownUserId = auth.session?.user?.id ?? null;
  setGates(!!auth.session);

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    const newId = newSession?.user?.id ?? null;
    // Сменился аккаунт (вход/выход/другой пользователь) — полный сброс до стартового состояния
    // через перезагрузку: экран, 3D-модель и прорисовки обнуляются, каталог/профиль грузятся
    // заново под нового пользователя (задание 30,07). Первичное восстановление сессии (тот же id)
    // и обновление токена — не трогаем.
    if (knownUserId !== undefined && newId !== knownUserId) { location.reload(); return; }
    knownUserId = newId;
    auth.session = newSession;
    if (auth.session) await loadProfile(auth.session.user.id);
    else auth.profile = null;
    setGates(!!auth.session);
  });
}

export function bindLoginForm() {
  const emailEl = document.getElementById('loginEmail');
  const companyEl = document.getElementById('loginCompany');
  const passEl = document.getElementById('loginPassword');
  const resultEl = document.getElementById('loginResult');

  // Slug фирмы запоминается на устройстве — вводится один раз, дальше подставляется сам.
  if (companyEl) companyEl.value = localStorage.getItem('loginCompanySlug') || '';

  const submit = async () => {
    let email = emailEl.value.trim();
    const password = passEl.value;
    const slug = (companyEl?.value || '').trim().toLowerCase();
    if (!email || !password) {
      resultEl.style.color = 'red';
      resultEl.textContent = 'Введите логин и пароль';
      return;
    }
    // Полный e-mail (с «@») — как есть. Ник + фирма → ник@<slug>.config (новые аккаунты SaaS,
    // slug запоминаем). Ник без фирмы → служебный домен @config.config (аккаунты без компании).
    if (!email.includes('@')) {
      if (slug) { email += '@' + slug + '.config'; localStorage.setItem('loginCompanySlug', slug); }
      else email += '@config.config';
    }
    resultEl.style.color = '#555';
    resultEl.textContent = 'Вход...';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      resultEl.style.color = 'red';
      resultEl.textContent = 'Неверный логин или пароль';
      return;
    }
    resultEl.textContent = '';
    passEl.value = '';
  };

  document.getElementById('loginSubmit').addEventListener('click', submit);
  [emailEl, companyEl, passEl].forEach(el => el && el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
}

export async function signOut() {
  await supabase.auth.signOut();
}
