// Edge Function: create-company-user
// Управление пользователями компаний (service_role — клиент не может писать в auth.users).
// Две операции по телу запроса:
//   • есть user_id  → ПРАВКА пользователя (full_name/phone/is_active/пароль; is_company_admin —
//     только супер-админ);
//   • нет user_id   → СОЗДАНИЕ пользователя.
// Права вызывающего:
//   • СУПЕР-АДМИН (profiles.is_admin) — любые компании/пользователи;
//   • АДМИН КОМПАНИИ (profiles.is_company_admin) — только своя компания, создаёт менеджеров
//     (is_company_admin=false).
// Короткий логин «ivanov» → синтетический email ivanov@<slug>.config (уникален глобально).
// Env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY инжектит Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Вызывающий (валидируем токен через service_role).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller) return json({ error: 'Не авторизован' }, 401);

  const { data: callerProfile } = await admin
    .from('profiles').select('is_admin, is_company_admin, company_id, is_active').eq('id', caller.id).single();
  if (!callerProfile || callerProfile.is_active === false) return json({ error: 'Аккаунт неактивен' }, 403);
  const isSuper = !!callerProfile.is_admin;
  const isCompanyAdmin = !!callerProfile.is_company_admin;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  // Само-правка: любой пользователь может дозаполнить/изменить СВОЙ профиль (ник/должность/ФИО/телефон)
  // — задание «доп. поля пользователя». Служебные поля (is_active/is_company_admin) при этом недоступны.
  const isSelfEdit = !!body.user_id && String(body.user_id) === caller.id;
  if (!isSuper && !isCompanyAdmin && !isSelfEdit) return json({ error: 'Недостаточно прав' }, 403);

  // Валидация и проверка уникальности ника в рамках компании (без учёта регистра, исключая себя).
  const validateNick = async (raw: unknown, companyId: string | null, selfId: string) => {
    const nick = String(raw ?? '').trim();
    if (nick.length > 10) return { error: 'Ник — максимум 10 символов' };
    if (nick && companyId) {
      let q = admin.from('profiles').select('id').eq('company_id', companyId).ilike('nick', nick).limit(1);
      if (selfId) q = q.neq('id', selfId);
      const { data: dupe } = await q;
      if (dupe && dupe.length) return { error: 'Такой ник в компании уже занят' };
    }
    return { value: nick || null };
  };

  // ── ПРАВКА существующего пользователя ─────────────────────────────────────
  if (body.user_id) {
    const { data: target } = await admin
      .from('profiles').select('company_id').eq('id', body.user_id).single();
    if (!target) return json({ error: 'Пользователь не найден' }, 404);
    const canManage = isSuper || (isCompanyAdmin && target.company_id === callerProfile.company_id);
    if (!canManage && !isSelfEdit)
      return json({ error: 'Можно править только пользователей своей компании' }, 403);

    const patch: Record<string, unknown> = {};
    if (body.full_name !== undefined) patch.full_name = body.full_name || null;
    if (body.phone !== undefined) patch.phone = body.phone || null;
    if (body.nick !== undefined) {
      const r = await validateNick(body.nick, target.company_id, String(body.user_id));
      if (r.error) return json({ error: r.error }, 409);
      patch.nick = r.value;
    }
    if (body.job_title !== undefined) {
      const jt = String(body.job_title ?? '').trim();
      if (jt.length > 10) return json({ error: 'Должность — максимум 10 символов' }, 400);
      patch.job_title = jt || null;
    }
    // Служебные поля — только управляющим (при само-правке недоступны).
    if (canManage && body.is_active !== undefined) patch.is_active = !!body.is_active;
    if (isSuper && body.is_company_admin !== undefined) patch.is_company_admin = !!body.is_company_admin;
    if (Object.keys(patch).length) {
      const { error: uErr } = await admin.from('profiles').update(patch).eq('id', body.user_id);
      if (uErr) {
        const dup = /duplicate key|profiles_nick_company_uniq|23505/i.test(uErr.message);
        return json({ error: dup ? 'Такой ник в компании уже занят' : 'Не удалось обновить профиль: ' + uErr.message }, dup ? 409 : 500);
      }
    }
    // Пароль: управляющий — любому своему пользователю; сам пользователь — себе.
    if (body.password && (canManage || isSelfEdit)) {
      const { error: pErr } = await admin.auth.admin.updateUserById(String(body.user_id), { password: String(body.password) });
      if (pErr) return json({ error: 'Не удалось сменить пароль: ' + pErr.message }, 400);
    }
    return json({ success: true, user_id: body.user_id, updated: true });
  }

  // ── СОЗДАНИЕ пользователя ─────────────────────────────────────────────────
  const { email, password, full_name, phone, nick, job_title, company_id, is_company_admin } = body;
  if (!email || !password) return json({ error: 'Нужны логин/email и пароль' }, 400);

  const targetCompanyId = isSuper ? company_id : callerProfile.company_id;
  const targetIsCompanyAdmin = isSuper ? !!is_company_admin : false;
  if (!targetCompanyId) return json({ error: 'Не указана компания' }, 400);

  // Ник/должность (необязательны при создании — пользователь дозаполнит сам при первом входе).
  const nickChk = nick !== undefined ? await validateNick(nick, String(targetCompanyId), '') : { value: null };
  if (nickChk.error) return json({ error: nickChk.error }, 409);
  const newJobTitle = String(job_title ?? '').trim();
  if (newJobTitle.length > 10) return json({ error: 'Должность — максимум 10 символов' }, 400);

  const { data: company } = await admin
    .from('companies').select('slug, max_users, is_active').eq('id', targetCompanyId).single();
  if (!company) return json({ error: 'Компания не найдена' }, 404);
  if (company.is_active === false) return json({ error: 'Компания заблокирована' }, 403);

  const { count } = await admin
    .from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', targetCompanyId);
  if ((count ?? 0) >= company.max_users)
    return json({ error: `Лимит пользователей компании исчерпан (${company.max_users})` }, 409);

  const finalEmail = String(email).includes('@') ? String(email) : `${email}@${company.slug}.config`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: finalEmail, password: String(password), email_confirm: true,
  });
  if (createErr || !created?.user)
    return json({ error: 'Не удалось создать пользователя: ' + (createErr?.message ?? '') }, 400);

  const { error: updErr } = await admin.from('profiles').update({
    company_id: targetCompanyId,
    is_company_admin: targetIsCompanyAdmin,
    full_name: full_name ?? null,
    phone: phone ?? null,
    nick: nickChk.value,
    job_title: newJobTitle || null,
    is_active: true,
  }).eq('id', created.user.id);
  if (updErr)
    return json({ error: 'Пользователь создан, но профиль не заполнен: ' + updErr.message }, 500);

  return json({ success: true, user_id: created.user.id, email: finalEmail });
});
