import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111';
const PROC='33333333-3333-3333-3333-333333333333';
const REQ='44444444-4444-4444-4444-444444444444';
const F=JSON.parse(fs.readFileSync('fixtures.tmp.json','utf8'));
// добавим поля разных типов на первый этап + сделаем процесс черновиком для теста сохранения
F.process_fields.push(
 {id:'bbbb0000-0000-0000-0000-00000000000a',stage_id:'aaaaaaaa-0000-0000-0000-000000000001',label:'Дата',hint:null,type:'date',options:[],required:false,sort_order:5,visible_to_role:null},
 {id:'bbbb0000-0000-0000-0000-00000000000b',stage_id:'aaaaaaaa-0000-0000-0000-000000000001',label:'Число',hint:null,type:'number',options:[],required:false,sort_order:6,visible_to_role:null},
 {id:'bbbb0000-0000-0000-0000-00000000000c',stage_id:'aaaaaaaa-0000-0000-0000-000000000001',label:'Текст',hint:null,type:'textarea',options:[],required:false,sort_order:7,visible_to_role:null});
const errs=[],writes=[];
function applyQuery(rows,search){const sp=new URLSearchParams(search);let out=[...rows];
 for(const [k,v] of sp.entries()){ if(['select','order','limit','offset','on_conflict','columns'].includes(k))continue;
  const i=v.indexOf('.');const op=v.slice(0,i);const val=v.slice(i+1);
  out=out.filter(r=>{const cur=r[k];switch(op){
   case 'eq':return String(cur)===val||(val==='true'&&cur===true)||(val==='false'&&cur===false);
   case 'neq':return String(cur)!==val;
   case 'is':return val==='null'?cur===null||cur===undefined:String(cur)===val;
   case 'in':{const l=val.replace(/^\(|\)$/g,'').split(',').map(s=>s.replace(/^"|"$/g,''));return l.includes(String(cur));}
   case 'gte':return String(cur)>=val;case 'lte':return String(cur)<=val;case 'gt':return String(cur)>val;case 'lt':return String(cur)<val;
   case 'ilike':return String(cur??'').toLowerCase().includes(val.replace(/%/g,'').toLowerCase());default:return true;}});}
 const o=sp.get('order');if(o){const[c,d]=o.split('.');out.sort((a,b)=>{const x=a[c],y=b[c];if(x===y)return 0;return (x>y?1:-1)*(d==='desc'?-1:1);});}
 return out;}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:1400}});
