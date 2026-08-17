import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111';
const PROC='33333333-3333-3333-3333-333333333333';
const REQ='44444444-4444-4444-4444-444444444444';
const ST3='aaaaaaaa-0000-0000-0000-000000000003';
const F=JSON.parse(fs.readFileSync('fixtures.tmp.json','utf8'));
F.processes[0].is_active=false;               // черновик — сохранение не блокируется
// заявка на этапе исполнения, где есть обязательное число
F.process_requests[0].current_stage_id=ST3;
F.v_process_requests[0].current_stage_id=ST3;
F.v_process_requests[0].stage_name='Начисление';
F.v_process_requests[0].stage_type='execute';
let seq=0;
const errs=[],writes=[];
function applyQuery(rows,search){const sp=new URLSearchParams(search);let out=[...rows];
 for(const [k,v] of sp.entries()){ if(['select','order','limit','offset','on_conflict','columns'].includes(k))continue;
  const i=v.indexOf('.');const op=v.slice(0,i);const val=v.slice(i+1);
  out=out.filter(r=>{const cur=r[k];switch(op){
   case 'eq':return String(cur)===val||(val==='true'&&cur===true)||(val==='false'&&cur===false);
   case 'is':return val==='null'?cur===null||cur===undefined:String(cur)===val;
   case 'in':{const l=val.replace(/^\(|\)$/g,'').split(',').map(s=>s.replace(/^"|"$/g,''));return l.includes(String(cur));}
   case 'gte':return String(cur)>=val;case 'lte':return String(cur)<=val;
   case 'ilike':return String(cur??'').toLowerCase().includes(val.replace(/%/g,'').toLowerCase());default:return true;}});}
 const o=sp.get('order');if(o){const[c,d]=o.split('.');out.sort((a,b)=>{const x=a[c],y=b[c];if(x===y)return 0;return (x>y?1:-1)*(d==='desc'?-1:1);});}
 return out;}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:1600}});
await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
await ctx.route(`**://${HOST}/**`,async route=>{const req=route.request();const url=new URL(req.url());const p=url.pathname;
 const single=(req.headers()['accept']||'').includes('pgrst.object');const m=req.method();
 if(p.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 if(p.startsWith('/storage/v1/')){
   if(m==='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({Key:'x',path:'process-requests/'+UID+'/1-file.png'})});
   return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
 if(p.startsWith('/rest/v1/rpc/')){writes.push({m:'RPC',t:p.replace('/rest/v1/rpc/',''),body:req.postData()});
  const n=p.split('/').pop();let res={};
  if(n==='process_submit_request')res=REQ;else if(n==='process_decide')res={status:'resolved',points:15};
  else if(n==='apply_achievement_rules')res={rules_processed:1,employees_checked:2,achievements_awarded:1};
  else if(n==='preview_achievement_rule')res=[];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res)});}
 if(p.startsWith('/rest/v1/')){const table=p.replace('/rest/v1/','').split('?')[0];
  if(m!=='GET'&&m!=='HEAD')writes.push({m,t:table,q:decodeURIComponent(url.search),body:req.postData()});
  let rows=F[table];if(!rows){errs.push('NO FIXTURE '+table);rows=[];}
  if(m==='POST'){let inp=[];try{inp=JSON.parse(req.postData()||'[]');}catch{}if(!Array.isArray(inp))inp=[inp];
   const out=inp.map(r=>({...r,id:'9999'+String(++seq).padStart(4,'0')+'-0000-0000-0000-000000000000'}));
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

/* A. конструктор: новый этап + маршрут существующего этапа НА новый этап */
await go('/admin/processes/'+PROC);
await page.getByRole('button',{name:'Добавить этап'}).last().click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="Подача заявки"]').last().fill('Новый согласующий');
await page.locator('select[id^="assignee-role-"]').last().selectOption('hr');
await page.waitForTimeout(300);
// на ПЕРВОМ этапе добавляем маршрут next → новый этап
const kind1=page.locator('select[id^="route-kind-"]').first();
await kind1.selectOption('next');
const tgt1=page.locator('select[id^="route-target-"]').first();
const opts=await tgt1.locator('option').allInnerTexts();
console.log('варианты целевого этапа:',opts);
await tgt1.selectOption({label:opts[opts.length-1]});
await page.getByRole('button',{name:'Добавить маршрут'}).first().click();
await page.waitForTimeout(400);
writes.length=0;
await page.getByRole('button',{name:'Сохранить'}).first().click();
await page.waitForTimeout(3000);
dump('КОНСТРУКТОР: маршрут на НОВЫЙ этап');
console.log('TOAST:',(await page.locator('[role="status"], ol li').allInnerTexts().catch(()=>[])).join(' | '));

/* B. решение на этапе с обязательным числовым полем */
await go('/cabinet/processes/requests/'+REQ);
console.log('кнопки:',(await page.getByRole('button').allInnerTexts()).join(' | '));
const num=page.locator('input[id^="decision-field-"][type="number"]');
if(await num.count()){await num.fill('30');await page.waitForTimeout(300);}
writes.length=0;
const rb=page.getByRole('button',{name:'Начислить и закрыть'});
if(await rb.count())await rb.click();else console.log('!! нет кнопки resolve');
await page.waitForTimeout(1500);
dump('РЕШЕНИЕ: execute с полем');

/* C. загрузка файла в заявке */
await go('/cabinet/processes/'+PROC);
const fi=page.locator('input[type="file"]');
console.log('file inputs:',await fi.count());
if(await fi.count()>=1){
  await fi.nth(0).setInputFiles({name:'doc.txt',mimeType:'text/plain',buffer:Buffer.from('hello')});
  await page.waitForTimeout(1200);
}
await page.locator('select[id^="process-field-"]').first().selectOption('idea');
await page.waitForTimeout(300);
writes.length=0;
await page.getByRole('button',{name:'Отправить'}).click();
await page.waitForTimeout(1500);
dump('ЗАЯВКА: с файлом');

/* D. фильтры + экспорт реестра */
await go('/admin/process-requests');
await page.locator('#pr-from').fill('2026-01-01');
await page.locator('#pr-to').fill('2026-12-31');
await page.locator('#pr-search').fill('Иван');
await page.locator('#pr-status').selectOption('in_progress');
await page.waitForTimeout(1200);
const rows=await page.locator('tbody tr').count();
console.log('строк в реестре после фильтров:',rows);
await page.getByRole('button',{name:'Экспорт CSV'}).click();
await page.waitForTimeout(1200);
console.log('TOAST экспорта:',(await page.locator('ol li').allInnerTexts().catch(()=>[])).join(' | '));

/* E. переключатели на карточке правила */
await go('/admin/achievement-rules');
writes.length=0;
await page.locator('button[role="switch"][aria-label^="Активность правила"]').first().click();
await page.waitForTimeout(900);
await page.locator('button[role="switch"][aria-label^="Автоматическое награждение по правилу"]').first().click();
await page.waitForTimeout(900);
dump('ПРАВИЛО: переключатели карточки');

/* F. очередь «Ждут моего решения» */
await go('/cabinet/processes/requests');
await page.getByRole('tab',{name:/Ждут моего решения/}).click();
await page.waitForTimeout(1200);
console.log('очередь:',(await page.locator('[role="tabpanel"]').innerText()).slice(0,200).replace(/\n/g,' | '));

console.log('\n--- ОШИБКИ JS ---');
console.log(errs.length?[...new Set(errs)].join('\n'):'нет');
await b.close();
