-- =====================================================================
-- Миграция 0003: представления и функции.
--
-- BUG-014/015/016 — четыре экрана показывали четыре разных числа. Теперь один
--                   агрегирующий источник portal_stats().
-- BUG-004/005/049 — атомарная идемпотентная запись на курс.
-- BUG-007/018/019 — статус опроса вычисляется, счётчик ответов — агрегат.
-- BUG-010        — глобальный поиск.
-- BUG-026/038    — покупка в магазине с проверкой баланса и фиксацией цены.
-- BUG-041/042    — просроченные заявки и статус «В отпуске» выводятся из данных.
-- =====================================================================

-- --------------------------------------------------- вычисляемые представления
--
-- ВАЖНО: все представления объявлены WITH (security_invoker = true).
-- Без этого флага view выполняется с правами владельца и ПОЛНОСТЬЮ ОБХОДИТ RLS
-- базовых таблиц — сотрудник видел бы чужие операции по баллам и чужие балансы.
-- Проверено тестом: без флага v_wallet_transactions отдавал 3 строки там,
-- где прямое чтение таблицы отдавало 2.
--
-- Агрегаты, которые обязаны быть глобальными (сколько всего записалось на курс,
-- сколько свободных экземпляров книги), считаются SECURITY DEFINER-функциями:
-- иначе под RLS сотрудник видел бы только собственные строки и счётчик врал бы.

create or replace function course_enrolled_count(p_course uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct employee_id)::int from enrollments
   where course_id = p_course and status <> 'cancelled';
$$;

create or replace function course_completed_count(p_course uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct employee_id)::int from enrollments
   where course_id = p_course and status = 'completed';
$$;

