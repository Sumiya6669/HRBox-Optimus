-- =====================================================================
-- Миграция 0017: исправление ошибки входа «Database error querying schema».
--
-- ЧТО СЛОМАЛОСЬ. Миграция 0016 создаёт учётную запись прямой вставкой в
-- auth.users. Часть служебных колонок она не заполняла, и они оставались NULL:
-- confirmation_token, recovery_token, email_change, email_change_token_new и
-- соседние. В схеме Supabase у них НЕТ значения по умолчанию.
--
-- Сервис аутентификации (GoTrue) написан на Go и читает эти колонки в обычные
-- строки, которые NULL принимать не умеют. Запрос падает ещё до проверки пароля,
-- и наружу приходит невнятное «Database error querying schema» — про пароль или
-- почту там ни слова, хотя с ними всё в порядке.
--
-- Здесь две части: чиним уже созданные записи и правим саму функцию, чтобы
-- новые заводились сразу правильно.
-- =====================================================================

-- --------------------------------------------------- часть 1: чиним записи
--
-- Проходим по колонкам списком и проверяем, есть ли каждая в схеме: состав
-- полей auth.users отличается между версиями Supabase, и жёсткий UPDATE сломал
-- бы миграцию на проекте с другой версией.

do $$
declare
  v_col  text;
  v_cols text[] := array[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ];
  v_fixed integer;
begin
  foreach v_col in array v_cols loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = v_col
    ) then
      execute format('update auth.users set %I = %L where %I is null', v_col, '', v_col);
      get diagnostics v_fixed = row_count;
      if v_fixed > 0 then
        raise notice 'auth.users.%: исправлено записей — %', v_col, v_fixed;
      end if;
    end if;
  end loop;

  -- Числовое поле статуса смены почты: тоже не принимает NULL при чтении.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'
       and column_name = 'email_change_confirm_status'
  ) then
    update auth.users set email_change_confirm_status = 0
     where email_change_confirm_status is null;
  end if;
end $$;

-- ------------------------------------------- часть 2: правим саму функцию

