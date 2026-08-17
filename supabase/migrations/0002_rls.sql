-- =====================================================================
-- Миграция 0002: Row Level Security.
--
-- BUG-001 — анонимный доступ ко всему порталу, включая админку.
-- BUG-002 — Employee отдавался анонимно вместе с salary_band, phone, birth_date.
-- BUG-003 — анонимная ЗАПИСЬ в базу (PUT /entities/Course → 200).
--
-- Правило по умолчанию: всё закрыто. Ни одна таблица не доступна роли `anon`.
-- =====================================================================

-- ------------------------------------------------- вспомогательные функции

-- SECURITY DEFINER, чтобы чтение роли из profiles не вызывало рекурсию в политиках.
create or replace function auth_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()), 'employee'::app_role);
$$;

create or replace function auth_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select employee_id from profiles where id = auth.uid();
$$;

-- Все хелперы объявлены SECURITY DEFINER: иначе роли anon/authenticated
-- должны иметь usage на схему auth, и политика падает с «permission denied for schema auth».
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select auth_role() = 'admin'; $$;

create or replace function is_hr()
returns boolean language sql stable security definer set search_path = public
as $$ select auth_role() in ('hr', 'admin'); $$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public
as $$ select auth_role() in ('manager', 'hr', 'admin'); $$;

create or replace function is_authenticated()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select auth.uid() is not null; $$;

/** Руководитель видит только своих прямых и косвенных подчинённых. */
create or replace function manages_employee(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive subordinates as (
    select id from employees where manager_id = auth_employee_id()
    union all
    select e.id from employees e join subordinates s on e.manager_id = s.id
  )
  select is_hr() or exists (select 1 from subordinates where id = target);
$$;

/** Доступ к собственным данным сотрудника. */
create or replace function owns_employee(target uuid)
returns boolean
language sql
stable
as $$ select target is not null and target = auth_employee_id(); $$;

-- ------------------------------------------------------ включаем RLS везде

do $$
declare t text;
begin
  foreach t in array array[
    'branches','departments','employees','employee_private','profiles','news','news_likes','comments',
    'pages','events','event_registrations','courses','enrollments','books','book_loans','trainings',
    'training_completions','goals','kpis','development_plans','leave_requests','service_requests',
    'request_comments','hr_documents','user_files','onboarding_tasks','surveys','survey_sessions',
    'survey_responses','auto_surveys','award_reasons','achievements','store_items','store_orders',
    'wallet_transactions','awards','vacancies','candidates','notifications','favorites','feedback',
    'settings','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- Явно отзываем всё у анонимной роли: без сессии портал недоступен.
    execute format('revoke all on table %I from anon', t);
  end loop;
end $$;

-- --------------------------------------------------------------- profiles

create policy profiles_select_self on profiles
  for select using (id = auth.uid() or is_hr());

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles p where p.id = auth.uid()));

create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- --------------------------------------------------------------- employees

-- Карточка сотрудника — корпоративный справочник: читают все вошедшие,
-- но БЕЗ зарплатной вилки и заметок (они в employee_private).
create policy employees_select on employees
  for select using (is_authenticated());

create policy employees_update_self on employees
  for update using (owns_employee(id))
  with check (owns_employee(id));

create policy employees_hr_write on employees
  for all using (is_hr()) with check (is_hr());

-- BUG-002: конфиденциальные поля — только HR и администратор.
create policy employee_private_hr on employee_private
  for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------------------ справочники

create policy branches_read on branches for select using (is_authenticated());
create policy branches_write on branches for all using (is_hr()) with check (is_hr());

create policy departments_read on departments for select using (is_authenticated());
create policy departments_write on departments for all using (is_hr()) with check (is_hr());

create policy award_reasons_read on award_reasons for select using (is_authenticated());
create policy award_reasons_write on award_reasons for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------------------------ контент

create policy news_read on news
  for select using (is_authenticated() and (status = 'published' or is_hr()));
create policy news_write on news for all using (is_hr()) with check (is_hr());

