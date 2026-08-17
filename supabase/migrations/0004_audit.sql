-- =====================================================================
-- Миграция 0004: журнал аудита на стороне БД.
--
-- BUG-009: за сессию было совершено 5 операций, а в журнале остались те же
-- 8 засеянных записей — фронтенд логирование не выполнял вовсе.
-- Теперь пишет триггер: обойти его из приложения невозможно.
-- =====================================================================

create or replace function audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile   profiles%rowtype;
  v_action    audit_action;
  v_entity_id text;
  v_changes   jsonb;
  v_desc      text;
  v_label     text;
begin
  select * into v_profile from profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    v_action := 'create';
    v_entity_id := (to_jsonb(new) ->> 'id');
    v_changes := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_entity_id := (to_jsonb(new) ->> 'id');
    -- Пишем только реально изменившиеся поля, а не всю строку.
    select jsonb_object_agg(key, jsonb_build_object('from', to_jsonb(old) -> key, 'to', value))
      into v_changes
      from jsonb_each(to_jsonb(new))
     where to_jsonb(old) -> key is distinct from value
       and key not in ('updated_date', 'created_date');
    if v_changes is null or v_changes = '{}'::jsonb then
      return coalesce(new, old);   -- пустой апдейт не засоряет журнал
    end if;
  else
    v_action := 'delete';
    v_entity_id := (to_jsonb(old) ->> 'id');
    v_changes := to_jsonb(old);
  end if;

  -- Человекочитаемое имя объекта: title / name / employee_name, иначе id.
  v_label := coalesce(
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'title'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'name'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'employee_name'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'filename'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'city'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'slug'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'key'),
    (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'code'),
    v_entity_id
  );

  v_desc := case v_action
    when 'create' then 'Создано: ' || v_label
    when 'update' then 'Изменено: ' || v_label
    else 'Удалено: ' || v_label
  end;

  insert into audit_logs (user_id, user_name, user_email, action, entity_type, entity_id, description, changes)
  values (
    v_profile.id,
    coalesce(v_profile.full_name, v_profile.email, 'Система'),
    v_profile.email,
    v_action,
    tg_table_name,
    v_entity_id,
    v_desc,
    v_changes
  );

  return coalesce(new, old);
end;
$$;

-- Вешаем аудит на все таблицы, изменения в которых имеют значение для расследований.
do $$
declare t text;
begin
  foreach t in array array[
    'employees','employee_private','profiles','departments','branches',
    'news','pages','courses','enrollments','books','book_loans',
    'goals','kpis','development_plans','leave_requests','service_requests',
    'hr_documents','onboarding_tasks','surveys','survey_sessions',
    'achievements','store_items','store_orders','wallet_transactions',
    'award_reasons','vacancies','candidates','settings','feedback'
  ] loop
    execute format('drop trigger if exists trg_%1$s_audit on %1$I', t);
    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on %1$I
       for each row execute function audit_trigger()', t);
  end loop;
end $$;

-- ------------------------------------------------------------- вход и выход

/** Фиксация входа в портал — вызывается фронтендом после успешной аутентификации. */
create or replace function log_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found then return; end if;
  update profiles set last_login = now() where id = v_profile.id;
  insert into audit_logs (user_id, user_name, user_email, action, entity_type, description)
  values (v_profile.id, coalesce(v_profile.full_name, v_profile.email), v_profile.email,
          'login', 'Auth', 'Вход в портал');
end;
$$;

create or replace function log_logout()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found then return; end if;
  insert into audit_logs (user_id, user_name, user_email, action, entity_type, description)
  values (v_profile.id, coalesce(v_profile.full_name, v_profile.email), v_profile.email,
          'logout', 'Auth', 'Выход из портала');
end;
$$;

grant execute on function log_login() to authenticated;
grant execute on function log_logout() to authenticated;

-- ------------------------------------------- автосоздание профиля при регистрации

/**
 * Каждый пользователь Supabase Auth получает строку в profiles.
 * Роль по умолчанию — employee; повышение роли делает только администратор.
 * Если email совпал с карточкой сотрудника, связь User ↔ Employee устанавливается сразу
 * (P0 из аудита: без неё KPI, цели, уведомления и отпуск не видны никому).
 */
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_employee uuid;
begin
  select id into v_employee from employees where lower(email) = lower(new.email) limit 1;

  insert into profiles (id, email, full_name, role, employee_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::app_role, 'employee'),
    v_employee
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------- уведомления по бизнес-событиям

/** BUG-027: в базе лежали уведомления, но они ни с чем не были связаны. */
create or replace function notify_leave_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  if new.status = old.status then return new; end if;
  select id into v_user from profiles where employee_id = new.employee_id;
  if v_user is null then return new; end if;

  insert into notifications (user_id, title, body, type, link)
  values (
    v_user,
    case new.status
      when 'approved' then 'Отпуск согласован'
      when 'rejected' then 'Заявка на отпуск отклонена'
      else 'Статус заявки на отпуск изменён'
    end,
    'Период ' || to_char(new.start_date, 'DD.MM.YYYY') || ' — ' || to_char(new.end_date, 'DD.MM.YYYY'),
    case new.status when 'approved' then 'success' when 'rejected' then 'warning' else 'info' end,
    '/cabinet/vacation'
  );
  return new;
end;
$$;

drop trigger if exists trg_leave_notify on leave_requests;
create trigger trg_leave_notify after update on leave_requests
  for each row execute function notify_leave_decision();

create or replace function notify_request_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  if new.status = old.status then return new; end if;
  select id into v_user from profiles where employee_id = new.employee_id;
  if v_user is null then return new; end if;
  insert into notifications (user_id, title, body, type, link)
  values (v_user, 'Изменён статус заявки', new.title, 'info', '/cabinet/requests/' || new.id);
  return new;
end;
$$;

drop trigger if exists trg_request_notify on service_requests;
create trigger trg_request_notify after update on service_requests
  for each row execute function notify_request_update();

create or replace function notify_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  if new.amount <= 0 then return new; end if;
  select id into v_user from profiles where employee_id = new.employee_id;
  if v_user is null then return new; end if;
  insert into notifications (user_id, title, body, type, link)
  values (v_user, 'Начислены баллы',
          '+' || new.amount || ' — ' || coalesce(new.reason, 'начисление'),
          'success', '/cabinet/wallet');
  return new;
end;
$$;

drop trigger if exists trg_wallet_notify on wallet_transactions;
create trigger trg_wallet_notify after insert on wallet_transactions
  for each row execute function notify_wallet_credit();
