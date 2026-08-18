// Edge-функция: создание учётной записи администратором вручную.
//
// Зачем отдельно от приглашений. Приглашение по почте требует настроенного SMTP,
// приглашение по ссылке требует, чтобы человек сам её открыл и придумал пароль.
// Ни то ни другое не подходит, когда учётку надо завести здесь и сейчас — новому
// сотруднику на месте, кладовщику без рабочей почты, или сразу пачке людей.
// Тогда администратор задаёт логин и пароль сам и передаёт их лично.
//
// Создать пользователя можно только service_role-ключом, поэтому шаг на сервере.
// Ключ живёт ТОЛЬКО здесь и никогда не попадает в клиентский бандл.
//
// Роль берётся из тела запроса, но право её назначать проверяется по роли
// вызывающего в таблице profiles — иначе любой, кто подберёт адрес функции,
// заведёт себе администратора.

import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * CORS отражает заголовки, которые браузер спрашивает в preflight.
 *
 * Жёсткий список был ошибкой: supabase-js добавлял к запросам свой заголовок
 * x-application-name, его в списке не было, и браузер резал запрос ещё до
 * отправки — функция даже не вызывалась.
 */
function corsHeaders(req: Request) {
  const requested = req.headers.get('access-control-request-headers');
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      requested || 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

const ALLOWED_ROLES = ['employee', 'manager', 'hr', 'admin'];

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Всё, что создано до сбоя, надо убрать: иначе останется учётка без профиля
  // или сотрудник без учётки, и администратор не поймёт, что пошло не так.
  let createdUserId: string | null = null;
  let createdEmployeeId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) {
      console.error('create-user: не настроены ключи окружения');
      return json({ error: 'Функция не настроена: отсутствуют ключи окружения' }, 500);
    }

    // Клиент от имени вызывающего — чтобы узнать, кто он.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user: callerUser } } = await caller.auth.getUser();
    if (!callerUser) return json({ error: 'Требуется вход в систему' }, 401);

    admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: callerProfile } = await admin
      .from('profiles').select('role, full_name').eq('id', callerUser.id).maybeSingle();
    if (!callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Создавать пользователей может только администратор' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'employee');
    const position = body.position ? String(body.position).trim() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const departmentId = body.department_id ? String(body.department_id) : null;
    const branchId = body.branch_id ? String(body.branch_id) : null;
    const hireDate = body.hire_date ? String(body.hire_date) : null;
    const employeeId = body.employee_id ? String(body.employee_id) : null;
    const createEmployee = body.create_employee !== false;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Укажите корректный email' }, 400);
    if (password.length < 8) return json({ error: 'Пароль должен содержать минимум 8 символов' }, 400);
    if (!fullName) return json({ error: 'Укажите ФИО' }, 400);
    if (!ALLOWED_ROLES.includes(role)) return json({ error: 'Недопустимая роль' }, 400);

    console.log('create-user: создаём', email, role);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      // Адрес подтверждён самим фактом того, что учётку заводит администратор:
      // иначе человек не сможет войти, пока не найдёт письмо, которого может и не быть.
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError) {
      const raw = createError.message ?? '';
      const msg = /already been registered|already registered|duplicate/i.test(raw)
        ? 'Пользователь с таким email уже существует'
        : 'Не удалось создать учётную запись: ' + raw;
      return json({ error: msg }, 400);
    }

    createdUserId = created?.user?.id ?? null;
    if (!createdUserId) return json({ error: 'Не удалось создать учётную запись' }, 500);

    // Карточка сотрудника. Без неё личный кабинет пустой: KPI, цели, отпуск и
    // уведомления привязаны к employee_id, а не к учётной записи.
    let linkedEmployeeId: string | null = employeeId;

    if (!linkedEmployeeId && createEmployee) {
      const { data: existing } = await admin
        .from('employees').select('id').eq('email', email).maybeSingle();

      if (existing) {
        // Карточка уже есть — переиспользуем, но только если она свободна.
        // profiles.employee_id уникален: привязка занятой карточки упала бы
        // на уровне базы с невнятным «duplicate key», и администратор не понял
        // бы, что учётка на самом деле создалась.
        const { data: occupied } = await admin
          .from('profiles').select('id, email').eq('employee_id', existing.id).maybeSingle();
        if (occupied) {
          throw new Error(
            `Карточка сотрудника с адресом ${email} уже связана с учётной записью ${occupied.email}. ` +
            'Отвяжите её или укажите другой email.'
          );
        }
        linkedEmployeeId = existing.id;
      } else {
        const { data: emp, error: empError } = await admin
          .from('employees')
          .insert({
            name: fullName,
            email,
            position,
            phone,
            department_id: departmentId,
            branch_id: branchId,
            hire_date: hireDate,
          })
          .select('id')
          .single();
        if (empError) {
          console.error('create-user: не удалось создать сотрудника', JSON.stringify(empError));
          throw new Error('Учётная запись создана, но карточку сотрудника завести не удалось: ' + empError.message);
        }
        createdEmployeeId = emp.id;
        linkedEmployeeId = emp.id;
      }
    }

    // Профиль создаёт триггер handle_new_user со значениями по умолчанию —
    // дополняем его ролью, именем и связью с карточкой сотрудника.
    //
    // Проверяем, что строка ДЕЙСТВИТЕЛЬНО обновилась. update() без совпадений
    // не считается ошибкой — вернулся бы «ok», а роль осталась бы employee по
    // умолчанию. Такую тихую подмену заметили бы только когда человек не смог
    // попасть в нужный раздел.
    const { data: updatedProfile, error: profileError } = await admin
      .from('profiles')
      .update({ role, full_name: fullName, phone, employee_id: linkedEmployeeId })
      .eq('id', createdUserId)
      .select('id, role')
      .maybeSingle();

    if (profileError) {
      console.error('create-user: не удалось обновить профиль', JSON.stringify(profileError));
      throw new Error('Не удалось назначить роль: ' + profileError.message);
    }
    if (!updatedProfile) {
      throw new Error('Профиль пользователя не создан — роль назначить не удалось');
    }

    await admin.from('audit_logs').insert({
      user_id: callerUser.id,
      user_name: callerProfile.full_name ?? callerUser.email,
      user_email: callerUser.email,
      action: 'create',
      entity_type: 'profiles',
      entity_id: createdUserId,
      description: `Создан пользователь ${email} с ролью ${role}`,
    });

    console.log('create-user: готово', email);
    return json({
      ok: true,
      user_id: createdUserId,
      employee_id: linkedEmployeeId,
      email,
      role,
    });
  } catch (e) {
    // Откат. Профиль удалится каскадом вместе с учётной записью.
    if (admin && createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
    if (admin && createdEmployeeId) {
      await admin.from('employees').delete().eq('id', createdEmployeeId).then(() => {}, () => {});
    }
    const message = (e as Error)?.message ?? String(e);
    console.error('create-user: исключение', message, (e as Error)?.stack);
    return json({ error: message }, 400);
  }
});