create or replace function admin_create_user(
  p_email         text,
  p_password      text,
  p_full_name     text,
  p_role          app_role default 'employee',
  p_position      text default null,
  p_phone         text default null,
  p_department_id uuid default null,
  p_branch_id     uuid default null,
  p_hire_date     date default null,
  p_employee_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email    text := lower(trim(p_email));
  v_name     text := trim(coalesce(p_full_name, ''));
  v_user_id  uuid := gen_random_uuid();
  v_employee uuid := p_employee_id;
  v_occupied text;
  v_actor    profiles%rowtype;
  v_col      text;
  v_has_provider_id boolean;
  v_has_identity_id boolean;
begin
  ------------------------------------------------------------------ проверки
  if not is_admin() then
    raise exception 'Создавать пользователей может только администратор'
      using errcode = '42501';
  end if;

  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Укажите корректный email' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Пароль должен содержать минимум 8 символов' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Укажите ФИО' using errcode = '22023';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Пользователь с таким email уже существует' using errcode = '23505';
  end if;

  ------------------------------------------------------- карточка сотрудника
  -- Карточка нужна, иначе личный кабинет пустой: KPI, цели, отпуск и
  -- уведомления привязаны к employee_id, а не к учётной записи.
  if v_employee is null then
    select e.id into v_employee from employees e where lower(e.email) = v_email;
  end if;

  if v_employee is not null then
    -- profiles.employee_id уникален. Без этой проверки привязка занятой
    -- карточки упала бы невнятным «duplicate key», уже после создания учётки.
    select p.email into v_occupied from profiles p where p.employee_id = v_employee;
    if v_occupied is not null then
      raise exception 'Карточка сотрудника уже связана с учётной записью %', v_occupied
        using errcode = '23505';
    end if;
  else
    insert into employees (name, email, position, phone, department_id, branch_id, hire_date)
    values (v_name, v_email, nullif(trim(coalesce(p_position, '')), ''),
            nullif(trim(coalesce(p_phone, '')), ''), p_department_id, p_branch_id, p_hire_date)
    returning id into v_employee;
  end if;

  ------------------------------------------------------------ учётная запись
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', v_name),
    false
  );

  /*
   * ЗДЕСЬ БЫЛА ПРИЧИНА ОШИБКИ «Database error querying schema».
   *
   * У служебных колонок ниже нет значения по умолчанию, и после вставки они
   * оставались NULL. Сервис аутентификации читает их в обычные строки Go,
   * которые NULL не принимают: запрос падал ещё до проверки пароля, а человек
   * видел сообщение про схему базы и не понимал, при чём тут его вход.
   *
   * Заполняем пустыми строками — ровно так их создаёт сам GoTrue. Состав полей
   * между версиями Supabase отличается, поэтому идём по списку с проверкой.
   */
  foreach v_col in array array[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = v_col
    ) then
      execute format('update auth.users set %I = %L where id = $1 and %I is null', v_col, '', v_col)
        using v_user_id;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'
       and column_name = 'email_change_confirm_status'
  ) then
    update auth.users set email_change_confirm_status = 0
     where id = v_user_id and email_change_confirm_status is null;
  end if;

  -- Запись в identities обязательна: вход по паролю ищет пользователя именно
  -- там. Без неё учётка создастся, но войти по ней будет нельзя.
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'id'
  ) into v_has_identity_id;

  if v_has_provider_id and v_has_identity_id then
    execute $q$
      insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), $1,
              jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true,
                                 'phone_verified', false),
              'email', $1::text, null, now(), now())
    $q$ using v_user_id, v_email;
  elsif v_has_provider_id then
    execute $q$
      insert into auth.identities (user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      values ($1,
              jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true,
                                 'phone_verified', false),
              'email', $1::text, null, now(), now())
    $q$ using v_user_id, v_email;
  else
    execute $q$
      insert into auth.identities (id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values ($1::text, $1,
              jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true,
                                 'phone_verified', false),
              'email', null, now(), now())
    $q$ using v_user_id, v_email;
  end if;

  ----------------------------------------------------------------- профиль
  update profiles
     set role = p_role,
         full_name = v_name,
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         employee_id = v_employee
   where id = v_user_id;

  if not found then
    insert into profiles (id, email, full_name, phone, role, employee_id)
    values (v_user_id, v_email, v_name,
            nullif(trim(coalesce(p_phone, '')), ''), p_role, v_employee);
  end if;

  ------------------------------------------------------------------ журнал
  select * into v_actor from profiles where id = auth.uid();
  insert into audit_logs (user_id, user_name, user_email, action, entity_type, entity_id, description)
  values (auth.uid(), v_actor.full_name, v_actor.email, 'create', 'profiles', v_user_id::text,
          'Создан пользователь ' || v_email || ' с ролью ' || p_role::text);

  return jsonb_build_object(
    'user_id', v_user_id,
    'employee_id', v_employee,
    'email', v_email,
    'role', p_role
  );
end;
$$;

revoke all on function admin_create_user(text, text, text, app_role, text, text, uuid, uuid, date, uuid)
  from public, anon;
grant execute on function admin_create_user(text, text, text, app_role, text, text, uuid, uuid, date, uuid)
  to authenticated;

-- ---------------------------------------------------------------- проверка
--
-- Показывает, не осталось ли учёток, по которым вход будет падать.
-- Ноль в колонке broken — всё в порядке.

do $$
declare v_broken integer;
begin
  select count(*) into v_broken
    from auth.users
   where confirmation_token is null
      or recovery_token is null
      or email_change is null
      or email_change_token_new is null;

  if v_broken > 0 then
    raise warning 'Осталось учётных записей с незаполненными полями: %', v_broken;
  else
    raise notice 'Проверка пройдена: все учётные записи в порядке, вход работать будет.';
  end if;
end $$;
