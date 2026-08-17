-- =====================================================================
-- Миграция 0011: приглашение пользователей по ссылке.
--
-- Почему ссылка, а не письмо: встроенный SMTP Supabase ограничен несколькими
-- письмами в час и для продакшена не предназначен, а свой почтовый сервис
-- подключён не всегда. Ссылку HR может передать любым каналом — в мессенджере,
-- на бумаге при оформлении, лично.
--
-- Токен одноразовый и с ограниченным сроком: пока он не использован и не истёк,
-- по нему можно один раз завести учётную запись с заранее заданной ролью.
-- =====================================================================

create table if not exists invitations (
  id           uuid primary key default gen_random_uuid(),
  -- Сам токен в базе не хранится в открытом виде: только его SHA-256.
  -- Утечка таблицы не даёт возможности воспользоваться приглашениями.
  token_hash   text not null unique,
  email        text,                       -- если задан, ссылка сработает только для него
  role         app_role not null default 'employee',
  employee_id  uuid references employees (id) on delete set null,
  full_name    text,
  note         text,
  expires_at   timestamptz not null default now() + interval '14 days',
  used_at      timestamptz,
  used_by      uuid references profiles (id) on delete set null,
  revoked_at   timestamptz,
  created_by   uuid references profiles (id) on delete set null,
  created_date timestamptz not null default now()
);

create index if not exists invitations_active_idx
  on invitations (expires_at) where used_at is null and revoked_at is null;

drop trigger if exists trg_invitations_audit on invitations;
create trigger trg_invitations_audit after insert or update or delete on invitations
  for each row execute function audit_trigger();

-- ------------------------------------------------------ создание ссылки

/**
 * Создаёт приглашение и возвращает ОТКРЫТЫЙ токен — единственный раз, при создании.
 * Дальше в базе лежит только хеш, поэтому «подсмотреть» ссылку позже нельзя,
 * можно лишь выпустить новую.
 */
create or replace function create_invitation(
  p_email     text default null,
  p_role      app_role default 'employee',
  p_full_name text default null,
  p_days      integer default 14,
  p_employee_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if not is_admin() then
    raise exception 'Приглашать пользователей может только администратор' using errcode = '42501';
  end if;
  if p_email is not null and exists (select 1 from profiles where lower(email) = lower(p_email)) then
    raise exception 'Пользователь с таким email уже зарегистрирован' using errcode = '23505';
  end if;

  -- 32 случайных байта → 64 hex-символа. Подобрать перебором нереально.
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into invitations (token_hash, email, role, full_name, employee_id, expires_at, created_by)
  values (
    encode(digest(v_token, 'sha256'), 'hex'),
    nullif(btrim(lower(coalesce(p_email, ''))), ''),
    p_role,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    p_employee_id,
    now() + make_interval(days => greatest(least(p_days, 90), 1)),
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token,
                            'expires_at', (select expires_at from invitations where id = v_id));
end;
$$;

/**
 * Проверка ссылки на странице приглашения — до входа в систему.
 * Отдаёт только то, что нужно нарисовать форму: валидность, email и роль.
 * Ни идентификаторов, ни хеша токена наружу не уходит.
 */
create or replace function check_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_inv invitations%rowtype;
begin
  select * into v_inv from invitations
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'used');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  return jsonb_build_object(
    'valid', true,
    'email', v_inv.email,
    'full_name', v_inv.full_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
end;
$$;

/**
 * Помечает приглашение использованным и выставляет роль созданному пользователю.
 * Вызывается Edge-функцией accept-invite под service_role уже ПОСЛЕ создания
 * учётной записи: роль из клиента прийти не может — иначе любой желающий
 * зарегистрировался бы администратором.
 */
create or replace function redeem_invitation(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_inv invitations%rowtype;
begin
  select * into v_inv from invitations
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and used_at is null and revoked_at is null and expires_at >= now()
   for update;

  if not found then
    raise exception 'Приглашение недействительно' using errcode = '22023';
  end if;

  update invitations set used_at = now(), used_by = p_user_id where id = v_inv.id;

  update profiles
     set role = v_inv.role,
         employee_id = coalesce(v_inv.employee_id, employee_id),
         full_name = coalesce(nullif(btrim(coalesce(full_name, '')), ''), v_inv.full_name)
   where id = p_user_id;

  insert into audit_logs (user_id, user_name, action, entity_type, entity_id, description)
  values (p_user_id, v_inv.full_name, 'invite', 'profiles', p_user_id::text,
          'Регистрация по приглашению, роль: ' || v_inv.role);

  return jsonb_build_object('role', v_inv.role, 'employee_id', v_inv.employee_id);
end;
$$;

/** Отзыв ещё не использованной ссылки. */
create or replace function revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Отзывать приглашения может только администратор' using errcode = '42501';
  end if;
  update invitations set revoked_at = now() where id = p_id and used_at is null;
end;
$$;

-- ------------------------------------------------------------- RLS

alter table invitations enable row level security;
alter table invitations force row level security;
revoke all on table invitations from anon;

-- Список приглашений видит администратор; токен в нём всё равно только хешем.
create policy invitations_admin on invitations
  for all using (is_admin()) with check (is_admin());

-- --------------------------------------------------------- гранты

revoke all on function
  create_invitation(text, app_role, text, integer, uuid),
  check_invitation(text),
  redeem_invitation(text, uuid),
  revoke_invitation(uuid)
from public, anon, authenticated;

grant execute on function
  create_invitation(text, app_role, text, integer, uuid),
  revoke_invitation(uuid)
to authenticated;

-- Проверка ссылки нужна ДО входа — единственная функция, доступная анониму.
-- Она отдаёт только email и роль приглашения и требует знания 64-символьного токена.
grant execute on function check_invitation(text) to anon, authenticated;

-- Гашение приглашения делает только сервер.
grant execute on function redeem_invitation(text, uuid) to service_role;
