-- =====================================================================
-- Миграция 0013: достоверная аналитика программы баллов.
--
-- Требования, сформулированные HR:
--   1) разбивка ПОПОЛНЕНИЙ по причинам и категориям причин;
--   2) разбивка ТРАТ по товарам и категориям товаров;
--   3) разрез по подразделениям и филиалам;
--   4) движение баллов: начислено / списано / остаток на руках;
--   5) полная история операций, пригодная к выгрузке;
--   6) данные должны считаться автоматически и достоверно.
--
-- ГЛАВНОЕ. Раньше отчёт собирался в браузере из выборки последних 5000 операций.
-- На небольшой истории это совпадало с правдой, но по мере роста базы цифры
-- начали бы тихо расходиться с реальностью — без единой ошибки на экране.
-- Именно поэтому «часть показателей невозможно получить в достоверном виде».
-- Теперь все агрегаты считает СУБД по всей истории, без лимитов и без выборки.
-- =====================================================================

/**
 * Сводная аналитика за период. Возвращает jsonb со всеми разрезами сразу:
 * один запрос вместо десятка, и все числа заведомо согласованы между собой.
 *
 * p_from / p_to — границы включительно; null означает «без границы».
 */
create or replace function wallet_analytics(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not is_hr() then
    raise exception 'Аналитика программы баллов доступна HR и администратору'
      using errcode = '42501';
  end if;

  with tx as (
    select w.*,
           e.name          as employee_name_real,
           coalesce(d.name, e.department, 'Не указан') as department_name,
           coalesce(b.city, e.branch, 'Не указан')     as branch_name
      from wallet_transactions w
      left join employees   e on e.id = w.employee_id
      left join departments d on d.id = coalesce(w.department_id, e.department_id)
      left join branches    b on b.id = coalesce(w.branch_id, e.branch_id)
     where (p_from is null or w.date >= p_from)
       and (p_to   is null or w.date <= p_to)
  ),
  -- Итоги. Остаток «на руках» — это обязательство компании перед сотрудниками,
  -- поэтому считается по ВСЕЙ истории, а не за выбранный период.
  totals as (
    select
      coalesce(sum(amount) filter (where amount > 0), 0)::bigint       as earned,
      coalesce(abs(sum(amount) filter (where amount < 0)), 0)::bigint  as spent,
      count(*) filter (where amount > 0)                               as earn_operations,
      count(*) filter (where amount < 0)                               as spend_operations,
      count(distinct employee_id)                                      as participants,
      count(distinct employee_id) filter (where amount < 0)            as spenders
    from tx
  ),
  by_reason as (
    select
      coalesce(t.reason_code, 'other')                       as code,
      coalesce(ar.title, t.reason, 'Без указания причины')   as title,
      coalesce(ar.category, 'other')                         as category,
      sum(t.amount)::bigint                                  as amount,
      count(*)                                               as operations,
      count(distinct t.employee_id)                          as employees
    from tx t
    left join award_reasons ar on ar.code = t.reason_code
    where t.amount > 0
    group by 1, 2, 3
  ),
  by_reason_category as (
    select coalesce(category, 'other') as category,
           sum(amount)::bigint as amount,
           sum(operations)     as operations
      from by_reason group by 1
  ),
  by_type as (
    select type::text as type,
           sum(amount)::bigint as amount,
           count(*)            as operations
      from tx group by 1
  ),
  -- Покупки берём из store_orders: там зафиксирована цена на момент покупки,
  -- поэтому история не «поплывёт» при изменении цены в каталоге.
  orders as (
    select o.*, coalesce(si.category, 'Без категории') as item_category
      from store_orders o
      left join store_items si on si.id = o.item_id
     where (p_from is null or o.created_date::date >= p_from)
       and (p_to   is null or o.created_date::date <= p_to)
       and o.status <> 'cancelled'
  ),
  by_item as (
    select item_name,
           item_category,
           count(*)                        as purchases,
           sum(price_at_purchase)::bigint  as amount,
           count(distinct employee_id)     as employees
      from orders group by 1, 2
  ),
  by_item_category as (
    select item_category as category,
           sum(purchases)::bigint as purchases,
           sum(amount)::bigint    as amount
      from by_item group by 1
  ),
  by_department as (
    select department_name as name,
           coalesce(sum(amount) filter (where amount > 0), 0)::bigint      as earned,
           coalesce(abs(sum(amount) filter (where amount < 0)), 0)::bigint as spent,
           count(distinct employee_id)                                     as employees
      from tx group by 1
  ),
  by_branch as (
    select branch_name as name,
           coalesce(sum(amount) filter (where amount > 0), 0)::bigint      as earned,
           coalesce(abs(sum(amount) filter (where amount < 0)), 0)::bigint as spent,
           count(distinct employee_id)                                     as employees
      from tx group by 1
  ),
  by_month as (
    select to_char(date_trunc('month', date), 'YYYY-MM') as month,
           coalesce(sum(amount) filter (where amount > 0), 0)::bigint      as earned,
           coalesce(abs(sum(amount) filter (where amount < 0)), 0)::bigint as spent
      from tx group by 1
  ),
  top_earners as (
    select employee_id, max(employee_name_real) as name,
           sum(amount)::bigint as amount, count(*) as operations
      from tx where amount > 0 group by employee_id
  ),
  top_spenders as (
    select employee_id, max(employee_name_real) as name,
           abs(sum(amount))::bigint as amount, count(*) as operations
      from tx where amount < 0 group by employee_id
  ),
  -- Кто провёл операции: нагрузка HR-администраторов и прозрачность ручных начислений.
  by_admin as (
    select coalesce(admin_name, 'Система / автоматика') as admin_name,
           count(*)                                     as operations,
           sum(amount)::bigint                          as amount,
           count(distinct employee_id)                  as employees
      from tx group by 1
  ),
  -- Остатки: сколько баллов у людей на руках прямо сейчас (по всей истории).
  balances as (
    select w.employee_id, sum(w.amount)::bigint as balance
      from wallet_transactions w group by w.employee_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (
      select jsonb_build_object(
        'earned', t.earned,
        'spent', t.spent,
        'net', t.earned - t.spent,
        'earn_operations', t.earn_operations,
        'spend_operations', t.spend_operations,
        'participants', t.participants,
        'spenders', t.spenders,
        'spend_share', case when t.earned > 0
                            then round(t.spent::numeric * 100 / t.earned, 1) else 0 end,
        'outstanding', (select coalesce(sum(balance), 0) from balances where balance > 0),
        'holders', (select count(*) from balances where balance > 0),
        'avg_balance', (select coalesce(round(avg(balance)), 0) from balances where balance > 0)
      ) from totals t
    ),
    'by_reason', coalesce((select jsonb_agg(to_jsonb(r) order by r.amount desc) from by_reason r), '[]'::jsonb),
    'by_reason_category', coalesce((select jsonb_agg(to_jsonb(c) order by c.amount desc) from by_reason_category c), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(to_jsonb(t) order by abs(t.amount) desc) from by_type t), '[]'::jsonb),
    'by_item', coalesce((select jsonb_agg(to_jsonb(i) order by i.amount desc) from by_item i), '[]'::jsonb),
    'by_item_category', coalesce((select jsonb_agg(to_jsonb(c) order by c.amount desc) from by_item_category c), '[]'::jsonb),
    'by_department', coalesce((select jsonb_agg(to_jsonb(d) order by d.earned desc) from by_department d), '[]'::jsonb),
    'by_branch', coalesce((select jsonb_agg(to_jsonb(b) order by b.earned desc) from by_branch b), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(to_jsonb(m) order by m.month) from by_month m), '[]'::jsonb),
    'by_admin', coalesce((select jsonb_agg(to_jsonb(a) order by a.operations desc) from by_admin a), '[]'::jsonb),
    'top_earners', coalesce((select jsonb_agg(to_jsonb(e) order by e.amount desc)
                               from (select * from top_earners order by amount desc limit 20) e), '[]'::jsonb),
    'top_spenders', coalesce((select jsonb_agg(to_jsonb(s) order by s.amount desc)
                               from (select * from top_spenders order by amount desc limit 20) s), '[]'::jsonb),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

