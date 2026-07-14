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
3. Добавить пару позиций в проект → «Сохранить проект» → указать имя/телефон/адрес → сохранить.
   В Supabase (**Table Editor → drawings**) должна появиться новая строка на каждую позицию.
4. Вкладка «Кабинет» → «Мои проекты» — прорисовки видны, сортировка по дате/клиенту работает,
   «Открыть» подгружает прорисовку обратно в 3D, повторное «Сохранить проект» обновляет ту же
   строку (не создаёт новую). «Сохранить текущую конфигурацию» → появляется в списке сохранённых,
   «Загрузить» — восстанавливает её в 3D.
5. Под админ-аккаунтом появляется вкладка «Админ» со всеми заказами всех пользователей и
   выпадающим списком статуса.

## 8. Обновление схемы: таблица прорисовок с данными клиента (сессия 19)

Раздел «Проект» (бывший «Заказ») теперь сохраняет каждую прорисовку отдельной строкой сразу на
сервер, с привязанными данными клиента — вместо одной заявки со снапшотом-массивом. Список
«прорисовок» плоский (принадлежит менеджеру), формальной группировки в «проект» как отдельной
таблицы нет — прорисовки одного клиента просто имеют одинаковые `client_*` поля, сортировка по
клиенту в личном кабинете использует именно их. Раздел «Заказы» (когда прошла оплата, со своими
статусами) — отдельная, более поздняя задача, эта схема её пока не трогает; `orders` и
`saved_configs` остаются как есть.

**SQL Editor → New query**:

```sql
create table public.drawings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_name text not null default '',
  client_phone text not null default '',
  client_address text not null default '',
  summary text not null,
  total numeric not null default 0,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.drawings enable row level security;

create policy "drawings_insert_own" on public.drawings
  for insert with check (auth.uid() = user_id);
create policy "drawings_select_own" on public.drawings
  for select using (auth.uid() = user_id);
create policy "drawings_update_own" on public.drawings
  for update using (auth.uid() = user_id);
create policy "drawings_delete_own" on public.drawings
  for delete using (auth.uid() = user_id);
```

## 9. Фикс: рекурсия в RLS `profiles` + отсутствующие GRANT (сессия 19)

Обнаружено при первом реальном тесте логина+кабинета (до этого localhost был на обходном
гейте — см. `js/core/auth.js`, обход снят в этой же сессии). Два независимых системных бага,
затрагивающих ВСЕ четыре таблицы, не только `drawings`:

1. **Бесконечная рекурсия** — политика `profiles_select_all_for_admin` сама делает `select` из
   `profiles`, чтобы проверить `is_admin`; Postgres должен заново проверить RLS-политики `profiles`
   для этого внутреннего select'а — включая ту же самую политику — бесконечный цикл
   (`42P17: infinite recursion detected in policy`). Ломало загрузку профиля при входе и любой
   select из `orders` (там похожая admin-политика, тоже обращающаяся к `profiles`).
2. **Не хватало GRANT** — RLS-политики определяют, какие СТРОКИ доступны, но это отдельно от
   базового права роли `authenticated` вообще делать `select`/`insert`/... с таблицей — в Postgres
   это два разных уровня. При создании таблиц через SQL Editor эти права не выдаются
   автоматически. Ловилось как `42501: permission denied for table ...`.

**Правило на будущее** (для любых новых таблиц): каждую новую таблицу с RLS — сразу проверять
реальным запросом под настоящим (не админским) залогиненным пользователем, не полагаться на
`Success. No rows returned` от `create table`/`create policy` — она ничего не говорит про GRANT
или про рекурсию в политиках. И: если политика для проверки `is_admin` (или похожая
самоссылающаяся проверка) снова понадобится на новой таблице — сразу использовать
`public.is_admin(auth.uid())` (функция ниже), не писать `exists (select ... from profiles ...)`
прямо в политике.

**SQL Editor → New query**:

```sql
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

drop policy if exists "profiles_select_all_for_admin" on public.profiles;
create policy "profiles_select_all_for_admin" on public.profiles
  for select using (public.is_admin(auth.uid()));

drop policy if exists "orders_select_all_admin" on public.orders;
create policy "orders_select_all_admin" on public.orders
  for select using (public.is_admin(auth.uid()));

drop policy if exists "orders_update_status_admin" on public.orders;
create policy "orders_update_status_admin" on public.orders
  for update using (public.is_admin(auth.uid()));

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert, delete on public.saved_configs to authenticated;
grant select, insert, update, delete on public.drawings to authenticated;
```

Проверено реальным тестовым аккаунтом после фикса: вход, `profiles`/`orders`/`saved_configs`
select, полный цикл `drawings` (сохранить через UI → появляется в «Мои проекты» → «Открыть» →
повторное сохранение обновляет ту же строку, не плодит дубли → удаление кнопкой «×») — всё
отработало без ошибок.

## 10. Уникальный номер проекта с кодом создателя (сессия 22)

Каждой прорисовке при сохранении присваивается человекочитаемый код `№ {N}-{n}`:
`N` — постоянный номер сотрудника-создателя, `n` — порядковый номер проекта у этого
сотрудника. Код создаётся триггером в базе один раз и НИКОГДА не меняется — даже если
проект потом передадут другому пользователю (передача — отдельная будущая фича; `user_id`
сменится, а `project_code` сохранит информацию о создателе).

Заодно `drawings.snapshot` становится nullable — услуги/доп. элементы (вкладка «Добавить
к заказу») сохраняются без 3D-прорисовки.

Выполнить в **SQL Editor**:

```sql
-- Номер сотрудника (автоназначение всем существующим и новым)
alter table public.profiles
  add column if not exists manager_no int generated always as identity;

-- Персональный счётчик проектов сотрудника
alter table public.profiles
  add column if not exists next_project_no int not null default 1;

-- Код проекта
alter table public.drawings
  add column if not exists project_code text;

-- Услуги без прорисовки
alter table public.drawings alter column snapshot drop not null;

-- Триггер: при вставке прорисовки берём номер сотрудника и его счётчик,
-- счётчик атомарно увеличиваем (update ... returning защищает от гонок).
create or replace function public.assign_project_code()
returns trigger
language plpgsql
security definer
as $$
declare
  mgr_no int;
  proj_no int;
begin
  update public.profiles
     set next_project_no = next_project_no + 1
   where id = new.user_id
   returning manager_no, next_project_no - 1 into mgr_no, proj_no;
  new.project_code := mgr_no || '-' || proj_no;
  return new;
end;
$$;

drop trigger if exists drawings_assign_code on public.drawings;
create trigger drawings_assign_code
  before insert on public.drawings
  for each row execute function public.assign_project_code();
```

Старые прорисовки остаются без кода (`project_code is null`) — в UI у них показывается
дата, как раньше. Функция `security definer` — триггер обновляет чужую для RLS строку
`profiles` (свою же, но политика допускает только select/update своих полей — определитель
гарантирует право на update счётчика).
