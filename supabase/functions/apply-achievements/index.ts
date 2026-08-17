// Edge-функция для планировщика: автоматическое награждение достижениями по условию.
//
// Раздел 1.2 технического задания: у достижения включён тумблер «Автоматическое
// награждение» и задано условие (например, «Стаж работы в месяцах» больше 13) —
// портал сам выдаёт достижение и бонус в баллах всем, кто под условие подпадает.
//
// Вся логика лежит в функции apply_achievement_rules() (миграция 0009):
// она идемпотентна — повторный запуск в том же периоде ничего не задвоит,
// за это отвечает уникальный индекс achievements_rule_period_uniq.
//
// Разверните и повесьте на расписание:
//   supabase functions deploy apply-achievements --no-verify-jwt
//   в Supabase Dashboard → Database → Cron:
//     select cron.schedule('apply-achievements','30 3 * * *', $$select apply_achievement_rules()$$);
// либо вызывайте функцию по HTTP с заголовком X-Cron-Secret.
//
// Без расписания автоначисление будет срабатывать только по кнопке
// «Проверить и наградить сейчас» в разделе «Правила достижений».

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // Защита от вызова посторонними: секрет планировщика в заголовке.
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('X-Cron-Secret') !== secret) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  // Выдача достижений и начисление баллов идут под service_role:
  // RLS-политики портала на массовую операцию прав не дают.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // p_rule_id = null — проверяются все активные автоправила.
  const { data, error } = await admin.rpc('apply_achievement_rules', { p_rule_id: null });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // data: { rules_processed, employees_checked, achievements_awarded }
  return new Response(JSON.stringify({ ok: true, result: data }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
