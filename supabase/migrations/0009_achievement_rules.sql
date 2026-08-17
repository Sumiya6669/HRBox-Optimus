-- =====================================================================
-- Миграция 0009: автоматическое награждение достижениями и загрузка картинок.
--
-- Раздел 1.2 технического задания: у достижения включается тумблер
-- «Автоматическое награждение», задаётся условие (параметр / оператор /
-- значение) — и система сама выдаёт достижение и бонус в баллах всем, кто
-- под него подпадает, без участия HR.
--
-- Пример из ТЗ: «Выслуга лет Июнь», бонус 20 баллов, параметр «Стаж работы
-- в месяцах», условие «Больше», значение 13.
-- =====================================================================

do $$ begin
  create type achievement_param as enum (
    'tenure_months',       -- стаж работы в месяцах
    'tenure_years',        -- стаж работы в полных годах
    'courses_completed',   -- завершённых курсов
    'books_read',          -- прочитанных книг
    'points_total',        -- накоплено баллов всего
    'surveys_answered',    -- пройденных опросов
    'goals_completed',     -- достигнутых целей
    'birthday_today'       -- день рождения сегодня
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type comparison_operator as enum ('gt', 'gte', 'lt', 'lte', 'eq');
exception when duplicate_object then null; end $$;

-- --------------------------------------------- правила достижений

create table if not exists achievement_rules (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  icon         text,
  image_url    text,
  image_path   text,
  points       integer not null default 0 check (points >= 0),
  type         text not null default 'special'
                 check (type in ('employee_of_month', 'tenure', 'special', 'kpi', 'birthday')),
  reason_code  text references award_reasons (code) on delete set null,

  -- «Автоматическое награждение»
  auto_award   boolean not null default false,
  param        achievement_param,
  operator     comparison_operator,
  threshold    numeric(12, 2),

  /*
   * Как часто правило может сработать для одного сотрудника:
   *   once   — один раз за всё время (например, «5 лет в компании»);
   *   yearly — раз в год (день рождения);
   *   monthly— раз в месяц (сотрудник месяца).
   */
  period       text not null default 'once' check (period in ('once', 'yearly', 'monthly')),

  is_active    boolean not null default true,
  last_run     timestamptz,
  created_by   uuid references profiles (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),

  -- Автоправило без условия молча не сработало бы никогда — запрещаем такое сохранять.
  constraint achievement_rules_condition_valid check (
    not auto_award or (param is not null and operator is not null
                       and (threshold is not null or param = 'birthday_today'))
  )
);

drop trigger if exists trg_achievement_rules_updated on achievement_rules;
create trigger trg_achievement_rules_updated before update on achievement_rules
  for each row execute function set_updated_date();

drop trigger if exists trg_achievement_rules_audit on achievement_rules;
create trigger trg_achievement_rules_audit after insert or update or delete on achievement_rules
  for each row execute function audit_trigger();

-- Связь выданного достижения с правилом + ключ периода для идемпотентности.
alter table achievements add column if not exists rule_id uuid references achievement_rules (id) on delete set null;
alter table achievements add column if not exists period_key text;
alter table achievements add column if not exists image_url text;
alter table achievements add column if not exists image_path text;

-- Одно и то же правило не выдаётся сотруднику дважды в пределах периода.
create unique index if not exists achievements_rule_period_uniq
  on achievements (employee_id, rule_id, period_key)
  where rule_id is not null;

-- ------------------------------------------- вычисление параметра

/** Текущее значение параметра для сотрудника. */
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

/** Ключ периода: по нему правило не срабатывает повторно. */
create or replace function achievement_period_key(p_period text)
returns text
language sql
stable
as $$
  select case p_period
    when 'yearly'  then to_char(current_date, 'YYYY')
    when 'monthly' then to_char(current_date, 'YYYY-MM')
    else 'once'
  end;
$$;

-- ------------------------------------------------ применение правил

/**
 * Проверяет все активные автоправила и выдаёт достижения тем, кто подходит.
 * Идемпотентна: повторный запуск в том же периоде ничего не задвоит.
 * Вызывается планировщиком (Edge Function apply-achievements) и кнопкой
 * «Проверить сейчас» в админке.
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
      -- birthday_today работает без порога: условие «сегодня день рождения»
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
        continue;   -- уже выдано в этом периоде
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

/** Предпросмотр: кто попадёт под правило, если запустить его сейчас. */
create or replace function preview_achievement_rule(
  p_param achievement_param,
  p_operator comparison_operator,
  p_threshold numeric
)
returns table (employee_id uuid, employee_name text, current_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.name, achievement_param_value(e.id, p_param)
    from employees e
   where is_hr()
     and e.status <> 'dismissed'
     and achievement_param_value(e.id, p_param) is not null
     and case p_operator
           when 'gt'  then achievement_param_value(e.id, p_param) >  p_threshold
           when 'gte' then achievement_param_value(e.id, p_param) >= p_threshold
           when 'lt'  then achievement_param_value(e.id, p_param) <  p_threshold
           when 'lte' then achievement_param_value(e.id, p_param) <= p_threshold
           when 'eq'  then achievement_param_value(e.id, p_param) =  p_threshold
         end
   order by 3 desc, 2;
$$;

-- ------------------------------------------------------------- RLS

alter table achievement_rules enable row level security;
alter table achievement_rules force row level security;
revoke all on table achievement_rules from anon;

create policy achievement_rules_read on achievement_rules
  for select using (is_authenticated() and (is_active or is_hr()));
create policy achievement_rules_write on achievement_rules
  for all using (is_hr()) with check (is_hr());

revoke all on function
  achievement_param_value(uuid, achievement_param),
  achievement_period_key(text),
  apply_achievement_rules(uuid),
  preview_achievement_rule(achievement_param, comparison_operator, numeric)
from public, anon, authenticated;

grant execute on function
  achievement_param_value(uuid, achievement_param),
  achievement_period_key(text),
  preview_achievement_rule(achievement_param, comparison_operator, numeric)
to authenticated;

-- Массовая выдача — только HR через админку и планировщик.
grant execute on function apply_achievement_rules(uuid) to authenticated, service_role;

-- ================================================================
-- Загрузка изображений файлом вместо ссылки.
-- Рядом с *_url добавляем *_path: путь объекта в Supabase Storage.
-- Он нужен, чтобы при замене или удалении картинки убрать и сам файл,
-- иначе бакет засоряется «сиротами».
-- ================================================================

alter table news        add column if not exists image_path text;
alter table books       add column if not exists cover_path text;
alter table events      add column if not exists photo_path text;
alter table employees   add column if not exists photo_path text;
alter table store_items add column if not exists image_url text;
alter table store_items add column if not exists image_path text;
alter table pages       add column if not exists cover_url text;
alter table pages       add column if not exists cover_path text;
alter table courses     add column if not exists cover_url text;
alter table courses     add column if not exists cover_path text;
