-- ============================================================================
-- SaaS ШАГ 3: «поделиться» проектом/заказом с сотрудником компании
-- Задание «поделиться 29,07». Выполнять в Supabase → SQL Editor ПОСЛЕ saas-01-schema.sql.
-- Аддитивно: колонка + две политики. Ничего не удаляет.
-- ============================================================================

-- 1) Кому владелец открыл доступ к записи (массив id пользователей).
alter table public.projects
  add column if not exists shared_with uuid[] not null default '{}';

-- 2) RLS: расшаренный пользователь ВИДИТ запись (в дополнение к «свои проекты» и company-admin/super
--    из saas-01). Владелец правит shared_with своей же update-политикой «свои проекты» — он остаётся
--    user_id записи. Редактирование расшаренной записи другим — по политикам «свои» (у него нет), т.е.
--    он её только смотрит/копирует; правка через «вернуть в проект» создаёт НОВУЮ запись у него.
drop policy if exists "projects_select_shared" on public.projects;
create policy "projects_select_shared" on public.projects
  for select using (auth.uid() = any(shared_with));

-- 3) Список команды для окна «Поделиться»: любой залогиненный видит профили СВОЕЙ компании
--    (имя/почта коллег, чтобы выбрать получателя). Раньше профили компании видел только company-admin
--    (profiles_select_company_for_admin из saas-01) — эта политика шире и включает её.
--    current_company_id — SECURITY DEFINER (без рекурсии, см. saas-01/сессия 19).
drop policy if exists "profiles_select_company" on public.profiles;
create policy "profiles_select_company" on public.profiles
  for select using (company_id = public.current_company_id(auth.uid()));

-- Проверка после применения (под НЕ-админским пользователем):
--   • свой список проектов на месте; расшаренная тебе запись появляется;
--   • select id,email,full_name from public.profiles — видно коллег своей компании, не чужих.