create or replace function course_avg_progress(p_course uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(round(avg(progress)), 0)::int from enrollments
   where course_id = p_course and status <> 'cancelled';
$$;

create or replace function book_taken_count(p_book uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from book_loans where book_id = p_book and status in ('reserved', 'issued');
$$;

create or replace function book_readers_count(p_book uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from book_loans where book_id = p_book and status = 'returned';
$$;

create or replace function survey_responses_count(p_survey uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from survey_responses where survey_id = p_survey;
$$;

/** Сотрудник в отпуске прямо сейчас. Не конфиденциально — это видно в справочнике. */
create or replace function employee_on_leave_now(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leave_requests lr
     where lr.employee_id = p_employee
       and lr.status = 'approved'
       and current_date between lr.start_date and lr.end_date
  );
$$;

/** Баланс баллов: собственный — всегда, чужой — только HR и администратору. */
create or replace function employee_points_balance(p_employee uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when is_hr() or owns_employee(p_employee)
      then coalesce((select sum(amount) from wallet_transactions where employee_id = p_employee), 0)::int
    else null
  end;
$$;

grant execute on function course_enrolled_count(uuid), course_completed_count(uuid),
  course_avg_progress(uuid), book_taken_count(uuid), book_readers_count(uuid),
  survey_responses_count(uuid), employee_on_leave_now(uuid), employee_points_balance(uuid)
  to authenticated;

/** Опрос со статусом, посчитанным из дат, и реальным числом ответов. */
create or replace view v_surveys with (security_invoker = true) as
select
  s.*,
  survey_responses_count(s.id) as responses_count,
  jsonb_array_length(s.questions) as questions_count,
  case
    when s.status = 'draft' then 'draft'
    when s.status = 'archived' then 'archived'
    when s.end_date is not null and s.end_date < current_date then 'closed'  -- BUG-019
    else s.status::text
  end as effective_status,
  (s.end_date is not null and s.end_date < current_date) as is_expired
from surveys s;

/** Курс с агрегатами вместо хранимых счётчиков (BUG-049: 17 записанных при 15 сотрудниках). */
create or replace view v_courses with (security_invoker = true) as
select
  c.*,
  course_enrolled_count(c.id)  as enrolled_count,
  course_completed_count(c.id) as completed_count,
  course_avg_progress(c.id)    as avg_progress
from courses c;

/** Книга с числом свободных экземпляров (BUG-064). */
create or replace view v_books with (security_invoker = true) as
select
  b.*,
  book_taken_count(b.id) as taken_count,
  greatest(b.copies - book_taken_count(b.id), 0) as available_count,
  book_readers_count(b.id) as readers_count
from books b;

/** Новость с реальным числом лайков и комментариев (BUG-031, BUG-083). */
create or replace view v_news with (security_invoker = true) as
select
  n.*,
  (select count(*) from news_likes l where l.news_id = n.id)::int as likes,
  (select count(*) from comments c where c.entity_type = 'news' and c.entity_id = n.id)::int as comments_count,
  exists (select 1 from news_likes l where l.news_id = n.id and l.user_id = auth.uid()) as liked_by_me
from news n;

/** Заявка на отпуск с признаком просрочки (BUG-041). */
create or replace view v_leave_requests with (security_invoker = true) as
select
  lr.*,
  (lr.status = 'pending' and lr.start_date < current_date) as is_overdue,
  greatest(current_date - lr.created_date::date, 0) as age_days
from leave_requests lr;

/**
 * Сотрудник со статусом, выведенным из согласованных заявок (BUG-042),
 * и стажем, посчитанным из hire_date (BUG-021/022).
 */
create or replace view v_employees with (security_invoker = true) as
select
  e.*,
  employee_on_leave_now(e.id) as is_on_leave_now,
  case
    when e.hire_date is null then null
    else extract(year from age(current_date, e.hire_date))::int
  end as tenure_years,
  employee_points_balance(e.id) as points_balance
from employees e;

/** Операции кошелька с заполненными филиалом и отделом (BUG-035). */
create or replace view v_wallet_transactions with (security_invoker = true) as
select
  w.id, w.employee_id, w.amount, w.type, w.reason, w.reason_code, w.date,
  w.admin_id, w.admin_name, w.item_id, w.item_name, w.is_correction,
  w.linked_operation_id, w.created_date,
  e.name as employee_name,
  coalesce(b.city, e.branch) as branch,
  coalesce(d.name, e.department) as department,
  ar.title as reason_title
from wallet_transactions w
left join employees e on e.id = w.employee_id
left join branches b on b.id = coalesce(w.branch_id, e.branch_id)
left join departments d on d.id = coalesce(w.department_id, e.department_id)
left join award_reasons ar on ar.code = w.reason_code;

/** Численность по отделам — по department_id, а не по строке (BUG-039). */
create or replace view v_departments with (security_invoker = true) as
select
  d.*,
  (select count(*) from employees e where e.department_id = d.id and e.status <> 'dismissed')::int as employees_count
from departments d;

grant select on v_surveys, v_courses, v_books, v_news, v_leave_requests,
                v_employees, v_wallet_transactions, v_departments to authenticated;

-- ------------------------------------------------------ единый слой агрегатов

/**
 * BUG-014/015/016: единственный источник счётчиков для главной, /admin и модулей.
 * Возвращает jsonb, чтобы фронт не собирал числа из разных запросов.
 */
create or replace function portal_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'employees_total',      (select count(*) from employees where status <> 'dismissed'),
    'employees_active',     (select count(*) from employees where status = 'active'),
    'employees_on_leave',   (select count(*) from v_employees where is_on_leave_now),
    'employees_probation',  (select count(*) from employees where status = 'probation'),
    'departments_total',    (select count(*) from departments),
    'news_published',       (select count(*) from news where status = 'published'),
    'news_total',           (select count(*) from news),
    'courses_published',    (select count(*) from courses where status = 'published'),
    'enrollments_total',    (select count(*) from enrollments where status <> 'cancelled'),
    'enrollments_completed',(select count(*) from enrollments where status = 'completed'),
    'learning_progress',    (select coalesce(round(avg(progress)), 0) from enrollments where status <> 'cancelled'),
    'books_total',          (select count(*) from books),
    'surveys_active',       (select count(*) from v_surveys where effective_status = 'active'),
    'surveys_total',        (select count(*) from surveys),
    'survey_responses',     (select count(*) from survey_responses),
    'leave_pending',        (select count(*) from leave_requests where status = 'pending'),
    'leave_overdue',        (select count(*) from v_leave_requests where is_overdue),
    'leave_total',          (select count(*) from leave_requests),
    'requests_pending',     (select count(*) from service_requests where status = 'pending'),
    'requests_total',       (select count(*) from service_requests),
    'points_issued',        (select coalesce(sum(amount), 0) from wallet_transactions where amount > 0),
    'points_spent',         (select coalesce(abs(sum(amount)), 0) from wallet_transactions where amount < 0),
    'store_items_active',   (select count(*) from store_items where active),
    'vacancies_open',       (select count(*) from vacancies where status = 'open'),
    'generated_at',         now()
  );
$$;

grant execute on function portal_stats() to authenticated;

-- --------------------------------------------------------------- запись на курс

/**
 * BUG-004/005: «Записаться» больше не инкрементит общий объект курса.
 * Идемпотентно: повторный вызов возвращает существующую запись.
 */
create or replace function enroll_in_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid := auth_employee_id();
  v_course   courses%rowtype;
  v_row      enrollments%rowtype;
  v_existed  boolean;
begin
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника' using errcode = '42501';
  end if;

  select * into v_course from courses where id = p_course_id;
  if not found then
    raise exception 'Курс не найден' using errcode = 'P0002';
  end if;
  if v_course.status <> 'published' then
    raise exception 'Курс недоступен для записи' using errcode = '22023';
  end if;

  select * into v_row from enrollments
   where employee_id = v_employee and course_id = p_course_id;
  v_existed := found;

  if not v_existed then
    insert into enrollments (employee_id, course_id, status, progress)
    values (v_employee, p_course_id, 'enrolled', 0)
    on conflict (employee_id, course_id) do update set updated_date = now()
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'progress', v_row.progress,
    'already_enrolled', v_existed
  );
end;
$$;

grant execute on function enroll_in_course(uuid) to authenticated;

/** Обновление прогресса по курсу с автозакрытием на 100 %. */
create or replace function set_enrollment_progress(p_course_id uuid, p_progress int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid := auth_employee_id();
  v_row enrollments%rowtype;
begin
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника' using errcode = '42501';
  end if;
  update enrollments
     set progress = least(greatest(p_progress, 0), 100),
         status = case when least(greatest(p_progress, 0), 100) >= 100 then 'completed' else 'in_progress' end,
         completed_at = case when least(greatest(p_progress, 0), 100) >= 100 then now() else null end
   where employee_id = v_employee and course_id = p_course_id
   returning * into v_row;
  if not found then
    raise exception 'Вы не записаны на этот курс' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

grant execute on function set_enrollment_progress(uuid, int) to authenticated;

-- ------------------------------------------------------------------- кошелёк

create or replace function wallet_balance(p_employee_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::int
  from wallet_transactions
  where employee_id = coalesce(p_employee_id, auth_employee_id())
    and (coalesce(p_employee_id, auth_employee_id()) = auth_employee_id() or is_hr());
$$;

grant execute on function wallet_balance(uuid) to authenticated;

/**
 * BUG-026/038: покупка в магазине наград.
 * Проверяет баланс и остаток, фиксирует цену в момент покупки, списывает баллы —
 * всё одной транзакцией, чтобы нельзя было уйти в минус.
 */
create or replace function purchase_store_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid := auth_employee_id();
  v_emp_name text;
  v_item store_items%rowtype;
  v_balance int;
  v_tx_id uuid;
  v_order_id uuid;
begin
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника' using errcode = '42501';
  end if;

  select * into v_item from store_items where id = p_item_id for update;
  if not found or not v_item.active then
    raise exception 'Товар недоступен' using errcode = 'P0002';
  end if;
  if v_item.stock = 0 then
    raise exception 'Товара нет в наличии' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
    from wallet_transactions where employee_id = v_employee;

  if v_balance < v_item.price then
    raise exception 'Недостаточно баллов: нужно %, доступно %', v_item.price, v_balance using errcode = '22023';
  end if;

  select name into v_emp_name from employees where id = v_employee;

  insert into wallet_transactions (employee_id, employee_name, amount, type, reason, reason_code, item_id, item_name)
  values (v_employee, v_emp_name, -v_item.price, 'spend', 'Покупка: ' || v_item.name, 'purchase', v_item.id, v_item.name)
  returning id into v_tx_id;

  insert into store_orders (item_id, item_name, price_at_purchase, employee_id, employee_name, transaction_id)
  values (v_item.id, v_item.name, v_item.price, v_employee, v_emp_name, v_tx_id)
  returning id into v_order_id;

  if v_item.stock > 0 then
    update store_items set stock = stock - 1 where id = v_item.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'transaction_id', v_tx_id,
    'price', v_item.price,
    'balance_after', v_balance - v_item.price
  );
end;
$$;

grant execute on function purchase_store_item(uuid) to authenticated;

-- ------------------------------------------------------------ книги и лайки

create or replace function reserve_book(p_book_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid := auth_employee_id();
  v_available int;
  v_row book_loans%rowtype;
begin
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника' using errcode = '42501';
  end if;
  select available_count into v_available from v_books where id = p_book_id;
  if v_available is null then
    raise exception 'Книга не найдена' using errcode = 'P0002';
  end if;
  if v_available <= 0 then
    raise exception 'Свободных экземпляров нет' using errcode = '22023';
  end if;
  insert into book_loans (book_id, employee_id, status, due_date)
  values (p_book_id, v_employee, 'reserved', current_date + 30)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

grant execute on function reserve_book(uuid) to authenticated;

/** BUG-031: рабочий лайк новости. */
create or replace function toggle_news_like(p_news_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_liked boolean;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход в систему' using errcode = '42501';
  end if;
  if exists (select 1 from news_likes where news_id = p_news_id and user_id = auth.uid()) then
    delete from news_likes where news_id = p_news_id and user_id = auth.uid();
    v_liked := false;
  else
    insert into news_likes (news_id, user_id) values (p_news_id, auth.uid());
    v_liked := true;
  end if;
  return jsonb_build_object(
    'liked', v_liked,
    'likes', (select count(*) from news_likes where news_id = p_news_id)
  );
end;
$$;

grant execute on function toggle_news_like(uuid) to authenticated;

/** Просмотр новости — счётчик увеличивается на сервере, а не полем из UI. */
create or replace function register_news_view(p_news_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update news set views = views + 1 where id = p_news_id and status = 'published';
end;
$$;

grant execute on function register_news_view(uuid) to authenticated;

create or replace function register_page_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update pages set views = views + 1 where slug = p_slug and status = 'published';
end;
$$;

grant execute on function register_page_view(text) to authenticated;

-- --------------------------------------------------------------- поиск

/**
 * BUG-010: глобальный поиск в шапке не работал ни по Enter, ни выпадашкой.
 * Ищет по сотрудникам, новостям, курсам, книгам и CMS-страницам с учётом прав.
 */
create or replace function global_search(q text, max_results int default 20)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  url text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with needle as (select nullif(btrim(q), '') as term)
  select * from (
    select 'employee' as kind, e.id, e.name as title,
           coalesce(e.position, '') || case when e.department is not null then ' · ' || e.department else '' end as subtitle,
           -- Карточка коллеги доступна всем вошедшим; /admin/employees закрыт ролью HR.
           '/cabinet/people/' || e.id as url,
           similarity(e.name, (select term from needle)) as rank
      from employees e
     where (select term from needle) is not null
       and is_authenticated()
       and (e.name ilike '%' || (select term from needle) || '%'
            or e.email ilike '%' || (select term from needle) || '%'
            or e.position ilike '%' || (select term from needle) || '%')

    union all
    select 'news', n.id, n.title, coalesce(n.author_name, 'Новости'), '/cabinet/news/' || n.id,
           similarity(n.title, (select term from needle))
      from news n
     where (select term from needle) is not null and n.status = 'published'
       and (n.title ilike '%' || (select term from needle) || '%' or n.body ilike '%' || (select term from needle) || '%')

    union all
    select 'course', c.id, c.title, coalesce(c.category, 'Обучение'), '/cabinet/learning/' || c.id,
           similarity(c.title, (select term from needle))
      from courses c
     where (select term from needle) is not null and c.status = 'published'
       and (c.title ilike '%' || (select term from needle) || '%' or c.description ilike '%' || (select term from needle) || '%')

    union all
    select 'book', b.id, b.title, coalesce(b.author, 'Библиотека'), '/cabinet/library/' || b.id,
           similarity(b.title, (select term from needle))
      from books b
     where (select term from needle) is not null
       and (b.title ilike '%' || (select term from needle) || '%' or b.author ilike '%' || (select term from needle) || '%')

    union all
    select 'page', p.id, p.title, 'Страница портала', '/' || p.slug,
           similarity(p.title, (select term from needle))
      from pages p
     where (select term from needle) is not null and p.status = 'published'
       and (p.title ilike '%' || (select term from needle) || '%' or p.body ilike '%' || (select term from needle) || '%')
  ) results
  order by rank desc nulls last, title
  limit greatest(least(max_results, 50), 1);
$$;

grant execute on function global_search(text, int) to authenticated;

-- -------------------------------------------------- фоновое закрытие просрочек

/**
 * BUG-019/041: опросы с прошедшим дедлайном оставались «Активными»,
 * а заявка на отпуск висела «Ожидает» через 2,5 недели после самого отпуска.
 * Функция вызывается по расписанию (pg_cron / Supabase Scheduled Function).
 */
create or replace function close_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surveys int;
  v_sessions int;
  v_leaves int;
begin
  update surveys set status = 'closed'
   where status = 'active' and end_date is not null and end_date < current_date;
  get diagnostics v_surveys = row_count;

  update survey_sessions set status = 'closed'
   where status = 'active' and end_date is not null and end_date < current_date;
  get diagnostics v_sessions = row_count;

  -- Просроченные заявки не «одобряются» автоматически: их помечают отменёнными
  -- и уведомляют согласующего, чтобы решение всегда принимал человек.
  update leave_requests set status = 'cancelled', decided_at = now()
   where status = 'pending' and end_date < current_date - interval '7 days';
  get diagnostics v_leaves = row_count;

  return jsonb_build_object('surveys', v_surveys, 'sessions', v_sessions, 'leave_requests', v_leaves);
end;
$$;

-- Сессию опроса нельзя запустить для черновика (BUG-020).
create or replace function validate_survey_session()
returns trigger
language plpgsql
as $$
declare v_status survey_status;
begin
  if new.status = 'active' then
    select status into v_status from surveys where id = new.survey_id;
    if v_status is distinct from 'active' then
      raise exception 'Нельзя запустить сессию: опрос находится в статусе «%»', v_status
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_survey_session_valid on survey_sessions;
create trigger trg_survey_session_valid
  before insert or update on survey_sessions
  for each row execute function validate_survey_session();


-- ------------------------------------------- поздравительное начисление баллов
--
-- Логика раньше жила на клиенте и писала напрямую в wallet_transactions,
-- что RLS-политика wallet_write разрешает только HR. У рядового сотрудника
-- начисление молча не срабатывало. Переносим на сервер: SECURITY DEFINER,
-- идемпотентно в пределах календарного года.

create or replace function claim_birthday_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee employees%rowtype;
  v_points   int;
  v_already  boolean;
begin
  select * into v_employee from employees where id = auth_employee_id();
  if not found or v_employee.birth_date is null then
    return jsonb_build_object('awarded', false, 'reason', 'no_employee');
  end if;

  -- Начисляем только в сам день рождения.
  if to_char(v_employee.birth_date, 'MM-DD') <> to_char(current_date, 'MM-DD') then
    return jsonb_build_object('awarded', false, 'reason', 'not_today');
  end if;

  select exists (
    select 1 from wallet_transactions
     where employee_id = v_employee.id
       and reason_code = 'birthday'
       and date >= date_trunc('year', current_date)::date
  ) into v_already;

  if v_already then
    return jsonb_build_object('awarded', false, 'reason', 'already_claimed');
  end if;

  select coalesce(default_points, 500) into v_points
    from award_reasons where code = 'birthday' and active;
  if v_points is null then
    return jsonb_build_object('awarded', false, 'reason', 'no_rule');
  end if;

  insert into wallet_transactions
    (employee_id, employee_name, amount, type, reason, reason_code, branch_id, department_id)
  values
    (v_employee.id, v_employee.name, v_points, 'workflow', 'Поздравление с днём рождения',
     'birthday', v_employee.branch_id, v_employee.department_id);

  insert into achievements (employee_id, employee_name, title, type, points, auto, rule, reason_code, icon)
  values (v_employee.id, v_employee.name, 'С днём рождения!', 'birthday', v_points, true,
          'birthday', 'birthday', 'birthday');

  return jsonb_build_object('awarded', true, 'points', v_points);
end;
$$;

grant execute on function claim_birthday_bonus() to authenticated;
