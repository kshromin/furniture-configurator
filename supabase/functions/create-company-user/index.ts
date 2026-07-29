// Edge Function: create-company-user
// Создаёт пользователя с проверкой прав вызывающего и лимита max_users. Клиентский JS не может
// создавать записи в auth.users — нужен service_role, поэтому это серверная функция. Два случая:
//   * СУПЕР-АДМИН (profiles.is_admin) создаёт пользователя в ЛЮБОЙ компании (company_id из входа),
//     может выставить is_company_admin=true (завести администратора компании);
//   * АДМИН КОМПАНИИ (profiles.is_company_admin) создаёт менеджера в СВОЕЙ компании.
// Короткий логин «ivanov» → синтетический email ivanov@<slug>.config (уникален глобально).
// Env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY Supabase инжектит сам.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Вызывающего достаём из токена явно (service_role валидирует любой JWT).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller)
    return json({ error: 'Не авторизован', debug: { callerErr: callerErr?.message, hasServiceKey: !!serviceKey } }, 401);

  // Профиль и роль вызывающего.
  const { data: callerProfile, error: profErr } = await admin
    .from('profiles').select('is_admin, is_company_admin, company_id, is_active')
    .eq('id', caller.id).single();
  if (!callerProfile || callerProfile.is_active === false)
    return json({
      error: 'Аккаунт неактивен',
      debug: { callerId: caller.id, profileFound: !!callerProfile, isActive: callerProfile?.is_active,
               profErr: profErr?.message, hasServiceKey: !!serviceKey },
    }, 403);
  const isSuper = !!callerProfile.is_admin;
  const isCompanyAdmin = !!callerProfile.is_company_admin;
  if (!isSuper && !isCompanyAdmin) return json({ error: 'Недостаточно прав' }, 403);

  // Вход.
  const { email, password, full_name, phone, company_id, is_company_admin } =
    await req.json().catch(() => ({} as Record<string, unknown>));
  if (!email || !password) return json({ error: 'Нужны логин/email и пароль' }, 400);

  // Целевая компания и роль.
  const targetCompanyId = isSuper ? company_id : callerProfile.company_id;
  const targetIsCompanyAdmin = isSuper ? !!is_company_admin : false;
  if (!targetCompanyId) return json({ error: 'Не указана компания' }, 400);

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
    is_active: true,
  }).eq('id', created.user.id);
  if (updErr)
    return json({ error: 'Пользователь создан, но профиль не заполнен: ' + updErr.message }, 500);

  return json({ success: true, user_id: created.user.id, email: finalEmail });
});
