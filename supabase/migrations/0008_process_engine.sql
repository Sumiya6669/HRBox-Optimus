-- =====================================================================
-- Миграция 0008: движок процессов, права и представления.
--
-- Вся смена статусов заявки идёт ТОЛЬКО через SECURITY DEFINER-функции:
-- прямой UPDATE на process_requests закрыт политиками. Иначе заявитель мог бы
-- перевести собственную заявку сразу в «решена» и начислить себе баллы —
-- ровно та дыра, из-за которой в старом портале «Записаться на курс»
-- мутировало общий объект курса.
-- =====================================================================

-- ------------------------------------------------- проверки доступа

/** Является ли текущий пользователь ответственным на этапе. */
create or replace function can_act_on_stage(p_stage_id uuid, p_employee_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stage process_stages%rowtype;
  v_me uuid := auth.uid();
  v_my_employee uuid := auth_employee_id();
  v_manager uuid;
begin
  if v_me is null then return false; end if;
  select * into v_stage from process_stages where id = p_stage_id;
  if not found then return false; end if;

  -- Администратор и HR могут разблокировать любую застрявшую заявку.
  if is_hr() then return true; end if;

  if v_me = any (v_stage.assignee_ids) then return true; end if;
  if v_stage.assignee_role is not null and auth_role() = v_stage.assignee_role then return true; end if;

  -- «Согласование руководителем подающего заявку»
  if v_stage.approve_by_manager and p_employee_id is not null then
    select manager_id into v_manager from employees where id = p_employee_id;
    if v_manager is not null and v_manager = v_my_employee then return true; end if;
  end if;

  return false;
end;
$$;

/** Видимость заявки: автор, ответственные, наблюдатели, HR. */
create or replace function can_view_request(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req process_requests%rowtype;
  v_me uuid := auth.uid();
begin
  if v_me is null then return false; end if;
  select * into v_req from process_requests where id = p_request_id;
  if not found then return false; end if;

  if is_hr() then return true; end if;
  if owns_employee(v_req.employee_id) then return true; end if;
  if manages_employee(v_req.employee_id) then return true; end if;

  -- Наблюдатель или ответственный на любом этапе процесса
  return exists (
    select 1 from process_stages s
     where s.process_id = v_req.process_id
       and (v_me = any (s.assignee_ids)
            or v_me = any (s.watcher_ids)
            or (s.assignee_role is not null and auth_role() = s.assignee_role)
            or (s.watcher_role is not null and auth_role() = s.watcher_role))
  );
end;
$$;

-- ------------------------------------------------------ баллы заявки

/**
 * Сколько баллов начислить по заявке.
 *
 * Стоимость лежит в вариантах ответа: {"value":"idea","label":"…","points":15}.
 * Если поля с баллами есть на нескольких этапах (например, заявитель выбирает
 * активность, а исполнитель уточняет сумму), выигрывает САМЫЙ ПОЗДНИЙ этап —
 * иначе баллы сложились бы дважды.
 */
create or replace function process_request_points(p_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select s.sort_order as stage_order,
           coalesce(sum((opt ->> 'points')::numeric), 0) as points
      from process_request_values v
      join process_fields f on f.id = v.field_id
      join process_stages s on s.id = v.stage_id
      cross join lateral jsonb_array_elements(f.options) as opt
     where v.request_id = p_request_id
       and f.type in ('select', 'multiselect')
       and (opt ->> 'points') is not null
       and (
         v.value_text = (opt ->> 'value')
         or (v.value_json is not null and v.value_json ? (opt ->> 'value'))
       )
     group by s.sort_order
  )
  select coalesce((select points from scored order by stage_order desc limit 1), 0)::int;
$$;

-- --------------------------------------------------- подача заявки

/**
 * Создание заявки. p_values — массив
 *   [{"field_id":"…","value_text":"…","value_number":1,"value_json":[…],
 *     "file_url":"…","file_path":"…"}]
 * Значения принимаются только для полей первого этапа: подделать поля
 * этапа согласования из браузера нельзя.
 */
create or replace function process_submit_request(
  p_process_id  uuid,
  p_category_id uuid default null,
  p_values      jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee   uuid := auth_employee_id();
  v_emp_name   text;
  v_process    processes%rowtype;
  v_first      process_stages%rowtype;
  v_next_stage uuid;
  v_request    uuid;
  v_item       jsonb;
  v_field      process_fields%rowtype;
  v_missing    text;
begin
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника' using errcode = '42501';
  end if;

  select * into v_process from processes where id = p_process_id and is_active;
  if not found then
    raise exception 'Процесс не найден или не опубликован' using errcode = 'P0002';
  end if;

  select * into v_first from process_stages
   where process_id = p_process_id order by sort_order limit 1;
  if not found then
    raise exception 'В процессе не настроено ни одного этапа' using errcode = '22023';
  end if;

  -- Обязательные поля первого этапа
  select string_agg(f.label, ', ') into v_missing
    from process_fields f
   where f.stage_id = v_first.id
     and f.required
     and not exists (
       select 1 from jsonb_array_elements(p_values) x
        where (x ->> 'field_id')::uuid = f.id
          and coalesce(nullif(btrim(coalesce(x ->> 'value_text', '')), ''),
                       x ->> 'value_number',
                       nullif(x ->> 'file_url', ''),
                       case when jsonb_array_length(coalesce(x -> 'value_json', '[]'::jsonb)) > 0
                            then 'x' end) is not null
     );
  if v_missing is not null then
    raise exception 'Заполните обязательные поля: %', v_missing using errcode = '23502';
  end if;

  select name into v_emp_name from employees where id = v_employee;

  -- Следующий этап после первого (маршрут «Следующий этап»)
  select r.target_stage_id into v_next_stage
    from process_routes r
   where r.stage_id = v_first.id and r.kind = 'next'
   order by r.sort_order limit 1;

  insert into process_requests (
    process_id, process_name, category_id, category_name,
    employee_id, employee_name, current_stage_id, status, due_date
  )
  select p_process_id, v_process.name, p_category_id,
         (select name from process_categories where id = p_category_id),
         v_employee, v_emp_name,
         coalesce(v_next_stage, v_first.id),
         'in_progress',
         case when s.deadline_hours is not null
              then now() + make_interval(hours => s.deadline_hours) end
    from process_stages s
   where s.id = coalesce(v_next_stage, v_first.id)
  returning id into v_request;

  -- Значения полей первого этапа
  for v_item in select * from jsonb_array_elements(p_values) loop
    select * into v_field from process_fields
     where id = (v_item ->> 'field_id')::uuid and stage_id = v_first.id;
    continue when not found;

    insert into process_request_values (
      request_id, field_id, stage_id, field_label,
      value_text, value_number, value_json, file_url, file_path
    ) values (
      v_request, v_field.id, v_first.id, v_field.label,
      nullif(btrim(coalesce(v_item ->> 'value_text', '')), ''),
      (v_item ->> 'value_number')::numeric,
      v_item -> 'value_json',
      nullif(v_item ->> 'file_url', ''),
      nullif(v_item ->> 'file_path', '')
    )
    on conflict (request_id, field_id) do update
      set value_text = excluded.value_text,
          value_number = excluded.value_number,
          value_json = excluded.value_json,
          file_url = excluded.file_url,
          file_path = excluded.file_path;
  end loop;

  insert into process_request_history (request_id, stage_id, stage_name, actor_id, actor_name, action)
  values (v_request, v_first.id, v_first.name, auth.uid(), v_emp_name, 'submitted');

  -- Если после первого этапа маршрутов нет — заявка сразу решена.
  if v_next_stage is null then
    perform process_finalize(v_request, 'resolved');
  else
    perform process_notify_stage(v_request);
  end if;

  return v_request;
end;
$$;

-- ------------------------------------------------- решение по этапу

/** Уведомляет ответственных текущего этапа, что появилась работа. */
create or replace function process_notify_stage(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   process_requests%rowtype;
  v_stage process_stages%rowtype;
  v_user  uuid;
begin
  select * into v_req from process_requests where id = p_request_id;
  if not found or v_req.current_stage_id is null then return; end if;
  select * into v_stage from process_stages where id = v_req.current_stage_id;
  if not found then return; end if;

  foreach v_user in array (v_stage.assignee_ids || v_stage.watcher_ids) loop
    insert into notifications (user_id, title, body, type, link)
    values (v_user,
            case when v_stage.type = 'approve' then 'Заявка ждёт согласования' else 'Заявка ждёт исполнения' end,
            coalesce(v_req.process_name, 'Заявка') || ' — ' || coalesce(v_req.employee_name, ''),
            'approval', '/cabinet/processes/requests/' || p_request_id);
  end loop;

  if v_stage.assignee_role is not null then
    insert into notifications (user_id, title, body, type, link)
    select p.id,
           case when v_stage.type = 'approve' then 'Заявка ждёт согласования' else 'Заявка ждёт исполнения' end,
           coalesce(v_req.process_name, 'Заявка') || ' — ' || coalesce(v_req.employee_name, ''),
           'approval', '/cabinet/processes/requests/' || p_request_id
      from profiles p
     where p.role = v_stage.assignee_role
       and not (p.id = any (v_stage.assignee_ids));
  end if;
end;
$$;

/** Закрытие заявки: начисление баллов и уведомление автора. */
create or replace function process_finalize(p_request_id uuid, p_status process_request_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    process_requests%rowtype;
  v_points int := 0;
  v_tx     uuid;
  v_user   uuid;
begin
  select * into v_req from process_requests where id = p_request_id;
  if not found then return; end if;

  if p_status = 'resolved' then
    v_points := process_request_points(p_request_id);

    if v_points > 0 then
      insert into wallet_transactions
        (employee_id, employee_name, amount, type, reason, reason_code, branch_id, department_id)
      select v_req.employee_id, v_req.employee_name, v_points, 'workflow',
             coalesce(v_req.process_name, 'Заявка')
               || case when v_req.category_name is not null then ': ' || v_req.category_name else '' end,
             'workflow_request', e.branch_id, e.department_id
        from employees e where e.id = v_req.employee_id
      returning id into v_tx;
    end if;
  end if;

  update process_requests
     set status = p_status,
         current_stage_id = null,
         points_awarded = v_points,
         transaction_id = v_tx,
         resolved_at = now()
   where id = p_request_id;

  select id into v_user from profiles where employee_id = v_req.employee_id;
  if v_user is not null then
    insert into notifications (user_id, title, body, type, link)
    values (v_user,
            case p_status
              when 'resolved' then 'Заявка одобрена'
              when 'rejected' then 'Заявка отклонена'
              else 'Заявка закрыта' end,
            coalesce(v_req.process_name, 'Заявка')
              || case when v_points > 0 then ' · начислено ' || v_points || ' баллов' else '' end,
            case p_status when 'resolved' then 'success' when 'rejected' then 'warning' else 'info' end,
            '/cabinet/processes/requests/' || p_request_id);
  end if;
end;
$$;

/**
 * Проведение заявки по маршруту.
 * p_values — значения полей текущего этапа (например, «Сколько нужно начислить»).
 */
create or replace function process_decide(
  p_request_id uuid,
  p_route_id   uuid,
  p_comment    text default null,
  p_values     jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    process_requests%rowtype;
  v_stage  process_stages%rowtype;
  v_route  process_routes%rowtype;
  v_field  process_fields%rowtype;
  v_item   jsonb;
  v_actor  text;
  v_action text;
  v_missing text;
begin
  select * into v_req from process_requests where id = p_request_id for update;
  if not found then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;
  if v_req.status <> 'in_progress' then
    raise exception 'Заявка уже закрыта' using errcode = '22023';
  end if;

  select * into v_stage from process_stages where id = v_req.current_stage_id;
  if not found then
    raise exception 'У заявки не определён текущий этап' using errcode = '22023';
  end if;

  if not can_act_on_stage(v_stage.id, v_req.employee_id) then
    raise exception 'Вы не назначены ответственным на этом этапе' using errcode = '42501';
  end if;

  select * into v_route from process_routes where id = p_route_id and stage_id = v_stage.id;
  if not found then
    raise exception 'Маршрут не найден для текущего этапа' using errcode = 'P0002';
  end if;

  if v_route.require_comment and coalesce(btrim(p_comment), '') = '' then
    raise exception 'Для этого решения нужно указать комментарий' using errcode = '23502';
  end if;

  -- Обязательные поля текущего этапа
  -- value_json обязателен к проверке: без него обязательное поле multiselect
  -- считалось бы незаполненным, даже когда варианты выбраны.
  select string_agg(f.label, ', ') into v_missing
    from process_fields f
   where f.stage_id = v_stage.id
     and f.required
     and not exists (
       select 1 from jsonb_array_elements(p_values) x
        where (x ->> 'field_id')::uuid = f.id
          and coalesce(nullif(btrim(coalesce(x ->> 'value_text', '')), ''),
                       x ->> 'value_number',
                       nullif(x ->> 'file_url', ''),
                       case when jsonb_array_length(coalesce(x -> 'value_json', '[]'::jsonb)) > 0
                            then 'x' end) is not null
     );
  if v_missing is not null and v_route.kind <> 'reject' then
    raise exception 'Заполните обязательные поля: %', v_missing using errcode = '23502';
  end if;

  for v_item in select * from jsonb_array_elements(p_values) loop
    select * into v_field from process_fields
     where id = (v_item ->> 'field_id')::uuid and stage_id = v_stage.id;
    continue when not found;

    insert into process_request_values (
      request_id, field_id, stage_id, field_label,
      value_text, value_number, value_json, file_url, file_path
    ) values (
      p_request_id, v_field.id, v_stage.id, v_field.label,
      nullif(btrim(coalesce(v_item ->> 'value_text', '')), ''),
      (v_item ->> 'value_number')::numeric,
      v_item -> 'value_json',
      nullif(v_item ->> 'file_url', ''),
      nullif(v_item ->> 'file_path', '')
    )
    on conflict (request_id, field_id) do update
      set value_text = excluded.value_text,
          value_number = excluded.value_number,
          value_json = excluded.value_json,
          file_url = excluded.file_url,
          file_path = excluded.file_path;
  end loop;

  select coalesce(full_name, email) into v_actor from profiles where id = auth.uid();
  v_action := case v_route.kind
                when 'reject' then 'rejected'
                when 'resolve' then 'executed'
                else case when v_stage.type = 'approve' then 'approved' else 'executed' end
              end;

  insert into process_request_history (request_id, stage_id, stage_name, actor_id, actor_name, action, comment)
  values (p_request_id, v_stage.id, v_stage.name, auth.uid(), v_actor, v_action, nullif(btrim(p_comment), ''));

  if v_route.kind = 'reject' then
    perform process_finalize(p_request_id, 'rejected');
    return jsonb_build_object('status', 'rejected');
  elsif v_route.kind = 'resolve' then
    perform process_finalize(p_request_id, 'resolved');
    return jsonb_build_object('status', 'resolved',
                              'points', (select points_awarded from process_requests where id = p_request_id));
  else
    update process_requests
       set current_stage_id = v_route.target_stage_id,
           due_date = (select case when s.deadline_hours is not null
                                   then now() + make_interval(hours => s.deadline_hours) end
                         from process_stages s where s.id = v_route.target_stage_id)
     where id = p_request_id;
    perform process_notify_stage(p_request_id);
    return jsonb_build_object('status', 'in_progress', 'stage_id', v_route.target_stage_id);
  end if;
end;
$$;

/** Отзыв заявки автором, пока она не закрыта. */
create or replace function process_cancel_request(p_request_id uuid, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_req process_requests%rowtype;
begin
  select * into v_req from process_requests where id = p_request_id;
  if not found then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;
  if not owns_employee(v_req.employee_id) and not is_hr() then
    raise exception 'Отозвать заявку может только её автор' using errcode = '42501';
  end if;
  if v_req.status <> 'in_progress' then
    raise exception 'Заявка уже закрыта' using errcode = '22023';
  end if;

  insert into process_request_history (request_id, stage_id, actor_id, action, comment)
  values (p_request_id, v_req.current_stage_id, auth.uid(), 'cancelled', nullif(btrim(p_comment), ''));

  update process_requests
     set status = 'cancelled', current_stage_id = null, resolved_at = now()
   where id = p_request_id;
end;
$$;

-- ------------------------------------------------------ представления

/** Заявка с этапом, признаком просрочки и «моей очереди». */
create or replace view v_process_requests with (security_invoker = true) as
select
  r.*,
  s.name as stage_name,
  s.type as stage_type,
  (r.status = 'in_progress' and r.due_date is not null and r.due_date < now()) as is_overdue,
  (r.status = 'in_progress' and r.current_stage_id is not null
     and can_act_on_stage(r.current_stage_id, r.employee_id)) as awaiting_me,
  process_request_points(r.id) as points_preview
from process_requests r
left join process_stages s on s.id = r.current_stage_id;

grant select on v_process_requests to authenticated;

-- ------------------------------------------------------------- RLS

alter table processes                enable row level security;
alter table process_categories       enable row level security;
alter table process_stages           enable row level security;
alter table process_fields           enable row level security;
alter table process_routes           enable row level security;
alter table process_requests         enable row level security;
alter table process_request_values   enable row level security;
alter table process_request_history  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['processes','process_categories','process_stages','process_fields',
                           'process_routes','process_requests','process_request_values',
                           'process_request_history'] loop
    execute format('alter table %I force row level security', t);
    execute format('revoke all on table %I from anon', t);
  end loop;
end $$;

-- Конструктор виден всем вошедшим (нужен для отрисовки формы), правит только HR.
create policy processes_read on processes
  for select using (is_authenticated() and (is_active or is_hr()));
create policy processes_write on processes for all using (is_hr()) with check (is_hr());

create policy process_categories_read on process_categories
  for select using (is_authenticated() and (is_active or is_hr()));
create policy process_categories_write on process_categories for all using (is_hr()) with check (is_hr());

create policy process_stages_read on process_stages for select using (is_authenticated());
create policy process_stages_write on process_stages for all using (is_hr()) with check (is_hr());

create policy process_fields_read on process_fields for select using (is_authenticated());
create policy process_fields_write on process_fields for all using (is_hr()) with check (is_hr());

create policy process_routes_read on process_routes for select using (is_authenticated());
create policy process_routes_write on process_routes for all using (is_hr()) with check (is_hr());

-- Заявки: читать могут участники, менять статус — только функции движка.
create policy process_requests_read on process_requests
  for select using (can_view_request(id));
create policy process_requests_admin on process_requests
  for all using (is_hr()) with check (is_hr());

create policy process_request_values_read on process_request_values
  for select using (can_view_request(request_id));
create policy process_request_values_admin on process_request_values
  for all using (is_hr()) with check (is_hr());

create policy process_request_history_read on process_request_history
  for select using (can_view_request(request_id));

-- --------------------------------------------------------- гранты

revoke all on function
  can_act_on_stage(uuid, uuid), can_view_request(uuid), process_request_points(uuid),
  process_submit_request(uuid, uuid, jsonb), process_decide(uuid, uuid, text, jsonb),
  process_cancel_request(uuid, text), process_notify_stage(uuid),
  process_finalize(uuid, process_request_status)
from public, anon, authenticated;

grant execute on function
  can_act_on_stage(uuid, uuid),
  can_view_request(uuid),
  process_request_points(uuid),
  process_submit_request(uuid, uuid, jsonb),
  process_decide(uuid, uuid, text, jsonb),
  process_cancel_request(uuid, text)
to authenticated;

-- Внутренние шаги движка из браузера недоступны.
grant execute on function process_notify_stage(uuid),
                          process_finalize(uuid, process_request_status)
to service_role;

-- Причина начисления для заявок процессов.
insert into award_reasons (code, title, category, description)
values ('workflow_request', 'Начисление по заявке', 'work', 'Автоматическое начисление по согласованной заявке процесса')
on conflict (code) do nothing;
