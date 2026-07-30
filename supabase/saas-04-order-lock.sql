-- ============================================================================
-- SaaS: блокировка заказа «изменять нельзя» (задание «поделиться 29,07», ревизия)
-- Совместная блокировка: несколько пользователей могут «запереть» заказ; снять можно только СВОЮ.
-- Заказ редактируем/перезаписываем/удаляем, только пока locked_by пуст. Выполнять после saas-01.
-- ============================================================================

-- Кто поставил «изменять нельзя» (массив id). Пусто = редактировать можно.
alter table public.projects
  add column if not exists locked_by uuid[] not null default '{}';

-- RPC: поставить (lock=true) или снять (lock=false) СВОЮ блокировку. SECURITY DEFINER, но трогает
-- только auth.uid() вызывающего — чужую блокировку снять нельзя. Работает лишь с записями своей
-- компании (не даём дёргать чужие по id). Возвращает актуальный массив locked_by.
create or replace function public.set_order_lock(p_id uuid, lock boolean)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare result uuid[];
begin
  if not exists (
    select 1 from public.projects
    where id = p_id and company_id = public.current_company_id(auth.uid())
  ) then
    raise exception 'Нет доступа к записи';
  end if;

  if lock then
    update public.projects
      set locked_by = (select array(select distinct e from unnest(locked_by || auth.uid()) e))
      where id = p_id
      returning locked_by into result;
  else
    update public.projects
      set locked_by = array_remove(locked_by, auth.uid())
      where id = p_id
      returning locked_by into result;
  end if;
  return result;
end;
$$;

grant execute on function public.set_order_lock(uuid, boolean) to authenticated;
