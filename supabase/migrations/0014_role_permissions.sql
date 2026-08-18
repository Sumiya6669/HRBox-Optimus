-- =====================================================================
-- Миграция 0014: настраиваемые права доступа к разделам портала.
--
-- До сих пор доступ был зашит в код: маршрут «для HR», пункт меню «для
-- администратора». Чтобы закрыть или открыть раздел, требовалась правка кода и
-- деплой. Теперь администратор включает и выключает разделы прямо в интерфейсе.
--
-- ЧЕСТНО О ГРАНИЦАХ. Эта таблица управляет тем, какие разделы ВИДНЫ и куда
-- пускает роутер. Она НЕ заменяет RLS: право читать зарплаты или чужие заявки
-- по-прежнему решают политики на таблицах. Так и должно быть — доступ к данным
-- нельзя закрывать настройкой интерфейса, её слишком легко обойти запросом
-- напрямую. Это слой удобства поверх слоя безопасности, а не вместо него.
-- =====================================================================

create table if not exists role_permissions (
  role         app_role not null,
  section_key  text     not null,
  allowed      boolean  not null default true,
  updated_by   uuid     references profiles(id) on delete set null,
  updated_date timestamptz not null default now(),
  primary key (role, section_key)
);

comment on table role_permissions is
  'Доступ ролей к разделам портала. Управляет видимостью разделов, не заменяет RLS.';

alter table role_permissions enable row level security;
alter table role_permissions force row level security;

-- Читать должны все вошедшие: клиент запрашивает права своей роли при загрузке.
-- Скрывать сам список разделов бессмысленно — он и так виден в коде интерфейса.
drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions
  for select using (is_authenticated());

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions
  using (is_admin()) with check (is_admin());

/**
 * Защита от самоблокировки.
 *
 * Администратор, случайно снявший себе галочку с «Пользователи» или «Права
 * доступа», потеряет единственный способ вернуть их обратно — и починить это
 * можно будет только через SQL-редактор. Поэтому эти разделы для роли admin
 * не выключаются вовсе.
 */
create or replace function guard_admin_sections()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'admin'
     and new.section_key in ('admin.users', 'admin.permissions', 'admin.settings')
     and new.allowed = false then
    raise exception 'Нельзя закрыть администратору раздел «%»: иначе права будет не вернуть', new.section_key
      using errcode = '23514';
  end if;
  new.updated_date := now();
  return new;
end;
$$;

drop trigger if exists trg_role_permissions_guard on role_permissions;
create trigger trg_role_permissions_guard
  before insert or update on role_permissions
  for each row execute function guard_admin_sections();

-- Построчного аудита здесь сознательно НЕТ.
--
-- Сохранение матрицы — это 46 строк на роль. Построчный триггер писал бы 46
-- записей в журнал за одно нажатие «Сохранить», причём с пустым entity_id:
-- у таблицы составной ключ, а audit_trigger читает поле id. Журнал перестал бы
-- читаться именно тогда, когда он нужен — при разборе «кто закрыл мне раздел».
-- Вместо этого set_role_permissions пишет одну запись со списком изменений.

/**
 * Права текущего пользователя — один запрос вместо чтения всей таблицы.
 *
 * Отсутствие строки означает «по умолчанию», а не «запрещено»: иначе после
 * добавления нового раздела в код он оказался бы закрыт для всех, включая
 * администратора, до первого сохранения настроек.
 */
create or replace function my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(rp.section_key, rp.allowed),
    '{}'::jsonb
  )
  from role_permissions rp
  where rp.role = auth_role();
$$;

/**
 * Массовое сохранение прав одной роли.
 *
 * Отдельная функция, а не набор upsert'ов с клиента: сохранение матрицы должно
 * быть одной транзакцией. Иначе оборвавшийся на середине запрос оставит роль в
 * состоянии «половина разделов по-новому, половина по-старому», и понять, что
 * именно применилось, будет невозможно.
 *
 * p_sections — объект вида {"admin.users": true, "cabinet.kpi": false}.
 */
