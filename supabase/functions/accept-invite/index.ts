// Edge-функция: регистрация по ссылке-приглашению.
//
// verify_jwt = false осознанно: функцию вызывает человек, который ещё не
// зарегистрирован. Аутентификация — одноразовый токен из ссылки, который
// сверяется с хешем в базе и гасится после первого использования.
//
// Создать пользователя и назначить роль можно только service_role-ключом,
// поэтому шаг вынесен на сервер. Роль берётся из приглашения, а не из запроса,
// иначе по ссылке можно было бы зарегистрироваться администратором.
//
// Каждый шаг логируется: без этого при отказе в логах Supabase видны только
// booted/shutdown и причину приходится угадывать.

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

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    console.log('accept-invite: старт');

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      console.error('accept-invite: нет SUPABASE_URL или SERVICE_ROLE_KEY');
      return json({ error: 'Функция не настроена: отсутствуют ключи окружения' }, 500);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch (e) {
      console.error('accept-invite: тело запроса не разобрано', String(e));
      return json({ error: 'Некорректный запрос' }, 400);
    }

    const token = String(payload.token ?? '');
    const password = String(payload.password ?? '');
    const fullName = payload.full_name ? String(payload.full_name) : null;

    if (!token || token.length < 32) return json({ error: 'Ссылка-приглашение недействительна' }, 400);
    if (password.length < 8) return json({ error: 'Пароль должен содержать минимум 8 символов' }, 400);

    console.log('accept-invite: проверяем приглашение');
    const { data: check, error: checkError } = await admin.rpc('check_invitation', { p_token: token });
    if (checkError) {
      console.error('accept-invite: check_invitation упала', JSON.stringify(checkError));
      return json({ error: 'Не удалось проверить приглашение: ' + checkError.message }, 400);
    }
    if (!check?.valid) {
      const reasons: Record<string, string> = {
        not_found: 'Ссылка-приглашение не найдена',
        used: 'По этой ссылке уже зарегистрировались',
        expired: 'Срок действия ссылки истёк',
        revoked: 'Приглашение отозвано',
      };
      return json({ error: reasons[String(check?.reason)] || 'Ссылка недействительна' }, 400);
    }

    // Если приглашение выписано на конкретный адрес, менять его нельзя.
    const targetEmail = String(check.email ?? payload.email ?? '').trim().toLowerCase();
    if (!targetEmail) return json({ error: 'Укажите рабочий email' }, 400);

    console.log('accept-invite: создаём пользователя', targetEmail);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: targetEmail,
      password,
      email_confirm: true, // адрес подтверждён самим фактом передачи ссылки
      user_metadata: { full_name: fullName || check.full_name || null },
    });

    if (createError) {
      console.error('accept-invite: createUser упала', JSON.stringify(createError));
      const raw = createError.message ?? '';
      const msg = /already been registered|already registered|duplicate/i.test(raw)
        ? 'Пользователь с таким email уже зарегистрирован. Войдите или восстановите пароль.'
        : 'Не удалось создать учётную запись: ' + raw;
      return json({ error: msg }, 400);
    }

    const userId = created?.user?.id;
    if (!userId) {
      console.error('accept-invite: createUser вернула пустого пользователя');
      return json({ error: 'Не удалось создать учётную запись' }, 500);
    }

    console.log('accept-invite: гасим приглашение');
    const { error: redeemError } = await admin.rpc('redeem_invitation', {
      p_token: token,
      p_user_id: userId,
    });

    if (redeemError) {
      console.error('accept-invite: redeem_invitation упала', JSON.stringify(redeemError));
      // Откат: иначе останется учётка без роли и с потраченной ссылкой.
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return json({ error: 'Не удалось активировать приглашение: ' + redeemError.message }, 400);
    }

    console.log('accept-invite: готово', targetEmail);
    return json({ ok: true, email: targetEmail });
  } catch (e) {
    console.error('accept-invite: неожиданное исключение', String(e), (e as Error)?.stack);
    return json({ error: 'Внутренняя ошибка: ' + String((e as Error)?.message ?? e) }, 500);
  }
});
