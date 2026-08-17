-- =====================================================================
-- Миграция 0006: права на выполнение функций.
--
-- ПРОБЛЕМА. PostgreSQL по умолчанию выдаёт EXECUTE роли PUBLIC на каждую новую
-- функцию. В Supabase это означает, что любая SECURITY DEFINER-функция становится
-- доступна анонимному вызову через REST: /rest/v1/rpc/<имя>.
--
-- То есть без этой миграции аноним мог бы дёрнуть
--   POST /rest/v1/rpc/global_search {"q":"а"}      → список сотрудников,
--   POST /rest/v1/rpc/portal_stats                 → сводка по компании,
--   POST /rest/v1/rpc/wallet_balance {...}         → баланс баллов,
-- полностью минуя RLS-политики, ради которых всё и затевалось (BUG-001/002).
--
-- РЕШЕНИЕ. Отзываем EXECUTE у PUBLIC и anon на все функции схемы public,
-- затем точечно возвращаем то, что действительно нужно роли authenticated.
-- Триггерные функции не выдаются никому: при срабатывании триггера привилегия
-- EXECUTE не проверяется, а через RPC их вызывать незачем.
-- =====================================================================

-- --------------------------------------------------- полный отзыв прав

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
             on d.objid = p.oid
            and d.deptype = 'e'          -- функции расширений не трогаем:
      where n.nspname = 'public'          -- pg_trgm/unaccent нужны индексам,
        and p.prokind = 'f'               -- данных они не раскрывают
        and d.objid is null
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

-- ------------------------------------ хелперы RLS и вычисляемых представлений
-- Вызываются при проверке политик и внутри v_* (security_invoker),
-- поэтому исполняются от имени самого пользователя.

grant execute on function
  auth_role(),
  auth_employee_id(),
  is_admin(),
  is_hr(),
  is_manager(),
  is_authenticated(),
  owns_employee(uuid),
  manages_employee(uuid)
to authenticated;

grant execute on function
  course_enrolled_count(uuid),
  course_completed_count(uuid),
  course_avg_progress(uuid),
  book_taken_count(uuid),
  book_readers_count(uuid),
  survey_responses_count(uuid),
  employee_on_leave_now(uuid),
  employee_points_balance(uuid)
to authenticated;

-- --------------------------------------------- прикладные RPC портала

grant execute on function
  portal_stats(),
  global_search(text, integer),
  enroll_in_course(uuid),
  set_enrollment_progress(uuid, integer),
  wallet_balance(uuid),
  purchase_store_item(uuid),
  reserve_book(uuid),
  toggle_news_like(uuid),
  register_news_view(uuid),
  register_page_view(text),
  claim_birthday_bonus(),
  log_login(),
  log_logout()
to authenticated;

-- ------------------------------------------------ служебные операции
--
-- В Supabase действует ALTER DEFAULT PRIVILEGES, автоматически выдающий EXECUTE
-- ролям authenticated и service_role на каждую новую функцию в public. Поэтому
-- одного отзыва у anon мало: без строк ниже любой вошедший сотрудник мог бы
-- вызвать /rest/v1/rpc/close_expired_records и разом закрыть все опросы,
-- сессии и заявки на отпуск.
--
-- Закрытие просроченных записей выполняет планировщик (Edge Function close-expired)
-- под service_role — из браузера это дёргать нельзя.

revoke all on function close_expired_records() from authenticated;
grant execute on function close_expired_records() to service_role;

-- Триггерные функции вызываются только движком триггеров: при срабатывании
-- привилегия EXECUTE не проверяется, а через RPC они не нужны никому.
revoke all on function
  audit_trigger(),
  handle_new_user(),
  set_updated_date(),
  validate_survey_session(),
  notify_leave_decision(),
  notify_request_update(),
  notify_wallet_credit()
from authenticated, anon;

-- ----------------------------------- фиксируем search_path у оставшихся функций
-- Изменяемый search_path у SECURITY DEFINER-функции — классический вектор подмены
-- объектов; у триггерных функций фиксируем его для единообразия.

alter function set_updated_date() set search_path = public;
alter function validate_survey_session() set search_path = public;
alter function owns_employee(uuid) set search_path = public;

-- ------------------------------------------------------------ проверка
-- После применения anon не может выполнить ни одной прикладной функции,
-- а authenticated — только те, что перечислены выше:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
--    where n.nspname = 'public' and p.prokind = 'f' and d.objid is null
--    order by 2 desc, 3 desc, 1;
--
-- Ожидаемо: колонка anon — везде false; close_expired_records и триггерные
-- функции — false и у authenticated.
