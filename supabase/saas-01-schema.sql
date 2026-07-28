-- ============================================================================
-- SaaS-миграция, ШАГ 1: мультитенантность (companies + company_id + RLS)
-- Источник истины: SAAS-PLAN.md (на Яндекс.Диске, Config/). Выполнять вручную в
-- Supabase → SQL Editor. ПЕРЕД запуском — сделать бэкап данных (заказы существуют
-- только в Supabase). Сайт тестовый, но привычку соблюдаем.
--
-- Схема АДДИТИВНАЯ: не удаляет существующие таблицы/колонки/политики. RLS-политики
-- permissive (OR'ятся), поэтому старая изоляция «вижу свои строки» продолжает
-- работать, а поверх добавляется видимость для админа компании и супер-админа.
--
-- Уроки сессии 19 (SUPABASE-SETUP.md §9), соблюдены здесь:
--   * проверку роли делаем через SECURITY DEFINER-функции, НЕ через inline
--     `select ... from profiles` в политике — иначе рекурсия 42P17;
--   * новой таблице сразу выдаём GRANT (RLS без GRANT = permission denied 42501);
--   * после применения — проверить реальным запросом под НЕ-админским пользователем.
-- ============================================================================


-- 1) Таблица компаний ---------------------------------------------------------
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text unique not null,               -- и в синтетическом email: user@<slug>.config
  max_users    int  not null default 5,
  active_types jsonb not null default '[]'::jsonb,  -- доступные типы изделий: ["wardrobe", ...]
  materials    jsonb not null default '{}'::jsonb,  -- каталог материалов/цен компании (как data/materials.json)
  settings     jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,       -- блокировка компании (не удаление)
  created_at   timestamptz not null default now()
);

alter table public.companies enable row level security;

-- GRANT: базовое право роли authenticated работать с таблицей; какие именно СТРОКИ
-- доступны — решают RLS-политики ниже.
grant select, insert, update, delete on public.companies to authenticated;


-- 2) Расширение profiles ------------------------------------------------------
-- profiles уже существует (id, email, is_admin = супер-админ). Добавляем поля компании.
alter table public.profiles
  add column if not exists company_id       uuid references public.companies(id) on delete cascade,
  add column if not exists is_company_admin boolean not null default false,
  add column if not exists phone            text,
  add column if not exists full_name        text,
  add column if not exists is_active        boolean not null default true;  -- блокировка без удаления


-- 3) Расширение projects ------------------------------------------------------
-- projects — текущая таблица заказов/проектов (kind='order'|'project'). Добавляем company_id.
-- on delete RESTRICT: нельзя удалить компанию, пока за ней есть проекты — заказы это
-- бизнес-записи, философия «блокировать, а не удалять».
alter table public.projects
  add column if not exists company_id uuid references public.companies(id) on delete restrict;


-- 4) Функции-помощники --------------------------------------------------------
-- SECURITY DEFINER: читают profiles В ОБХОД RLS — так политики ниже не вызывают
-- рекурсию (см. уже существующую public.is_admin(uid) из сессии 19, её переиспользуем).
create or replace function public.current_company_id(uid uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select company_id from public.profiles where id = uid;
$$;

create or replace function public.is_company_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_company_admin from public.profiles where id = uid), false);
$$;


-- 5) RLS-политики (все — аддитивные) ------------------------------------------

-- companies: супер-админ — всё; обычный пользователь читает только свою компанию.
drop policy if exists "companies_all_superadmin" on public.companies;
create policy "companies_all_superadmin" on public.companies
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "companies_select_own" on public.companies;
create policy "companies_select_own" on public.companies
  for select using (id = public.current_company_id(auth.uid()));

-- profiles: админ компании видит профили СВОЕЙ компании (в дополнение к «свой профиль»
-- и «супер-админ видит все» из сессии 19). Правка/блокировка юзеров — через Edge
-- Function на service_role (шаг 2), поэтому здесь пока только select.
drop policy if exists "profiles_select_company_for_admin" on public.profiles;
create policy "profiles_select_company_for_admin" on public.profiles
  for select using (
    public.is_company_admin(auth.uid())
    and company_id = public.current_company_id(auth.uid())
  );

-- projects: супер-админ — все; админ компании — проекты своей компании (в дополнение
-- к пер-пользовательским политикам «свои проекты», которые уже есть).
drop policy if exists "projects_all_superadmin" on public.projects;
create policy "projects_all_superadmin" on public.projects
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "projects_select_company_for_admin" on public.projects;
create policy "projects_select_company_for_admin" on public.projects
  for select using (
    public.is_company_admin(auth.uid())
    and company_id = public.current_company_id(auth.uid())
  );

-- Админ компании может ПРАВИТЬ проекты своей компании (решение обсуждения 28.07 — не только
-- смотреть). using — какие строки можно менять; with check — куда нельзя «увести» строку (в чужую
-- компанию). Пер-пользовательские UPDATE-политики (менеджер правит свои) остаются как есть.
drop policy if exists "projects_update_company_for_admin" on public.projects;
create policy "projects_update_company_for_admin" on public.projects
  for update using (
    public.is_company_admin(auth.uid())
    and company_id = public.current_company_id(auth.uid())
  ) with check (
    public.is_company_admin(auth.uid())
    and company_id = public.current_company_id(auth.uid())
  );


-- 6) Бэкофилл существующих данных --------------------------------------------
-- Одна «компания по умолчанию» (владельца) на все текущие строки — ДО того, как
-- приложение начнёт опираться на company_id. Поменяй name/slug/active_types под себя.
insert into public.companies (name, slug, max_users, active_types, is_active)
values ('KHROM', 'khrom', 100, '["wardrobe"]'::jsonb, true)
on conflict (slug) do nothing;

update public.profiles
  set company_id = (select id from public.companies where slug = 'khrom')
  where company_id is null;

update public.projects
  set company_id = (select id from public.companies where slug = 'khrom')
  where company_id is null;

-- Себя сделать супер-админом (если ещё не) — раскомментируй и подставь свой email:
-- update public.profiles set is_admin = true where email = 'ТВОЙ_EMAIL';


-- 7) Проверка после применения (запусти отдельно, под НЕ-админским пользователем) --
-- Список политик на таблицах — убедиться, что старые пер-пользовательские на месте
-- и добавились новые company-политики:
--   select tablename, policyname, cmd from pg_policies
--   where tablename in ('companies','profiles','projects') order by tablename, policyname;
-- И проверить, что обычный менеджер по-прежнему видит СВОИ проекты и не видит чужие.
