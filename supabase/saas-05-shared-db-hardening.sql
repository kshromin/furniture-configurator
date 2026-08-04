-- saas-05-shared-db-hardening.sql
-- Гигиена прав в ОБЩЕЙ базе: конфигуратор мебели и чат-приложение ChatConfig — части ОДНОГО продукта
-- на ОДНОМ проекте Supabase (csntzolfgjlcxrsozcqb), НАМЕРЕННО: единые учётки, привязка чатов к
-- заказам, впереди десктоп/мобилка. Разносить по проектам не надо. Задача не «изолировать апки»
-- (они интегрированы), а не дать клиенту любой апки выдать себе лишние права через общий profiles.
-- Это общая мера безопасности, полезная и без всякого чата.
--
-- ⚠️  НЕ ПРИМЕНЯТЬ ВСЛЕПУЮ. Сначала выполнить ДИАГНОСТИКУ (п.0), свериться с текущими правами,
--     применять в SQL-редакторе Supabase по согласованию с владельцем. Откат — в конце файла.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) ДИАГНОСТИКА (только чтение — ничего не меняет). Выполнить и посмотреть, что сейчас есть.
-- select schemaname, tablename, policyname, cmd, roles from pg_policies
--   where tablename in ('companies','orders','projects','profiles') order by tablename, policyname;
-- select table_name, privilege_type, grantee, is_grantable
--   from information_schema.role_table_grants
--   where table_name in ('companies','orders','projects','profiles')
--     and grantee in ('anon','authenticated') order by table_name, grantee, privilege_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) companies / orders / projects — УЖЕ под RLS и привязаны к company_id (saas-01..04).
--    Пользователь БЕЗ company_id и без прав админа в них ничего не видит и не пишет. Значит
--    чат-аккаунты (если это ОТДЕЛЬНЫЕ люди, не члены компании) уже отрезаны текущими политиками.
--    Ничего трогать не нужно — только убеждаемся, что RLS точно ВКЛЮЧЁН (идемпотентно, без FORCE:
--    force сломал бы SECURITY DEFINER-хелперы current_company_id/is_company_admin, см. saas-01).
alter table public.companies enable row level security;
alter table public.orders    enable row level security;
alter table public.projects  enable row level security;
alter table public.profiles  enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) profiles — ГЛАВНАЯ общая таблица (её читают обе апки). Закрываем ЭСКАЛАЦИЮ ПРАВ: клиент любой
--    апки не должен менять «служебные» поля профиля, которые дают доступ к конфигуратору. Их ставит
--    ТОЛЬКО Edge Function конфигуратора на service_role (saas-01: «правка юзеров — через service_role»).
--    Конфигуратор в profiles с клиента не пишет вообще — проверено. Чат-апке эти поля тоже не нужны
--    (у неё свои: full_name/phone/роль чата). Поэтому пер-колоночный REVOKE безопасен для обеих:
revoke update (company_id, is_company_admin, is_admin, is_active) on public.profiles from authenticated;
revoke update (company_id, is_company_admin, is_admin, is_active) on public.profiles from anon;
revoke insert (company_id, is_company_admin, is_admin)            on public.profiles from authenticated;
revoke insert (company_id, is_company_admin, is_admin)            on public.profiles from anon;
-- Обычные поля профиля (full_name, phone, email…) чат-апка менять по-прежнему может; служебные — нет.
-- service_role (Edge Function конфигуратора) сохраняет полный доступ — его НЕ трогаем.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) ПРОВЕРКА после применения (под ОБЫЧНЫМ пользователем, не service_role):
--    update public.profiles set company_id = gen_random_uuid() where id = auth.uid();
--    -- ожидаемо: ERROR permission denied for column company_id  (эскалация закрыта)
--    update public.profiles set full_name = 'Тест' where id = auth.uid();  -- это должно проходить

-- ─────────────────────────────────────────────────────────────────────────────
-- ОТКАТ (если что-то не так):
-- grant update (company_id, is_company_admin, is_admin, is_active) on public.profiles to authenticated;
-- grant insert (company_id, is_company_admin, is_admin)            on public.profiles to authenticated;
