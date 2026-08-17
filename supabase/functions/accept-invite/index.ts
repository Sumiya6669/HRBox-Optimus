// Edge-функция: регистрация по ссылке-приглашению.
//
// Создать пользователя и назначить ему роль можно только service_role-ключом,
// поэтому шаг вынесен на сервер. Клиент присылает лишь токен из ссылки и пароль;
// роль берётся из самого приглашения, а не из запроса, — иначе любой желающий
// зарегистрировался бы администратором.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { token, password, email, full_name } = await req.json();

    if (!token || typeof token !== 'string' || token.length < 32) {
      return json({ error: 'Ссылка-приглашение недействительна' }, 400);
    }
    if (!password || String(password).length < 8) {
      return json({ error: 'Пароль должен содержать минимум 8 символов' }, 400);
    }

    // Проверяем приглашение до создания пользователя.
    const { data: check, error: checkError } = await admin.rpc('check_invitation', { p_token: token });
    if (checkError) return json({ error: checkError.message }, 400);
    if (!check?.valid) {
      const reasons: Record<string, string> = {
        not_found: 'Ссылка-приглашение не найдена',
        used: 'По этой ссылке уже зарегистрировались',
        expired: 'Срок действия ссылки истёк',
        revoked: 'Приглашение отозвано',
      };
      return json({ error: reasons[check?.reason as string] || 'Ссылка недействительна' }, 400);
    }

    // Если приглашение выписано на конкретный адрес, менять его нельзя.
    const targetEmail = (check.email || email || '').trim().toLowerCase();
    if (!targetEmail) return json({ error: 'Укажите рабочий email' }, 400);
    if (check.email && check.email.toLowerCase() !== targetEmail) {
      return json({ error: 'Приглашение выписано на другой адрес' }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: targetEmail,
      password,
      email_confirm: true, // адрес подтверждён самим фактом передачи ссылки
      user_metadata: { full_name: full_name || check.full_name || null },
    });
    if (createError) {
      const msg = createError.message?.includes('already registered')
        ? 'Пользователь с таким email уже зарегистрирован'
        : createError.message;
      return json({ error: msg }, 400);
    }

    const userId = created?.user?.id;
    if (!userId) return json({ error: 'Не удалось создать учётную запись' }, 500);

    // Гасим приглашение и выставляем роль. Если шаг упал — удаляем созданного
    // пользователя, чтобы не осталось учётки без роли и с потраченной ссылкой.
    const { error: redeemError } = await admin.rpc('redeem_invitation', {
      p_token: token,
      p_user_id: userId,
    });
    if (redeemError) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return json({ error: redeemError.message || 'Не удалось активировать приглашение' }, 400);
    }

    return json({ ok: true, email: targetEmail });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Внутренняя ошибка' }, 500);
  }
});
