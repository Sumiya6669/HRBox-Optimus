-- =====================================================================
-- Миграция 0010: защита SECURITY DEFINER-функций от вызова не тем, кем надо.
--
-- Найдено при проверке боевой базы после 0007–0009.
--
-- Суть проблемы: SECURITY DEFINER выполняет тело функции с правами владельца,
-- то есть В ОБХОД RLS. Если такая функция ещё и доступна роли authenticated,
-- то права надо проверять В ТЕЛЕ функции — грант сам по себе ничего не решает.
-- Ниже три места, где эта проверка отсутствовала.
--
-- Отдельный нюанс: у вызова из планировщика (Edge Function под service_role)
-- auth.uid() равен NULL. Поэтому условие всюду вида
--   «если пользователь есть, то он обязан иметь право»,
-- иначе фоновые задачи сломались бы вместе с закрытием дыры.
-- =====================================================================

-- ------------------------------------------------------------------- 1

/**
 * apply_achievement_rules массово выдаёт достижения и пишет начисления
 * в wallet_transactions. Функция была доступна любому вошедшему сотруднику:
 * он мог дёрнуть /rest/v1/rpc/apply_achievement_rules и запустить выдачу
 * по всем правилам раньше срока. Идемпотентность по period_key защищала
 * от задвоения, но не от преждевременного запуска.
 */
create or replace function apply_achievement_rules(p_rule_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule    achievement_rules%rowtype;
  v_emp     record;
  v_value   numeric;
  v_matches boolean;
  v_key     text;
  v_awarded int := 0;
  v_checked int := 0;
  v_rules   int := 0;
begin
  -- Запускать могут HR и администратор из админки, либо планировщик
  -- под service_role (там auth.uid() пустой).
  if auth.uid() is not null and not is_hr() then
    raise exception 'Запускать награждение может только HR или администратор'
      using errcode = '42501';
  end if;

  for v_rule in
    select * from achievement_rules
     where is_active and auto_award
       and (p_rule_id is null or id = p_rule_id)
  loop
    v_rules := v_rules + 1;
    v_key := achievement_period_key(v_rule.period);

    for v_emp in
      select e.id, e.name, e.branch_id, e.department_id
        from employees e
       where e.status <> 'dismissed'
    loop
      v_checked := v_checked + 1;
      v_value := achievement_param_value(v_emp.id, v_rule.param);
      continue when v_value is null;

      v_matches := case v_rule.operator
        when 'gt'  then v_value >  v_rule.threshold
        when 'gte' then v_value >= v_rule.threshold
        when 'lt'  then v_value <  v_rule.threshold
        when 'lte' then v_value <= v_rule.threshold
        when 'eq'  then v_value =  v_rule.threshold
      end;
      if v_rule.param = 'birthday_today' then
        v_matches := v_value = 1;
      end if;
      continue when not coalesce(v_matches, false);

      begin
        insert into achievements (
          employee_id, employee_name, title, description, type, points, date,
          auto, rule, reason_code, icon, image_url, image_path, rule_id, period_key
        ) values (
          v_emp.id, v_emp.name, v_rule.title, v_rule.description, v_rule.type,
          v_rule.points, current_date, true,
          v_rule.param::text || ' ' || v_rule.operator::text || ' ' || coalesce(v_rule.threshold::text, ''),
          v_rule.reason_code, v_rule.icon, v_rule.image_url, v_rule.image_path,
          v_rule.id, v_key
        );
      exception when unique_violation then
        continue;
      end;

      if v_rule.points > 0 then
        insert into wallet_transactions
          (employee_id, employee_name, amount, type, reason, reason_code, branch_id, department_id)
        values (v_emp.id, v_emp.name, v_rule.points, 'workflow',
                'Автоначисление: ' || v_rule.title,
                coalesce(v_rule.reason_code, 'tenure'), v_emp.branch_id, v_emp.department_id);
      end if;

      v_awarded := v_awarded + 1;
    end loop;

    update achievement_rules set last_run = now() where id = v_rule.id;
  end loop;

  return jsonb_build_object(
    'rules_processed', v_rules,
    'employees_checked', v_checked,
    'achievements_awarded', v_awarded
  );
end;
$$;

-- ------------------------------------------------------------------- 2

/**
 * achievement_param_value принимала произвольный p_employee_id и отдавала
 * по чужому сотруднику стаж, число пройденных курсов, прочитанных книг
 * и суммарный баланс баллов — мимо RLS.
 *
 * Своё значение видит сам сотрудник, чужое — руководитель и HR.
 */
create or replace function achievement_param_value(p_employee_id uuid, p_param achievement_param)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if auth.uid() is not null
     and not (is_hr() or owns_employee(p_employee_id) or manages_employee(p_employee_id)) then
    return null;
  end if;

  select * into v_emp from employees where id = p_employee_id;
  if not found then return null; end if;

  return case p_param
    when 'tenure_months' then
      case when v_emp.hire_date is null then null
           else floor(extract(epoch from age(current_date, v_emp.hire_date)) / 2629746)
      end
    when 'tenure_years' then
      case when v_emp.hire_date is null then null
           else extract(year from age(current_date, v_emp.hire_date))
      end
    when 'courses_completed' then
      (select count(*) from enrollments where employee_id = p_employee_id and status = 'completed')
    when 'books_read' then
      (select count(*) from book_loans where employee_id = p_employee_id and status = 'returned')
    when 'points_total' then
      (select coalesce(sum(amount), 0) from wallet_transactions where employee_id = p_employee_id and amount > 0)
    when 'surveys_answered' then
      (select count(*) from survey_responses where employee_id = p_employee_id)
    when 'goals_completed' then
      (select count(*) from goals where employee_id = p_employee_id and status = 'completed')
    when 'birthday_today' then
      case when v_emp.birth_date is not null
            and to_char(v_emp.birth_date, 'MM-DD') = to_char(current_date, 'MM-DD')
           then 1 else 0 end
  end;
end;
$$;

-- ------------------------------------------------------------------- 3

/**
 * process_request_points считала баллы по любому request_id без проверки,
 * имеет ли вызывающий доступ к заявке.
 */
create or replace function process_request_points(p_request_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_points int;
begin
  if auth.uid() is not null and not can_view_request(p_request_id) then
    return 0;
  end if;

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
  select coalesce((select points from scored order by stage_order desc limit 1), 0)::int
    into v_points;

  return v_points;
end;
$$;

-- ------------------------------------------------------------------- 4

-- Изменяемый search_path у функции — вектор подмены объектов; фиксируем.
alter function achievement_period_key(text) set search_path = public;

-- Гранты после пересоздания функций назначаем заново: CREATE OR REPLACE
-- сохраняет ACL, но полагаться на это не стоит.
revoke all on function
  apply_achievement_rules(uuid),
  achievement_param_value(uuid, achievement_param),
  process_request_points(uuid)
from public, anon;

grant execute on function
  achievement_param_value(uuid, achievement_param),
  process_request_points(uuid),
  apply_achievement_rules(uuid)
to authenticated;

grant execute on function apply_achievement_rules(uuid) to service_role;