/**
 * Полная история операций для выгрузки — со всеми связями, которых
 * не хватало HR: сотрудник, подразделение, филиал, причина и её категория,
 * товар и его категория, кто провёл операцию.
 *
 * Отдаётся постранично, чтобы выгрузка любого объёма шла предсказуемо.
 */
create or replace function wallet_ledger(
  p_from   date default null,
  p_to     date default null,
  p_limit  integer default 1000,
  p_offset integer default 0
)
returns table (
  date          date,
  employee_name text,
  department    text,
  branch        text,
  direction     text,
  amount        integer,
  type          text,
  reason_code   text,
  reason_title  text,
  reason_category text,
  item_name     text,
  item_category text,
  admin_name    text,
  operation_id  uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.date,
    coalesce(e.name, w.employee_name, '—'),
    coalesce(d.name, e.department, 'Не указан'),
    coalesce(b.city, e.branch, 'Не указан'),
    case when w.amount >= 0 then 'Начисление' else 'Списание' end,
    w.amount,
    w.type::text,
    w.reason_code,
    coalesce(ar.title, w.reason, '—'),
    coalesce(ar.category, 'other'),
    coalesce(w.item_name, so.item_name),
    coalesce(si.category, 'Без категории'),
    w.admin_name,
    w.id
  from wallet_transactions w
  left join employees   e  on e.id = w.employee_id
  left join departments d  on d.id = coalesce(w.department_id, e.department_id)
  left join branches    b  on b.id = coalesce(w.branch_id, e.branch_id)
  left join award_reasons ar on ar.code = w.reason_code
  left join store_orders  so on so.transaction_id = w.id
  left join store_items   si on si.id = coalesce(w.item_id, so.item_id)
  where is_hr()
    and (p_from is null or w.date >= p_from)
    and (p_to   is null or w.date <= p_to)
  order by w.date desc, w.created_date desc
  limit greatest(least(p_limit, 5000), 1)
  offset greatest(p_offset, 0);
$$;

/** Сколько всего операций попадает в выгрузку — чтобы показать прогресс. */
create or replace function wallet_ledger_count(
  p_from date default null,
  p_to   date default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
    from wallet_transactions w
   where is_hr()
     and (p_from is null or w.date >= p_from)
     and (p_to   is null or w.date <= p_to);
$$;

-- --------------------------------------------------------------- права

revoke all on function
  wallet_analytics(date, date),
  wallet_ledger(date, date, integer, integer),
  wallet_ledger_count(date, date)
from public, anon;

grant execute on function
  wallet_analytics(date, date),
  wallet_ledger(date, date, integer, integer),
  wallet_ledger_count(date, date)
to authenticated;

-- Индексы под отчётность: без них выборка по датам на большой истории
-- начнёт сканировать таблицу целиком.
create index if not exists wallet_tx_date_amount_idx on wallet_transactions (date, amount);
create index if not exists wallet_tx_reason_idx      on wallet_transactions (reason_code) where reason_code is not null;
create index if not exists store_orders_created_idx  on store_orders (created_date desc);
create index if not exists store_orders_tx_idx       on store_orders (transaction_id);
