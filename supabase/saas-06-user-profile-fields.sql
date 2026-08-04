-- saas-06-user-profile-fields.sql
-- Доп. поля профиля пользователя (configuratortask1): ник (отображаемое имя) и должность.
-- Пользователь дозаполняет их сам при первом входе (обязательные), потом может менять; ФИО — нет.
-- Ник уникален В РАМКАХ КОМПАНИИ. Пишет их только Edge Function create-company-user (service_role),
-- клиент профили напрямую не пишет — как и остальные поля профиля (см. saas-01, saas-05).
--
-- Колонки NULL-able (совместимо с общей базой чата — добавление аддитивно, ничего не ломает).
-- ⚠️ Применять по согласованию (диагностика ниже), это общая живая база.

-- 1) Колонки: ник и должность, обе до 10 символов.
alter table public.profiles
  add column if not exists nick      text,
  add column if not exists job_title text;

-- Ограничение длины (10) — на всякий случай и на уровне БД (UI тоже ограничит).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_nick_len') then
    alter table public.profiles add constraint profiles_nick_len check (nick is null or char_length(nick) <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_job_title_len') then
    alter table public.profiles add constraint profiles_job_title_len check (job_title is null or char_length(job_title) <= 10);
  end if;
end $$;

-- 2) Уникальность ника В РАМКАХ КОМПАНИИ (без учёта регистра; пустые ники не считаем).
--    Частичный уникальный индекс: (company_id, lower(nick)) при nick is not null.
create unique index if not exists profiles_nick_company_uniq
  on public.profiles (company_id, lower(nick))
  where nick is not null;

-- ДИАГНОСТИКА (после применения):
-- select id, email, full_name, nick, job_title from public.profiles order by company_id, nick;
--
-- ОТКАТ:
-- drop index if exists public.profiles_nick_company_uniq;
-- alter table public.profiles drop constraint if exists profiles_nick_len;
-- alter table public.profiles drop constraint if exists profiles_job_title_len;
-- alter table public.profiles drop column if exists nick, drop column if exists job_title;