create policy news_likes_read on news_likes for select using (is_authenticated());
create policy news_likes_own on news_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy comments_read on comments for select using (is_authenticated());
create policy comments_insert on comments for insert with check (user_id = auth.uid());
create policy comments_update_own on comments for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comments_delete on comments for delete using (user_id = auth.uid() or is_hr());

-- CMS-страницы (BUG-008): доступны всем вошедшим, черновики — только HR.
-- Публичного (анонимного) доступа нет: портал внутренний, наружу не отдаётся ничего.
create policy pages_read on pages
  for select using (is_authenticated() and (status = 'published' or is_hr()));
create policy pages_write on pages for all using (is_hr()) with check (is_hr());

create policy events_read on events for select using (is_authenticated());
create policy events_write on events for all using (is_hr()) with check (is_hr());

create policy event_reg_read on event_registrations for select using (is_authenticated());
create policy event_reg_own on event_registrations for all
  using (owns_employee(employee_id) or is_hr())
  with check (owns_employee(employee_id) or is_hr());

-- ------------------------------------------------------------------ обучение

create policy courses_read on courses
  for select using (is_authenticated() and (status = 'published' or is_hr()));
create policy courses_write on courses for all using (is_hr()) with check (is_hr());

-- BUG-003/004: записаться можно только за себя, и только в существующий курс.
create policy enrollments_read on enrollments
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy enrollments_insert on enrollments
  for insert with check (owns_employee(employee_id) or is_hr());
create policy enrollments_update on enrollments
  for update using (owns_employee(employee_id) or is_hr())
  with check (owns_employee(employee_id) or is_hr());
create policy enrollments_delete on enrollments
  for delete using (owns_employee(employee_id) or is_hr());

create policy books_read on books for select using (is_authenticated());
create policy books_write on books for all using (is_hr()) with check (is_hr());

create policy book_loans_read on book_loans
  for select using (owns_employee(employee_id) or is_hr());
create policy book_loans_own on book_loans
  for all using (owns_employee(employee_id) or is_hr())
  with check (owns_employee(employee_id) or is_hr());

create policy trainings_read on trainings for select using (is_authenticated());
create policy trainings_write on trainings for all using (is_hr()) with check (is_hr());

create policy training_completions_read on training_completions
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy training_completions_write on training_completions
  for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------------- цели, KPI, развитие

create policy goals_read on goals
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy goals_write_own on goals
  for all using (owns_employee(employee_id) or manages_employee(employee_id))
  with check (owns_employee(employee_id) or manages_employee(employee_id));

create policy kpis_read on kpis
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy kpis_write on kpis
  for all using (manages_employee(employee_id)) with check (manages_employee(employee_id));

create policy dev_plans_read on development_plans
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy dev_plans_write on development_plans
  for all using (owns_employee(employee_id) or manages_employee(employee_id))
  with check (owns_employee(employee_id) or manages_employee(employee_id));

-- ------------------------------------------------------------------- отпуска

create policy leave_read on leave_requests
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy leave_insert on leave_requests
  for insert with check (owns_employee(employee_id) or is_hr());
-- Сотрудник может править/отзывать только собственную заявку в статусе «Ожидает».
create policy leave_update_own on leave_requests
  for update using (owns_employee(employee_id) and status = 'pending')
  with check (owns_employee(employee_id) and status in ('pending', 'cancelled'));
create policy leave_update_manager on leave_requests
  for update using (manages_employee(employee_id)) with check (manages_employee(employee_id));
create policy leave_delete on leave_requests
  for delete using ((owns_employee(employee_id) and status = 'pending') or is_hr());

-- --------------------------------------------------------------- заявки, HR

create policy requests_read on service_requests
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy requests_insert on service_requests
  for insert with check (owns_employee(employee_id));
create policy requests_update on service_requests
  for update using (manages_employee(employee_id) or (owns_employee(employee_id) and status = 'pending'))
  with check (manages_employee(employee_id) or owns_employee(employee_id));

create policy request_comments_read on request_comments
  for select using (
    exists (
      select 1 from service_requests r
      where r.id = request_id
        and (owns_employee(r.employee_id) or manages_employee(r.employee_id))
    )
    and (not is_internal or is_hr())
  );
