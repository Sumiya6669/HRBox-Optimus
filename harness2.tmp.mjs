import { chromium } from 'playwright';
const HOST = 'dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111', EMP='22222222-2222-2222-2222-222222222222';
const PROC='33333333-3333-3333-3333-333333333333';
const ST1='aaaaaaaa-0000-0000-0000-000000000001',ST2='aaaaaaaa-0000-0000-0000-000000000002',ST3='aaaaaaaa-0000-0000-0000-000000000003';
const REQ='44444444-4444-4444-4444-444444444444', CAT='55555555-5555-5555-5555-555555555555';
const F = JSON.parse(await (await import('fs')).promises.readFile('fixtures.tmp.json','utf8'));
const errs=[], writes=[];
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport:{width:1440,height:1400} });
await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
await ctx.route(`**://${HOST}/**`, async (route)=>{
  const req=route.request(); const url=new URL(req.url()); const p=url.pathname;
  const accept=req.headers()['accept']||''; const single=accept.includes('pgrst.object');
  const m=req.method();
  if(p.startsWith('/auth/v1/')) return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  if(p.startsWith('/rest/v1/rpc/')){
    writes.push({m:'RPC',t:p.replace('/rest/v1/rpc/',''),body:req.postData()});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(p.includes('decide')?{status:'resolved',points:15}:(p.includes('submit')?REQ:{rules_processed:1,employees_checked:2,achievements_awarded:1}))});
  }
  if(p.startsWith('/rest/v1/')){
    const table=p.replace('/rest/v1/','').split('?')[0];
    if(m!=='GET'&&m!=='HEAD'){ writes.push({m,t:table,q:url.search,body:req.postData()}); }
    let rows=F[table]; if(!rows){errs.push('NO FIXTURE '+table); rows=[];}
    if(m==='POST'){ let inp=[]; try{inp=JSON.parse(req.postData()||'[]');}catch{} if(!Array.isArray(inp))inp=[inp];
      const out=inp.map((r,i)=>({...r,id:'new0000-0000-0000-0000-00000000000'+i}));
      return route.fulfill({status:201,contentType:'application/json',headers:{'content-range':`0-0/1`},body:JSON.stringify(single?out[0]:out)}); }
    if(m==='PATCH'){ let inp={}; try{inp=JSON.parse(req.postData()||'{}');}catch{}
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x',...inp}:[{id:'x',...inp}])}); }
    if(m==='DELETE'){ return route.fulfill({status:204,body:''}); }
    const body=single?JSON.stringify(rows[0]??null):JSON.stringify(rows);
    return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(rows.length-1,0)}/${rows.length}`,'access-control-expose-headers':'content-range'},body});
  }
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,300));});
const go=async(u)=>{await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(900);};
const dump=(label)=>{console.log('\n##### '+label);for(const w of writes)console.log(w.m,w.t,w.q||'','\n   ',w.body);writes.length=0;};

/* ---------- 1. Конструктор: правки и сохранение ---------- */
await go('/admin/processes/'+PROC);
// добавить этап
await page.getByRole('button',{name:'Добавить этап'}).last().click();
await page.waitForTimeout(200);
// заполнить имя нового этапа (последний Input с placeholder "Подача заявки")
const nameInputs = page.locator('input[placeholder="Подача заявки"]');
await nameInputs.last().fill('Новый этап');
// поднять последний этап вверх (перестановка)
const up = page.getByRole('button',{name:/^Поднять этап/});
await up.last().click();
await page.waitForTimeout(200);
// добавить поле на первый этап
await page.getByRole('button',{name:'Добавить поле ввода'}).first().click();
await page.waitForTimeout(200);
// добавить категорию
await page.getByRole('button',{name:'Добавить категорию'}).click();
await page.waitForTimeout(200);
await page.locator('input#category-name-new-category-1, input[id^="category-name-new"]').first().fill('Новая категория');
// сохранить
writes.length=0;
await page.getByRole('button',{name:'Сохранить'}).first().click();
await page.waitForTimeout(2000);
dump('КОНСТРУКТОР: сохранение');

/* ---------- 2. Добавление маршрута reject/resolve ---------- */
await go('/admin/processes/'+PROC);
const kindSel = page.locator('select[id^="route-kind-"]').first();
await kindSel.selectOption('reject');
await page.waitForTimeout(150);
await page.getByRole('button',{name:'Добавить маршрут'}).first().click();
await page.waitForTimeout(200);
writes.length=0;
await page.getByRole('button',{name:'Сохранить'}).first().click();
await page.waitForTimeout(2000);
dump('КОНСТРУКТОР: маршрут reject');

/* ---------- 3. Подача заявки ---------- */
await go('/cabinet/processes/'+PROC);
await page.locator('select#process-category').selectOption(CAT).catch(()=>{});
await page.locator('select[id^="process-field-"]').first().selectOption('idea').catch(()=>{});
writes.length=0;
await page.getByRole('button',{name:'Отправить'}).click();
await page.waitForTimeout(1500);
dump('ПОДАЧА ЗАЯВКИ');

/* ---------- 4. Решение по заявке ---------- */
await go('/cabinet/processes/requests/'+REQ);
writes.length=0;
const dec = page.getByRole('button',{name:'Согласовать'});
if(await dec.count()) { await dec.first().click(); await page.waitForTimeout(1200); }
else console.log('!! кнопки решения не найдено');
dump('РЕШЕНИЕ ПО ЗАЯВКЕ');

/* ---------- 5. Отзыв заявки ---------- */
await go('/cabinet/processes/requests/'+REQ);
const undo=page.getByRole('button',{name:'Отозвать заявку'});
if(await undo.count()){ await undo.first().click(); await page.waitForTimeout(400); writes.length=0;
  await page.getByRole('button',{name:'Отозвать заявку'}).last().click(); await page.waitForTimeout(1200); dump('ОТЗЫВ ЗАЯВКИ'); }
else console.log('!! кнопка отзыва не найдена');

/* ---------- 6. Правило достижения ---------- */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:'Новое правило'}).click();
await page.waitForTimeout(400);
await page.locator('#rule-title').fill('Тестовое правило');
await page.locator('#rule-points').fill('20');
await page.getByLabel('Автоматическое награждение').first().click();
await page.waitForTimeout(300);
await page.locator('#rule-param').selectOption('tenure_months');
await page.locator('#rule-threshold').fill('13');
writes.length=0;
await page.getByRole('button',{name:'Кто попадёт под условие'}).click();
await page.waitForTimeout(800);
await page.getByRole('button',{name:'Создать правило'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: создание');

/* ---------- 7. Правило birthday_today ---------- */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:'Новое правило'}).click();
await page.waitForTimeout(400);
await page.locator('#rule-title').fill('ДР правило');
await page.getByLabel('Автоматическое награждение').first().click();
await page.waitForTimeout(300);
await page.locator('#rule-param').selectOption('birthday_today');
await page.waitForTimeout(200);
writes.length=0;
await page.getByRole('button',{name:'Создать правило'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: birthday_today');

/* ---------- 8. Дублирование процесса ---------- */
await go('/admin/processes');
writes.length=0;
await page.getByRole('button',{name:/^Дублировать процесс/}).first().click();
await page.waitForTimeout(2000);
dump('ДУБЛИРОВАНИЕ ПРОЦЕССА');

/* ---------- 9. Создание процесса ---------- */
await go('/admin/processes');
await page.getByRole('button',{name:'Новый процесс'}).first().click();
await page.waitForTimeout(400);
await page.locator('#process-name').fill('Проц');
writes.length=0;
await page.getByRole('button',{name:'Создать процесс'}).click();
await page.waitForTimeout(1200);
dump('СОЗДАНИЕ ПРОЦЕССА');

console.log('\n--- ОШИБКИ JS ---');
console.log(errs.length?[...new Set(errs)].join('\n'):'нет');
await b.close();
