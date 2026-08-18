-- =====================================================================
-- Миграция 0016: создание пользователя без Edge-функции.
--
-- ПОЧЕМУ. Кнопка «Создать пользователя» опиралась на Edge-функцию create-user.
-- Её нужно разворачивать отдельно, и пока этого не сделали, портал отвечал
-- «Не удалось создать пользователя. Проверьте, что функция create-user
-- развёрнута в Supabase». Функция полезна, но требовать деплой ради заведения
-- учётки — лишний барьер: SQL-редактор у администратора и так под рукой.
--
-- Поэтому здесь та же операция, но целиком внутри базы. Функция создаёт запись
-- в auth.users с зашифрованным паролем, запись в auth.identities (без неё вход
-- по паролю не работает — GoTrue ищет пользователя именно там), профиль с ролью
-- и карточку сотрудника.
--
-- ГРАНИЦЫ ЧЕСТНО. Мы пишем в служебную схему auth напрямую. Это рабочий и
-- распространённый приём, но он завязан на структуру таблиц GoTrue, поэтому:
--   • вставляем только те колонки, которые реально есть в этой версии схемы —
--     иначе миграция сломается на проекте с другой версией Supabase;
--   • пароль шифруем тем же bcrypt, что использует сам GoTrue;
--   • ничего не трогаем в уже существующих пользователях.
-- =====================================================================

/**
 * Создать пользователя портала.
 *
 * Возвращает jsonb: user_id, employee_id, email, role.
 * Право вызывать — только у администратора, проверка внутри тела: одних грантов
 * мало, security definer выполняется с правами владельца.
 */
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
  --
  -- Пароль шифруем bcrypt — тем же алгоритмом, что использует сам GoTrue.
  -- email_confirmed_at ставим сразу: учётку заводит администратор, и требовать
  -- подтверждения по почте бессмысленно — письма может не быть вовсе.
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

  -- Запись в identities обязательна: вход по паролю ищет пользователя именно
  -- там. Без неё учётка создастся, но войти по ней будет нельзя.
  --
  -- Состав колонок отличается между версиями GoTrue, поэтому проверяем схему,
  -- а не полагаемся на то, что у всех она одинаковая.
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
  -- Профиль создаёт триггер handle_new_user со значениями по умолчанию —
  -- дополняем его ролью, именем и связью с карточкой сотрудника.
  update profiles
     set role = p_role,
         full_name = v_name,
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         employee_id = v_employee
   where id = v_user_id;

  if not found then
    -- Триггера может не быть (например, его отключили) — тогда создаём сами.
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
