-- =====================================================================
-- Миграция 0018: смена роли пользователя без Edge-функции.
--
-- ПОЧЕМУ. Кнопка смены роли ходила в Edge-функцию set-user-role. Она не
-- развёрнута, и портал отвечал «Failed to send a request to the Edge Function» —
-- сообщением от библиотеки, из которого вообще не следует, что именно делать.
--
-- Это та же история, что и с созданием пользователя: требовать отдельный деплой
-- ради операции над строкой в таблице — лишний барьер. Переносим в базу.
--
-- ПОЧЕМУ НЕ ПРОСТОЙ UPDATE ИЗ БРАУЗЕРА. Политика profiles_write разрешает
-- админу писать в таблицу, и формально роль можно было бы поменять напрямую.
-- Но тогда рядом с изменением не окажется ни проверки «кто меняет», ни записи
-- в журнал, ни понятных сообщений об отказе — а роль это самое чувствительное
-- поле в системе. Поэтому отдельная функция с проверками внутри.
-- =====================================================================

/**
 * Сменить роль пользователя.
 *
 * Возвращает jsonb: id, email, role (новая), previous_role.
 */
create or replace function admin_set_role(p_user_id uuid, p_role app_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target profiles%rowtype;
  v_actor  profiles%rowtype;
  v_admins integer;
begin
  ------------------------------------------------------------------ проверки
  -- Право проверяем ВНУТРИ тела: security definer выполняется с правами
  -- владельца, и одних грантов на выполнение здесь недостаточно.
  if not is_admin() then
    raise exception 'Изменять роли может только администратор' using errcode = '42501';
  end if;

  select * into v_target from profiles where id = p_user_id;
  if v_target.id is null then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;

  if v_target.role = p_role then
    -- Не ошибка, но и не изменение: возвращаем как есть, не засоряя журнал.
    return jsonb_build_object(
      'id', v_target.id, 'email', v_target.email,
      'role', v_target.role, 'previous_role', v_target.role, 'changed', false
    );
  end if;

  /*
   * Защита от самоблокировки.
   *
   * Триггер guard_last_admin не даёт снять роль с ПОСЛЕДНЕГО администратора, но
   * его сообщение приходит уже из недр базы. Здесь ловим более частый и более
   * обидный случай раньше: администратор понижает роль сам себе и мгновенно
   * теряет доступ к разделу, где эту роль можно вернуть. Чинить такое пришлось
   * бы через SQL-редактор — один раз в этом проекте так уже случилось.
   */
  if p_user_id = auth.uid() and p_role <> 'admin' then
    select count(*) into v_admins from profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception 'Вы единственный администратор — снять с себя роль нельзя, иначе доступ будет не вернуть'
        using errcode = '22023';
    end if;
    raise exception 'Нельзя понизить роль самому себе. Попросите другого администратора'
      using errcode = '22023';
  end if;

  ------------------------------------------------------------------ изменение
  update profiles set role = p_role where id = p_user_id;

  ------------------------------------------------------------------- журнал
  select * into v_actor from profiles where id = auth.uid();
  insert into audit_logs (user_id, user_name, user_email, action, entity_type, entity_id, description, changes)
  values (
    auth.uid(), v_actor.full_name, v_actor.email, 'update', 'profiles', p_user_id::text,
    'Роль ' || coalesce(v_target.email, p_user_id::text)
      || ': ' || v_target.role::text || ' → ' || p_role::text,
    jsonb_build_object('role', jsonb_build_object('from', v_target.role, 'to', p_role))
  );

  return jsonb_build_object(
    'id', p_user_id,
    'email', v_target.email,
    'role', p_role,
    'previous_role', v_target.role,
    'changed', true
  );
end;
$$;

revoke all on function admin_set_role(uuid, app_role) from public, anon;
grant execute on function admin_set_role(uuid, app_role) to authenticated;
