import { chromium } from 'playwright';

const HOST = 'dadnsuviohnzisksdbuj.supabase.co';
const UID = '11111111-1111-1111-1111-111111111111';
const EMP = '22222222-2222-2222-2222-222222222222';
const PROC = '33333333-3333-3333-3333-333333333333';
const ST1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const ST2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const ST3 = 'aaaaaaaa-0000-0000-0000-000000000003';
const REQ = '44444444-4444-4444-4444-444444444444';
const CAT = '55555555-5555-5555-5555-555555555555';

const F = {
  profiles: [{ id: UID, email: 'hr@optimus-kz.kz', full_name: 'Тест HR', role: 'admin', employee_id: EMP, locale: 'ru', is_active: true, created_date: '2026-01-01T00:00:00Z' }],
  employees: [{ id: EMP, name: 'Иван Иванов', position: 'Менеджер', department: 'Продажи', status: 'active', email: 'hr@optimus-kz.kz', photo_url: null, hire_date: '2020-01-01', birth_date: '1990-08-17', manager_id: null, created_date: '2026-01-01T00:00:00Z' }],
  processes: [{ id: PROC, name: 'Начисление баллов', description: 'Опис', icon: '🏆', image_url: null, image_path: null, is_active: true, allow_category_choice: true, visible_to_role: null, sort_order: 0, created_date: '2026-01-01T00:00:00Z' }],
  process_categories: [{ id: CAT, process_id: PROC, name: 'Обучение', description: 'd', sort_order: 0, is_active: true }],
  process_stages: [
    { id: ST1, process_id: PROC, name: 'Подача', type: 'collect', sort_order: 0, assignee_ids: [], watcher_ids: [], assignee_role: null, watcher_role: null, approve_by_manager: false, deadline_hours: null },
    { id: ST2, process_id: PROC, name: 'Согласование', type: 'approve', sort_order: 1, assignee_ids: [UID], watcher_ids: [], assignee_role: 'hr', watcher_role: null, approve_by_manager: true, deadline_hours: 24 },
    { id: ST3, process_id: PROC, name: 'Начисление', type: 'execute', sort_order: 2, assignee_ids: [UID], watcher_ids: [], assignee_role: null, watcher_role: null, approve_by_manager: false, deadline_hours: null },
  ],
  process_fields: [
    { id: 'bbbb0000-0000-0000-0000-000000000001', stage_id: ST1, label: 'Вид активности', hint: 'подсказка', type: 'select', options: [{ value: 'idea', label: 'Идея', points: 15 }], required: true, sort_order: 0, visible_to_role: null },
    { id: 'bbbb0000-0000-0000-0000-000000000002', stage_id: ST1, label: 'Файл', hint: null, type: 'file', options: [], required: false, sort_order: 1, visible_to_role: null },
    { id: 'bbbb0000-0000-0000-0000-000000000003', stage_id: ST1, label: 'Картинка', hint: null, type: 'image', options: [], required: false, sort_order: 2, visible_to_role: null },
    { id: 'bbbb0000-0000-0000-0000-000000000004', stage_id: ST1, label: 'Коллега', hint: null, type: 'employee', options: [], required: false, sort_order: 3, visible_to_role: null },
    { id: 'bbbb0000-0000-0000-0000-000000000005', stage_id: ST1, label: 'Несколько', hint: null, type: 'multiselect', options: [{ value: 'a', label: 'A', points: 5 }], required: false, sort_order: 4, visible_to_role: 'hr' },
    { id: 'bbbb0000-0000-0000-0000-000000000006', stage_id: ST3, label: 'Сколько начислить', hint: null, type: 'number', options: [], required: true, sort_order: 0, visible_to_role: null },
  ],
  process_routes: [
    { id: 'cccc0000-0000-0000-0000-000000000001', stage_id: ST1, kind: 'next', target_stage_id: ST2, require_comment: false, sort_order: 0 },
    { id: 'cccc0000-0000-0000-0000-000000000002', stage_id: ST2, kind: 'next', target_stage_id: ST3, require_comment: false, sort_order: 0 },
    { id: 'cccc0000-0000-0000-0000-000000000003', stage_id: ST2, kind: 'reject', target_stage_id: null, require_comment: true, sort_order: 1 },
    { id: 'cccc0000-0000-0000-0000-000000000004', stage_id: ST3, kind: 'resolve', target_stage_id: null, require_comment: false, sort_order: 0 },
  ],
  process_requests: [{ id: REQ, process_id: PROC, process_name: 'Начисление баллов', category_id: CAT, category_name: 'Обучение', employee_id: EMP, employee_name: 'Иван Иванов', current_stage_id: ST2, status: 'in_progress', points_awarded: 0, transaction_id: null, due_date: '2026-08-01T00:00:00Z', resolved_at: null, created_date: '2026-07-01T00:00:00Z' }],
  v_process_requests: [{ id: REQ, process_id: PROC, process_name: 'Начисление баллов', category_id: CAT, category_name: 'Обучение', employee_id: EMP, employee_name: 'Иван Иванов', current_stage_id: ST2, status: 'in_progress', points_awarded: 0, transaction_id: null, due_date: '2026-08-01T00:00:00Z', resolved_at: null, created_date: '2026-07-01T00:00:00Z', stage_name: 'Согласование', stage_type: 'approve', is_overdue: true, awaiting_me: true, points_preview: 15 }],
  process_request_values: [
    { id: 'dddd0000-0000-0000-0000-000000000001', request_id: REQ, field_id: 'bbbb0000-0000-0000-0000-000000000001', stage_id: ST1, field_label: 'Вид активности', value_text: 'idea', value_number: null, value_json: null, file_url: null, file_path: null },
    { id: 'dddd0000-0000-0000-0000-000000000002', request_id: REQ, field_id: 'bbbb0000-0000-0000-0000-000000000005', stage_id: ST1, field_label: 'Несколько', value_text: null, value_number: null, value_json: ['a'], file_url: null, file_path: null },
    { id: 'dddd0000-0000-0000-0000-000000000003', request_id: REQ, field_id: 'bbbb0000-0000-0000-0000-000000000002', stage_id: ST1, field_label: 'Файл', value_text: 'doc.pdf', value_number: null, value_json: null, file_url: 'https://example.com/f.pdf', file_path: 'p/f.pdf' },
  ],
  process_request_history: [{ id: 1, request_id: REQ, stage_id: ST1, stage_name: 'Подача', actor_id: UID, actor_name: 'Тест HR', action: 'submitted', comment: null, created_date: '2026-07-01T00:00:00Z' }],
  achievement_rules: [
    { id: '66666666-6666-6666-6666-666666666666', title: 'Выслуга лет', description: 'd', icon: '🏅', image_url: null, image_path: null, points: 20, type: 'tenure', reason_code: 'tenure', auto_award: true, param: 'tenure_months', operator: 'gt', threshold: '13.00', period: 'once', is_active: true, last_run: '2026-08-01T10:00:00Z', created_date: '2026-01-01T00:00:00Z' },
    { id: '66666666-6666-6666-6666-666666666667', title: 'ДР', description: null, icon: null, image_url: null, image_path: null, points: 0, type: 'birthday', reason_code: null, auto_award: true, param: 'birthday_today', operator: 'eq', threshold: null, period: 'yearly', is_active: true, last_run: null, created_date: '2026-01-01T00:00:00Z' },
  ],
  award_reasons: [{ id: '77777777-7777-7777-7777-777777777777', code: 'tenure', title: 'За стаж', category: 'milestone', default_points: 20, active: true }],
  notifications: [],
  settings: [],
  wallet_transactions: [],
  favorites: [],
  news: [],
};