await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
await ctx.route(`**://${HOST}/**`,async route=>{const req=route.request();const url=new URL(req.url());const p=url.pathname;
 const single=(req.headers()['accept']||'').includes('pgrst.object');const m=req.method();
 if(p.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 if(p.startsWith('/rest/v1/rpc/')){writes.push({m:'RPC',t:p.replace('/rest/v1/rpc/',''),body:req.postData()});
  const n=p.split('/').pop();let res={};
  if(n==='process_submit_request')res=REQ;else if(n==='process_decide')res={status:'resolved',points:15};
  else if(n==='apply_achievement_rules')res={rules_processed:1,employees_checked:2,achievements_awarded:1};
  else if(n==='preview_achievement_rule')res=[{employee_id:'22222222-2222-2222-2222-222222222222',employee_name:'Иван Иванов',current_value:80}];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res)});}
 if(p.startsWith('/rest/v1/')){const table=p.replace('/rest/v1/','').split('?')[0];
  if(m!=='GET'&&m!=='HEAD')writes.push({m,t:table,q:decodeURIComponent(url.search),body:req.postData()});
  let rows=F[table];if(!rows){errs.push('NO FIXTURE '+table);rows=[];}
  if(m==='POST'){let inp=[];try{inp=JSON.parse(req.postData()||'[]');}catch{}if(!Array.isArray(inp))inp=[inp];
   const out=inp.map((r,i)=>({...r,id:'99999999-0000-0000-0000-00000000000'+i}));
   return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(single?out[0]:out)});}
  if(m==='PATCH'){let inp={};try{inp=JSON.parse(req.postData()||'{}');}catch{}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x',...inp}:[{id:'x',...inp}])});}
  if(m==='DELETE')return route.fulfill({status:204,body:''});
  const f=applyQuery(rows,url.search);
  return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(f.length-1,0)}/${f.length}`,'access-control-expose-headers':'content-range'},body:single?JSON.stringify(f[0]??null):JSON.stringify(f)});}
 return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,300));});
const go=async u=>{await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(900);};
const dump=l=>{console.log('\n##### '+l);for(const w of writes)console.log(w.m,w.t,w.q||'','\n   ',w.body);if(!writes.length)console.log('   (нет запросов на запись)');writes.length=0;};
const toasts=async()=>{const t=await page.locator('[role="status"], li[data-state]').allInnerTexts().catch(()=>[]);return t.join(' / ');};

/* A. форма со всеми типами полей */
await go('/cabinet/processes/'+PROC);
await page.locator('select[id^="process-field-"]').first().selectOption('idea');
await page.locator('input[type="date"][id^="process-field-"]').fill('2026-08-20');
await page.locator('input[type="number"][id^="process-field-"]').fill('42');
await page.locator('textarea[id^="process-field-"]').fill(' привет  ');
const cb=page.locator('button[role="checkbox"]');
if(await cb.count()) await cb.first().click();
await page.waitForTimeout(300);
writes.length=0;
await page.getByRole('button',{name:'Отправить'}).click();
await page.waitForTimeout(1500);
dump('ЗАЯВКА: все типы полей');

/* B. правило: создание через диалог (скоуп внутри диалога) */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:'Новое правило'}).click();
await page.waitForTimeout(600);
const dlg=page.locator('[role="dialog"]');
await dlg.locator('#rule-title').fill('Тестовое правило');
await dlg.locator('#rule-points').fill('20');
await dlg.locator('button[role="switch"][aria-label="Автоматическое награждение"]').click();
await page.waitForTimeout(400);
await dlg.locator('#rule-param').selectOption('tenure_months');
await dlg.locator('#rule-threshold').fill('13');
await page.waitForTimeout(300);
writes.length=0;
await dlg.getByRole('button',{name:'Кто попадёт под условие'}).click();
await page.waitForTimeout(900);
await dlg.getByRole('button',{name:'Создать правило'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: tenure_months');

/* C. правило birthday */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:'Новое правило'}).click();
await page.waitForTimeout(600);
await dlg.locator('#rule-title').fill('ДР');
await dlg.locator('button[role="switch"][aria-label="Автоматическое награждение"]').click();
await page.waitForTimeout(400);
await dlg.locator('#rule-param').selectOption('birthday_today');
await page.waitForTimeout(400);
writes.length=0;
await dlg.getByRole('button',{name:'Кто попадёт под условие'}).click();
await page.waitForTimeout(900);
await dlg.getByRole('button',{name:'Создать правило'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: birthday_today');

/* D. правило ручное */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:'Новое правило'}).click();
await page.waitForTimeout(600);
await dlg.locator('#rule-title').fill('Ручное');
writes.length=0;
await dlg.getByRole('button',{name:'Создать правило'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: ручное');

/* E. редактирование существующего правила */
await go('/admin/achievement-rules');
await page.getByRole('button',{name:/^Изменить правило/}).first().click();
await page.waitForTimeout(600);
writes.length=0;
await dlg.getByRole('button',{name:'Сохранить'}).click();
await page.waitForTimeout(1200);
dump('ПРАВИЛО: сохранение существующего');

/* F. запуск правил */
await go('/admin/achievement-rules');
writes.length=0;
await page.getByRole('button',{name:'Проверить все правила'}).click();
await page.waitForTimeout(600);
await page.locator('[role="dialog"]').getByRole('button',{name:'Проверить и наградить'}).click();
await page.waitForTimeout(1200);
dump('ЗАПУСК ПРАВИЛ');

/* G. дублирование */
await go('/admin/processes');
writes.length=0;
await page.getByRole('button',{name:/^Дублировать процесс/}).first().click();
await page.waitForTimeout(2500);
dump('ДУБЛИРОВАНИЕ');

/* H. создание процесса */
await go('/admin/processes');
await page.getByRole('button',{name:'Новый процесс'}).first().click();
await page.waitForTimeout(500);
await page.locator('[role="dialog"] #process-name').fill('Проц');
writes.length=0;
await page.locator('[role="dialog"]').getByRole('button',{name:'Создать процесс'}).click();
await page.waitForTimeout(1200);
dump('СОЗДАНИЕ ПРОЦЕССА');

/* I. конструктор: снять публикацию, добавить этап approve с ролью, дедлайн, поле с вариантом, категорию, сохранить */
await go('/admin/processes/'+PROC);
await page.locator('button[role="switch"][aria-label="Опубликовать процесс"]').click();
await page.waitForTimeout(300);
await page.getByRole('button',{name:'Добавить этап'}).last().click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="Подача заявки"]').last().fill('Новый этап');
await page.waitForTimeout(200);
// новый этап типа approve → есть переключатель дедлайна
const dl=page.locator('button[role="switch"][aria-label="Установить дедлайн"]');
if(await dl.count()){await dl.last().click();await page.waitForTimeout(300);}
// роль ответственных
const rs=page.locator('select[id^="assignee-role-"]');
if(await rs.count()) await rs.last().selectOption('hr');
await page.waitForTimeout(200);
// поле на первый этап + название + тип select + вариант
await page.getByRole('button',{name:'Добавить поле ввода'}).first().click();
await page.waitForTimeout(300);
await page.locator('input[placeholder="Вид активности"]').last().fill('Новое поле');
await page.locator('select[aria-label^="Тип поля"]').last().selectOption('select');
await page.waitForTimeout(300);
await page.locator('input[aria-label="Текст нового варианта"]').last().fill('Вариант А');
await page.getByRole('button',{name:'Добавить вариант'}).last().click();
await page.waitForTimeout(300);
// категория
await page.getByRole('button',{name:'Добавить категорию'}).click();
await page.waitForTimeout(400);
await page.locator('input[id^="category-name-new"]').first().fill('Новая категория');
await page.waitForTimeout(300);
writes.length=0;
await page.getByRole('button',{name:'Сохранить'}).first().click();
await page.waitForTimeout(3000);
dump('КОНСТРУКТОР: новый этап + поле + категория');
console.log('TOAST:', await toasts());

console.log('\n--- ОШИБКИ JS ---');
console.log(errs.length?[...new Set(errs)].join('\n'):'нет');
await b.close();
