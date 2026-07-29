import { supabase } from './supabaseClient.js';

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
  const usersBtn = document.getElementById('usersTabBtn');
  if (usersBtn) usersBtn.style.display = (loggedIn && auth.profile?.is_company_admin) ? '' : 'none';
}

export async function initAuth() {
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
