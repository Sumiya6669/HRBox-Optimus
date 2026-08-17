import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111';
const PROC='33333333-3333-3333-3333-333333333333';
const REQ='44444444-4444-4444-4444-444444444444', CAT='55555555-5555-5555-5555-555555555555';
const F=JSON.parse(fs.readFileSync('fixtures.tmp.json','utf8'));
const errs=[],writes=[];

function applyQuery(rows, search){
  const sp=new URLSearchParams(search);
  let out=[...rows];
  for(const [k,v] of sp.entries()){
    if(['select','order','limit','offset','on_conflict','columns'].includes(k)) continue;
    const i=v.indexOf('.'); const op=v.slice(0,i); const val=v.slice(i+1);
    out=out.filter(r=>{
      const cur=r[k];
      switch(op){
        case 'eq': return String(cur)===val || (val==='true'&&cur===true)||(val==='false'&&cur===false);
        case 'neq': return String(cur)!==val;
        case 'is': return val==='null'?cur===null||cur===undefined:String(cur)===val;
        case 'in': { const list=val.replace(/^\(|\)$/g,'').split(',').map(s=>s.replace(/^"|"$/g,'')); return list.includes(String(cur)); }
        case 'gte': return String(cur)>=val;
        case 'lte': return String(cur)<=val;
        case 'gt': return String(cur)>val;
        case 'lt': return String(cur)<val;
        case 'ilike': return String(cur??'').toLowerCase().includes(val.replace(/%/g,'').toLowerCase());
        default: return true;
      }
    });
  }
  const order=sp.get('order');
  if(order){ const [col,dir]=order.split('.'); out.sort((a,b)=>{const x=a[col],y=b[col];if(x===y)return 0;return (x>y?1:-1)*(dir==='desc'?-1:1);}); }
  return out;
}

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:1400}});
await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
await ctx.route(`**://${HOST}/**`, async(route)=>{
  const req=route.request(); const url=new URL(req.url()); const p=url.pathname;
  const accept=req.headers()['accept']||''; const single=accept.includes('pgrst.object'); const m=req.method();
  if(p.startsWith('/auth/v1/')) return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  if(p.startsWith('/rest/v1/rpc/')){
    writes.push({m:'RPC',t:p.replace('/rest/v1/rpc/',''),body:req.postData()});
    const n=p.split('/').pop();
    let res={};
    if(n==='process_submit_request')res=REQ;
    else if(n==='process_decide')res={status:'resolved',points:15};
    else if(n==='apply_achievement_rules')res={rules_processed:1,employees_checked:2,achievements_awarded:1};
    else if(n==='preview_achievement_rule')res=[{employee_id:'22222222-2222-2222-2222-222222222222',employee_name:'Иван Иванов',current_value:80}];
    else if(n==='portal_stats')res={};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res)});
  }
  if(p.startsWith('/rest/v1/')){
    const table=p.replace('/rest/v1/','').split('?')[0];
    if(m!=='GET'&&m!=='HEAD') writes.push({m,t:table,q:decodeURIComponent(url.search),body:req.postData()});
    let rows=F[table]; if(!rows){errs.push('NO FIXTURE '+table); rows=[];}
    if(m==='POST'){let inp=[];try{inp=JSON.parse(req.postData()||'[]');}catch{}if(!Array.isArray(inp))inp=[inp];
      const out=inp.map((r,i)=>({...r,id:'99999999-0000-0000-0000-00000000000'+i}));
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(single?out[0]:out)});}
    if(m==='PATCH'){let inp={};try{inp=JSON.parse(req.postData()||'{}');}catch{}
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x',...inp}:[{id:'x',...inp}])});}
    if(m==='DELETE') return route.fulfill({status:204,body:''});
    const filtered=applyQuery(rows,url.search);
    const body=single?JSON.stringify(filtered[0]??null):JSON.stringify(filtered);
    return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(filtered.length-1,0)}/${filtered.length}`,'access-control-expose-headers':'content-range'},body:m==='HEAD'?'':body});
  }
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,300));});
const go=async u=>{await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(900);};
const dump=l=>{console.log('\n##### '+l);for(const w of writes)console.log(w.m,w.t,w.q||'','\n   ',w.body);if(!writes.length)console.log('   (нет запросов на запись)');writes.length=0;};
const click=async(name,opt={})=>{const l=page.getByRole('button',{name});const c=await l.count();if(!c){console.log('!! нет кнопки: '+name);return false;}const t=opt.last?l.last():l.first();if(await t.isDisabled()){console.log('!! кнопка выключена: '+name);return false;}await t.click();return true;};

/* 1. Подача заявки */
await go('/cabinet/processes/'+PROC);
console.log('поля формы:', await page.locator('form label').allInnerTexts());
await page.locator('select[id^="process-field-"]').first().selectOption('idea').catch(e=>console.log('selectOption err',e.message));
await page.waitForTimeout(300);
writes.length=0;
await click('Отправить');
await page.waitForTimeout(1500);
dump('ПОДАЧА ЗАЯВКИ (select)');

/* 1b. с датой/числом/текстом — заполняем всё что есть */
await go(`/cabinet/processes/${PROC}?category=${CAT}`);
await page.locator('select[id^="process-field-"]').first().selectOption('idea').catch(()=>{});
await page.waitForTimeout(200);
writes.length=0;
await click('Отправить');
await page.waitForTimeout(1500);
dump('ПОДАЧА ЗАЯВКИ (?category)');

/* 2. Решение */
await go('/cabinet/processes/requests/'+REQ);
console.log('кнопки:', (await page.getByRole('button').allInnerTexts()).join(' | '));
writes.length=0;
await click('Согласовать');
await page.waitForTimeout(1200);
dump('РЕШЕНИЕ');

/* 2b. Отклонение (нужен комментарий) */
await go('/cabinet/processes/requests/'+REQ);
await page.locator('#decision-comment').fill('нет');
await page.waitForTimeout(200);
writes.length=0;
await click('Отклонить');
await page.waitForTimeout(1200);
dump('ОТКЛОНЕНИЕ');

/* 3. Отзыв */
await go('/cabinet/processes/requests/'+REQ);
if(await click('Отозвать заявку')){await page.waitForTimeout(500);writes.length=0;await click('Отозвать заявку',{last:true});await page.waitForTimeout(1200);dump('ОТЗЫВ');}

/* 4. Конструктор: добавить этап approve с ответственным + сохранить */
await go('/admin/processes/'+PROC);
await click('Добавить этап',{last:true}); await page.waitForTimeout(300);
await page.locator('input[placeholder="Подача заявки"]').last().fill('Новый этап');
await page.locator('select[id^="stage-type-"]').last().selectOption('collect');
await page.waitForTimeout(200);
await click('Добавить поле ввода'); await page.waitForTimeout(200);
await click('Добавить категорию'); await page.waitForTimeout(300);
const catInput=page.locator('input[id^="category-name-new"]');
if(await catInput.count()) await catInput.first().fill('Новая категория');
// маршрут next с нового этапа на первый
const kinds=page.locator('select[id^="route-kind-"]');
await page.waitForTimeout(200);
writes.length=0;
await click('Сохранить');
await page.waitForTimeout(2500);
dump('КОНСТРУКТОР: новый этап + поле + категория');

/* 5. Конструктор: удалить этап */
await go('/admin/processes/'+PROC);
await click('Удалить весь этап',{last:true}); await page.waitForTimeout(400);
await click('Удалить этап',{last:true}); await page.waitForTimeout(400);
writes.length=0;
await click('Сохранить');
await page.waitForTimeout(2500);
dump('КОНСТРУКТОР: удаление этапа');

/* 6. Конструктор: перестановка этапов */
await go('/admin/processes/'+PROC);
await page.getByRole('button',{name:/^Поднять этап/}).last().click(); await page.waitForTimeout(300);
writes.length=0;
await click('Сохранить');
await page.waitForTimeout(2500);
dump('КОНСТРУКТОР: перестановка');

/* 7. Правило: создание */
await go('/admin/achievement-rules');
await click('Новое правило'); await page.waitForTimeout(500);
await page.locator('#rule-title').fill('Тестовое правило');
await page.locator('#rule-points').fill('20');
await page.locator('label:has-text("Автоматическое награждение") button[role="switch"]').first().click();
await page.waitForTimeout(400);
await page.locator('#rule-param').selectOption('tenure_months');
await page.locator('#rule-threshold').fill('13');
await page.waitForTimeout(200);
writes.length=0;
await click('Кто попадёт под условие'); await page.waitForTimeout(900);
await click('Создать правило'); await page.waitForTimeout(1200);
dump('ПРАВИЛО: создание');

/* 8. Правило: birthday */
await go('/admin/achievement-rules');
await click('Новое правило'); await page.waitForTimeout(500);
await page.locator('#rule-title').fill('ДР');
await page.locator('label:has-text("Автоматическое награждение") button[role="switch"]').first().click();
await page.waitForTimeout(400);
await page.locator('#rule-param').selectOption('birthday_today');
await page.waitForTimeout(300);
writes.length=0;
await click('Кто попадёт под условие'); await page.waitForTimeout(900);
await click('Создать правило'); await page.waitForTimeout(1200);
dump('ПРАВИЛО: birthday_today');

/* 9. Правило: ручное (auto off) */
await go('/admin/achievement-rules');
await click('Новое правило'); await page.waitForTimeout(500);
await page.locator('#rule-title').fill('Ручное');
writes.length=0;
await click('Создать правило'); await page.waitForTimeout(1200);
dump('ПРАВИЛО: ручное');

/* 10. Запуск правил */
await go('/admin/achievement-rules');
writes.length=0;
await click('Проверить все правила'); await page.waitForTimeout(500);
await click('Проверить и наградить',{last:true}); await page.waitForTimeout(1200);
dump('ЗАПУСК ПРАВИЛ');

/* 11. Дублирование + создание процесса */
await go('/admin/processes');
writes.length=0;
await page.getByRole('button',{name:/^Дублировать процесс/}).first().click();
await page.waitForTimeout(2500);
dump('ДУБЛИРОВАНИЕ');

await go('/admin/processes');
await click('Новый процесс'); await page.waitForTimeout(500);
await page.locator('#process-name').fill('Проц');
writes.length=0;
await click('Создать процесс'); await page.waitForTimeout(1200);
dump('СОЗДАНИЕ ПРОЦЕССА');

/* 12. Публикация процесса из списка */
await go('/admin/processes');
writes.length=0;
await page.locator('button[role="switch"]').first().click();
await page.waitForTimeout(1200);
dump('ПУБЛИКАЦИЯ');

console.log('\n--- ОШИБКИ JS ---');
console.log(errs.length?[...new Set(errs)].join('\n'):'нет');
await b.close();