create policy request_comments_insert on request_comments
  for insert with check (user_id = auth.uid());

create policy hr_documents_read on hr_documents
  for select using (owns_employee(employee_id) or is_hr());
create policy hr_documents_write on hr_documents
  for all using (is_hr()) with check (is_hr());

create policy user_files_own on user_files
  for all using (user_id = auth.uid() or is_hr()) with check (user_id = auth.uid() or is_hr());

create policy onboarding_read on onboarding_tasks
  for select using (owns_employee(employee_id) or manages_employee(employee_id));
create policy onboarding_update_own on onboarding_tasks
  for update using (owns_employee(employee_id)) with check (owns_employee(employee_id));
create policy onboarding_write on onboarding_tasks
  for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------------------------- опросы

create policy surveys_read on surveys
  for select using (is_authenticated() and (status = 'active' or is_hr()));
create policy surveys_write on surveys for all using (is_hr()) with check (is_hr());

create policy survey_sessions_read on survey_sessions
  for select using (is_authenticated() and (status = 'active' or is_hr()));
create policy survey_sessions_write on survey_sessions for all using (is_hr()) with check (is_hr());

-- Свои ответы видит автор; HR видит все, но у анонимных опросов автора нет в принципе.
create policy survey_responses_read on survey_responses
  for select using (is_hr() or owns_employee(employee_id));
create policy survey_responses_insert on survey_responses
  for insert with check (is_authenticated());

create policy auto_surveys_all on auto_surveys for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------------- баллы и достижения

create policy achievements_read on achievements for select using (is_authenticated());
create policy achievements_write on achievements for all using (is_hr()) with check (is_hr());

create policy awards_read on awards for select using (is_authenticated());
create policy awards_write on awards for all using (is_hr()) with check (is_hr());

create policy store_items_read on store_items
  for select using (is_authenticated() and (active or is_hr()));
create policy store_items_write on store_items for all using (is_hr()) with check (is_hr());

create policy store_orders_read on store_orders
  for select using (owns_employee(employee_id) or is_hr());
create policy store_orders_write on store_orders for all using (is_hr()) with check (is_hr());

-- Начислять и списывать баллы через прямую вставку нельзя никому, кроме HR:
-- покупка идёт через SECURITY DEFINER функцию purchase_store_item().
create policy wallet_read on wallet_transactions
  for select using (owns_employee(employee_id) or is_hr());
create policy wallet_write on wallet_transactions
  for all using (is_hr()) with check (is_hr());

-- ---------------------------------------------------------------- рекрутинг

create policy vacancies_read on vacancies for select using (is_authenticated());
create policy vacancies_write on vacancies for all using (is_hr()) with check (is_hr());

create policy candidates_read on candidates for select using (is_hr());
create policy candidates_write on candidates for all using (is_hr()) with check (is_hr());

-- ------------------------------------------------- уведомления и избранное

create policy notifications_own on notifications
  for select using (user_id = auth.uid());
create policy notifications_update_own on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_hr_write on notifications
  for all using (is_hr()) with check (is_hr());

create policy favorites_own on favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy feedback_insert on feedback for insert with check (is_authenticated());
create policy feedback_read on feedback
  for select using (is_hr() or (not anonymous and owns_employee(employee_id)));
create policy feedback_update on feedback for update using (is_hr()) with check (is_hr());

-- --------------------------------------------------- настройки и журнал аудита

create policy settings_read on settings for select using (is_authenticated());
create policy settings_write on settings for all using (is_admin()) with check (is_admin());

-- BUG-009: журнал только на чтение для HR/админа. Записывают исключительно триггеры.
create policy audit_read on audit_logs for select using (is_hr());
-- Ни одной политики на insert/update/delete: приложение не может подделать журнал.

-- ------------------------------------------------------------------- гранты

grant execute on function auth_role(), auth_employee_id(), is_admin(), is_hr(),
                          is_manager(), is_authenticated(), owns_employee(uuid),
                          manages_employee(uuid) to anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, update, delete on audit_logs from authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
