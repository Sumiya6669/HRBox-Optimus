// Edge-функция: приглашение пользователя в портал.
//
// Вызывается из админки (`api.users.inviteUser`). Использует service_role-ключ,
// который живёт ТОЛЬКО здесь, на сервере, и никогда не попадает в клиентский бандл.
// Право приглашать проверяется по роли вызывающего в таблице profiles.

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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    // Клиент от имени вызывающего — чтобы узнать, кто он.
    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Требуется вход в систему' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle();
    if (!profile || profile.role !== 'admin') {
      return json({ error: 'Приглашать пользователей может только администратор' }, 403);
    }

    const { email, role = 'employee' } = await req.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Некорректный email' }, 400);
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: 'Недопустимая роль' }, 400);
    }

    const redirectTo = Deno.env.get('PORTAL_URL') ?? new URL(req.url).origin;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role },
      redirectTo: `${redirectTo}/reset-password`,
    });
    if (error) return json({ error: error.message }, 400);

    // Роль в профиле проставляем явно: триггер handle_new_user ставит employee по умолчанию.
    if (data?.user?.id) {
      await admin.from('profiles').update({ role }).eq('id', data.user.id);
      await admin.from('audit_logs').insert({
        user_id: user.id,
        user_name: profile.full_name ?? user.email,
        user_email: user.email,
        action: 'invite',
        entity_type: 'profiles',
        entity_id: data.user.id,
        description: `Приглашение отправлено: ${email}`,
      });
    }

    return json({ ok: true, user_id: data?.user?.id ?? null });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Внутренняя ошибка' }, 500);
  }
});
