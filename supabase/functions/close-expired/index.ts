// Edge-функция для планировщика: закрытие просроченных опросов, сессий и заявок.
//
// BUG-019: опросы с прошедшим дедлайном оставались «Активными».
// BUG-041: заявка на отпуск висела «Ожидает» через 2,5 недели после самого отпуска.
//
// Разверните и повесьте на расписание:
//   supabase functions deploy close-expired --no-verify-jwt
//   в Supabase Dashboard → Database → Cron: select cron.schedule('close-expired','0 3 * * *', ...)
// либо вызывайте функцию по HTTP с заголовком X-Cron-Secret.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('X-Cron-Secret') !== secret) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await admin.rpc('close_expired_records');
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
