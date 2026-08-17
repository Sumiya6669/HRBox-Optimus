// Edge-функция: смена роли пользователя.
//
// Роль нельзя менять из клиента напрямую: RLS-политика profiles_update_self
// запрещает пользователю трогать собственное поле role. Здесь операция
// выполняется service_role-ключом после проверки, что вызывающий — администратор.

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
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Требуется вход в систему' }, 401);

    const { data: profile } = await admin.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle();
    if (!profile || profile.role !== 'admin') {
      return json({ error: 'Менять роли может только администратор' }, 403);
    }

    const { userId, role } = await req.json();
    if (!userId || !ALLOWED_ROLES.includes(role)) return json({ error: 'Некорректные параметры' }, 400);

    // Защита от самоблокировки: последний администратор не может понизить себе роль.
    if (userId === user.id && role !== 'admin') {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) <= 1) return json({ error: 'Нельзя снять роль с последнего администратора' }, 400);
    }

    const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
    if (error) return json({ error: error.message }, 400);

    await admin.from('audit_logs').insert({
      user_id: user.id,
      user_name: profile.full_name ?? user.email,
      user_email: user.email,
      action: 'update',
      entity_type: 'profiles',
      entity_id: userId,
      description: `Роль изменена на «${role}»`,
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Внутренняя ошибка' }, 500);
  }
});
