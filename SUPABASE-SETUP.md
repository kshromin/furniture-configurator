# Настройка Supabase (бэкенд: логины + заказы)

Разовая настройка, ~10–15 минут. После неё конфигуратор сможет принимать заказы, показывать
личный кабинет и админ-панель. Хостинг фронтенда (GitHub Pages) тут ни при чём — Supabase просто
даёт базу данных + систему логинов, обращение к ней идёт прямо из браузера пользователя.

## 1. Создать проект

1. Зарегистрироваться на [supabase.com](https://supabase.com) (бесплатно) → **New project**.
2. Выбрать имя, регион (ближайший, например Frankfurt), пароль от БД — сохранить пароль куда-нибудь,
   он нужен только для прямого доступа к базе через psql, в приложении не используется.
3. Дождаться создания проекта (1–2 минуты).

## 2. Забрать ключи для сайта

**Project Settings → API**:
- **Project URL** — например `https://abcdefgh.supabase.co`
- **anon public key** — длинная строка

Это **не секреты** — anon-ключ рассчитан на то, чтобы быть в открытом клиентском коде (в том
числе в публичном репозитории на GitHub). Реальная защита данных — на стороне базы (RLS-политики
ниже): без правильной политики таблица недоступна, даже если знать URL и ключ.

Вставьте оба значения в [js/core/supabaseConfig.js](js/core/supabaseConfig.js):

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

## 3. Отключить самостоятельную регистрацию

**Authentication → Settings**:
- выключить **Allow new users to sign up** (аккаунты заводит только владелец, вручную);
- выключить **Confirm email** (иначе созданные вручную аккаунты могут повиснуть неподтверждёнными).

## 4. Выполнить схему БД

**SQL Editor → New query** — вставить и выполнить целиком:

```sql
-- profiles: 1 строка на пользователя, создаётся автоматически триггером
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$func$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_select_all_for_admin" on public.profiles
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- orders: одна запись на всю корзину при оформлении заявки
-- user_id ссылается на profiles(id), а не напрямую на auth.users(id) — так админ-панель
-- может одним select-запросом подтянуть email пользователя вместе с заказом.
create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_name text not null default '',
  contact_phone text not null default '',
  summary text not null,
  total numeric not null default 0,
  snapshot jsonb not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;

create policy "orders_insert_own" on public.orders
  for insert with check (auth.uid() = user_id);
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);
create policy "orders_select_all_admin" on public.orders
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "orders_update_status_admin" on public.orders
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- saved_configs: пользовательские сохранённые конфигурации (личный кабинет)
create table public.saved_configs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.saved_configs enable row level security;

create policy "saved_configs_insert_own" on public.saved_configs
  for insert with check (auth.uid() = user_id);
create policy "saved_configs_select_own" on public.saved_configs
  for select using (auth.uid() = user_id);
create policy "saved_configs_delete_own" on public.saved_configs
  for delete using (auth.uid() = user_id);
```

## 5. Создать пользователей вручную

**Authentication → Users → Add user → Create new user**:
- Email + пароль по своему выбору.
- Обязательно поставить галку **Auto Confirm User** (иначе аккаунт не сможет войти).
- Повторить для каждого из ~20 сотрудников/клиентов. Профиль в `profiles` появится сам — ничего
  досоздавать не нужно.

Рекомендация для старта — создать сначала два аккаунта: свой (будущий админ) и один гостевой/тестовый
для сотрудника, который будет пробовать процесс.

## 6. Назначить себя админом

**SQL Editor**, подставив свой email:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'ваш-email@пример.ру');
```

Вкладка «Админ» в интерфейсе появится только у аккаунта с `is_admin = true`.

## 7. Проверка

Открыть сайт (локально через превью или после публикации на GitHub Pages):
1. Без входа виден только экран «Вход» — конфигуратор не открывается.
2. Войти созданным аккаунтом → конфигуратор появляется, всё работает как раньше.
3. Добавить пару позиций в заказ → «Оставить заявку» → указать имя/телефон → отправить.
   В Supabase (**Table Editor → orders**) должна появиться новая строка.
4. Вкладка «Кабинет» → заявка видна в истории. «Сохранить текущую конфигурацию» → появляется
   в списке сохранённых, «Загрузить» — восстанавливает её в 3D.
5. Под админ-аккаунтом появляется вкладка «Админ» со всеми заказами всех пользователей и
   выпадающим списком статуса.