const errs = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });

await ctx.addInitScript(({ uid }) => {
  const session = {
    access_token: 'fake.jwt.token', token_type: 'bearer', expires_in: 999999,
    expires_at: Math.floor(Date.now() / 1000) + 999999, refresh_token: 'r',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'hr@optimus-kz.kz', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
  localStorage.setItem('optimus-kz-auth', JSON.stringify(session));
}, { uid: UID });

await ctx.route(`**://${HOST}/**`, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const accept = req.headers()['accept'] || '';
  const single = accept.includes('pgrst.object');
  if (p.startsWith('/auth/v1/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.replace('/rest/v1/', '').split('?')[0];
    let rows = F[table];
    if (!rows) { errs.push('NO FIXTURE for table: ' + table); rows = []; }
    const body = single ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`, 'access-control-expose-headers': 'content-range' },
      body,
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/Failed to load resource|net::|Не заданы VITE/.test(t)) errs.push('CONSOLE ' + t.slice(0, 300));
  if (m.type() === 'warning' && /Warning:|React/.test(t)) errs.push('WARN ' + t.slice(0, 250));
});

const routes = [
  '/cabinet/processes',
  `/cabinet/processes/${PROC}`,
  `/cabinet/processes/${PROC}?category=${CAT}`,
  '/cabinet/processes/requests',
  `/cabinet/processes/requests/${REQ}`,
  '/admin/processes',
  `/admin/processes/${PROC}`,
  '/admin/process-requests',
  '/admin/achievement-rules',
];

for (const r of routes) {
  const before = errs.length;
  await page.goto('http://localhost:4173' + r, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    len: document.getElementById('root')?.innerText?.length ?? 0,
    h1: document.querySelector('h1')?.innerText || '',
    err: document.body.innerText.includes('Что-то пошло не так') || document.body.innerText.includes('Ошибка'),
  }));
  console.log(r.padEnd(50), '|', String(info.len).padStart(5), '|', info.h1.slice(0, 40).padEnd(40), '| new errs:', errs.length - before);
}

console.log('\n--- ОШИБКИ ---');
console.log(errs.length ? [...new Set(errs)].join('\n---\n') : 'нет');
await b.close();
