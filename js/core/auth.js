import { supabase } from './supabaseClient.js';

// На localhost/127.0.0.1 (локальная разработка) экран входа не требуется — это удобство для
// работы над самим конфигуратором без поднятого Supabase. Функции, которым нужен реальный
// аккаунт (заказ, кабинет, админка), при этом остаются недоступны локально — см. проверки auth.session
// в order.js/cabinet.js/admin.js. На опубликованном сайте (GitHub Pages, другой hostname) гейт работает как обычно.
export const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);

export const auth = { session: null, profile: null };

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
}

export async function initAuth() {
  if (isLocalDev) { setGates(true); return; }

  const { data } = await supabase.auth.getSession();
  auth.session = data.session;
  if (auth.session) await loadProfile(auth.session.user.id);
  setGates(!!auth.session);

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    auth.session = newSession;
    if (auth.session) await loadProfile(auth.session.user.id);
    else auth.profile = null;
    setGates(!!auth.session);
  });
}

export function bindLoginForm() {
  const emailEl = document.getElementById('loginEmail');
  const passEl = document.getElementById('loginPassword');
  const resultEl = document.getElementById('loginResult');

  const submit = async () => {
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      resultEl.style.color = 'red';
      resultEl.textContent = 'Введите email и пароль';
      return;
    }
    resultEl.style.color = '#555';
    resultEl.textContent = 'Вход...';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      resultEl.style.color = 'red';
      resultEl.textContent = 'Неверный email или пароль';
      return;
    }
    resultEl.textContent = '';
    passEl.value = '';
  };

  document.getElementById('loginSubmit').addEventListener('click', submit);
  [emailEl, passEl].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
}

export async function signOut() {
  await supabase.auth.signOut();
}