create or replace function set_role_permissions(p_role app_role, p_sections jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_profile profiles%rowtype;
  v_changes jsonb;
begin
  if not is_admin() then
    raise exception 'Изменять права доступа может только администратор'
      using errcode = '42501';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'Ожидался объект с разделами' using errcode = '22023';
  end if;

  -- Что реально меняется — считаем ДО записи, иначе в журнал попадёт «изменено
  -- 46 разделов» на каждое сохранение, и найти нужное изменение будет нельзя.
  select jsonb_object_agg(
           t.key,
           jsonb_build_object('from', rp.allowed, 'to', (t.value::text)::boolean)
         )
    into v_changes
    from jsonb_each_text(p_sections) as t(key, value)
    left join role_permissions rp
      on rp.role = p_role and rp.section_key = t.key
   where rp.allowed is distinct from (t.value::text)::boolean;

  insert into role_permissions (role, section_key, allowed, updated_by)
  select p_role, key, (value::text)::boolean, v_actor
    from jsonb_each_text(p_sections) as t(key, value)
  on conflict (role, section_key)
    do update set allowed = excluded.allowed,
                  updated_by = excluded.updated_by,
                  updated_date = now();

  if v_changes is not null and v_changes <> '{}'::jsonb then
    select * into v_profile from profiles where id = v_actor;
    insert into audit_logs (user_id, user_name, user_email, action, entity_type, entity_id, description, changes)
    values (
      v_actor,
      v_profile.full_name,
      v_profile.email,
      'update',
      'role_permissions',
      p_role::text,
      'Изменены права роли «' || p_role::text || '»: разделов — '
        || (select count(*) from jsonb_object_keys(v_changes)),
      v_changes
    );
  end if;

  return jsonb_build_object(
    'role', p_role,
    'changed', coalesce((select count(*) from jsonb_object_keys(v_changes)), 0)
  );
end;
$$;

-- --------------------------------------------------------------- права
revoke all on function my_permissions(), set_role_permissions(app_role, jsonb) from public, anon;
grant execute on function my_permissions(), set_role_permissions(app_role, jsonb) to authenticated;

-- --------------------------------------------------- значения по умолчанию
--
-- Заполняем матрицу так, как доступ работал до этой миграции: сотрудник видит
-- личный кабинет, HR — администрирование, администратор — всё. Без этого шага
-- первый вход в новый экран показал бы пустую таблицу, и было бы неясно,
-- «ничего не настроено» или «всё закрыто».

insert into role_permissions (role, section_key, allowed)
select r.role, s.key, r.allowed
from (values
  -- ключ раздела, employee, manager, hr, admin
  ('company.home',            true,  true,  true,  true),
  ('cabinet.dashboard',       true,  true,  true,  true),
  ('cabinet.requests',        true,  true,  true,  true),
  ('cabinet.processes',       true,  true,  true,  true),
  ('cabinet.goals',           true,  true,  true,  true),
  ('cabinet.kpi',             true,  true,  true,  true),
  ('cabinet.development',     true,  true,  true,  true),
  ('cabinet.vacation',        true,  true,  true,  true),
  ('cabinet.learning',        true,  true,  true,  true),
  ('cabinet.library',         true,  true,  true,  true),
  ('cabinet.documents',       true,  true,  true,  true),
  ('cabinet.files',           true,  true,  true,  true),
  ('cabinet.news',            true,  true,  true,  true),
  ('cabinet.calendar',        true,  true,  true,  true),
  ('cabinet.surveys',         true,  true,  true,  true),
  ('cabinet.feedback',        true,  true,  true,  true),
  ('cabinet.wallet',          true,  true,  true,  true),
  ('cabinet.store',           true,  true,  true,  true),
  ('cabinet.favorites',       true,  true,  true,  true),
  ('cabinet.notifications',   true,  true,  true,  true),
  ('cabinet.profile',         true,  true,  true,  true),
  ('admin.overview',          false, false, true,  true),
  ('admin.employees',         false, false, true,  true),
  ('admin.departments',       false, false, true,  true),
  ('admin.users',             false, false, false, true),
  ('admin.permissions',       false, false, false, true),
  ('admin.news',              false, false, true,  true),
  ('admin.pages',             false, false, true,  true),
  ('admin.files',             false, false, true,  true),
  ('admin.courses',           false, false, true,  true),
  ('admin.library',           false, false, true,  true),
  ('admin.processes',         false, false, true,  true),
  ('admin.process_requests',  false, false, true,  true),
  ('admin.achievements',      false, false, true,  true),
  ('admin.achievement_rules', false, false, true,  true),
  ('admin.store',             false, false, true,  true),
  ('admin.wallet',            false, false, true,  true),
  ('admin.wallet_reports',    false, false, true,  true),
  ('admin.award_reasons',     false, false, true,  true),
  ('admin.surveys',           false, false, true,  true),
  ('admin.survey_sessions',   false, false, true,  true),
  ('admin.survey_auto',       false, false, true,  true),
  ('admin.survey_reports',    false, false, true,  true),
  ('admin.vacation',          false, false, true,  true),
  ('admin.settings',          false, false, false, true),
  ('admin.audit',             false, false, false, true)
) as s(key, employee, manager, hr, admin)
cross join lateral (values
  ('employee'::app_role, s.employee),
  ('manager'::app_role,  s.manager),
  ('hr'::app_role,       s.hr),
  ('admin'::app_role,    s.admin)
) as r(role, allowed)
on conflict (role, section_key) do nothing;
