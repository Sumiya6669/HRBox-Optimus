-- =====================================================================
-- Миграция 0012: защита ролей от случайного понижения.
--
-- ПРИЧИНА. redeem_invitation принимала любой user_id и переписывала профилю
-- роль из приглашения. При проверке механики приглашений функция была вызвана
-- с id действующего администратора портала — и он был понижен до сотрудника.
-- Функция отработала ровно так, как написана; не хватало проверки, что
-- приглашение применяется к НОВОЙ учётной записи.
--
-- Две независимые преграды:
--   1) приглашение применимо только к учётке, которая ещё ни разу не входила
--      и имеет базовую роль employee;
--   2) роль последнего администратора нельзя снять вообще ничем —
--      ни функцией, ни ручным UPDATE в SQL Editor.
-- =====================================================================

create or replace function redeem_invitation(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv     invitations%rowtype;
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;

  -- Приглашение рассчитано на новую учётку. Если человек уже входил в портал
  -- либо уже имеет повышенную роль — это существующий пользователь,
  -- и менять ему права по ссылке нельзя.
  if v_profile.last_login is not null then
    raise exception 'Учётная запись уже активна: приглашение к ней неприменимо'
      using errcode = '22023';
  end if;
  if v_profile.role <> 'employee' then
    raise exception 'У учётной записи уже назначена роль «%» — понижение по приглашению запрещено', v_profile.role
      using errcode = '22023';
  end if;

  select * into v_inv from invitations
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
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

revoke all on function redeem_invitation(text, uuid) from public, anon, authenticated;
grant execute on function redeem_invitation(text, uuid) to service_role;

/**
 * Последний администратор не может лишиться роли: иначе портал остаётся
 * без доступа к управлению пользователями и настройками, и вернуть его
 * можно будет только вручную через SQL.
 */
create or replace function guard_last_admin()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from profiles where role = 'admin') <= 1 then
    raise exception 'Нельзя снять роль администратора с последней такой учётной записи'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_last_admin on profiles;
create trigger trg_profiles_guard_last_admin
  before update of role on profiles
  for each row execute function guard_last_admin();
