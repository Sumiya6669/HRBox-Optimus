import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111';
const PROC='33333333-3333-3333-3333-333333333333';
const base=JSON.parse(fs.readFileSync('/home/claude/hrbox/fixtures.tmp.json','utf8'));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function run(label, mutate, fn){
 const F=JSON.parse(JSON.stringify(base)); mutate(F);
 const writes=[],errs=[];
 const ctx=await b.newContext({viewport:{width:1440,height:1400}});
 await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
 await ctx.route(`**://${HOST}/**`,async route=>{const req=route.request();const url=new URL(req.url());const p=url.pathname;
  const single=(req.headers()['accept']||'').includes('pgrst.object');const m=req.method();
  if(p.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  if(p.startsWith('/rest/v1/rpc/')){writes.push({m:'RPC',t:p.split('/').pop(),body:req.postData()});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(p.endsWith('preview_achievement_rule')?[]:{})});}
  if(p.startsWith('/rest/v1/')){const t=p.replace('/rest/v1/','').split('?')[0];
   if(m!=='GET'&&m!=='HEAD'){writes.push({m,t,body:req.postData()});let inp={};try{inp=JSON.parse(req.postData()||'{}');}catch{}
    const one=Array.isArray(inp)?inp[0]:inp;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x',...one}:[{id:'x',...one}])});}
   const sp=new URLSearchParams(url.search); let rows=F[t]??[];
   for(const [k,v] of sp.entries()){ if(['select','order','limit','offset','columns'].includes(k))continue;
     const i=v.indexOf('.');const op=v.slice(0,i);const val=v.slice(i+1);
     rows=rows.filter(r=>{const c=r[k];switch(op){case 'eq':return String(c)===val||(val==='true'&&c===true)||(val==='false'&&c===false);
      case 'in':{const l=val.replace(/^\(|\)$/g,'').split(',').map(s=>s.replace(/^"|"$/g,''));return l.includes(String(c));}
      case 'is':return val==='null'?c==null:String(c)===val;default:return true;}});}
   return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(rows.length-1,0)}/${rows.length}`,'access-control-expose-headers':'content-range'},body:single?JSON.stringify(rows[0]??null):JSON.stringify(rows)});}
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
 page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,200));});
 console.log('\n===== '+label);
 await fn(page,writes);
 if(errs.length)console.log('ОШИБКИ: '+[...new Set(errs)].join('\n'));
 await ctx.close();
}
const go=async(page,u)=>{await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(900);};

await run('ПРАВИЛО birthday_today: оператор', f=>f, async(page,writes)=>{
 await go(page,'/admin/achievement-rules');
 await page.getByRole('button',{name:'Новое правило'}).click(); await page.waitForTimeout(600);
 const d=page.locator('[role="dialog"]');
 await d.locator('#rule-title').fill('ДР');
 await d.locator('button[role="switch"][aria-label="Автоматическое награждение"]').click(); await page.waitForTimeout(400);
 await d.locator('#rule-param').selectOption('birthday_today'); await page.waitForTimeout(400);
 writes.length=0;
 await d.getByRole('button',{name:'Создать правило'}).click(); await page.waitForTimeout(1200);
 for(const w of writes)console.log(w.m,w.t,'\n   ',w.body);
});
await run('КАТАЛОГ: процесс только для admin, роль employee', f=>{f.profiles[0].role='employee';f.processes[0].visible_to_role='admin';}, async(page)=>{
 await go(page,'/cabinet/processes');
 console.log('каталог:',(await page.locator('main').innerText()).split('\n').filter(Boolean).slice(0,8).join(' | '));
 await go(page,'/cabinet/processes/'+PROC);
 console.log('форма:',(await page.locator('main').innerText()).split('\n').filter(Boolean).slice(0,8).join(' | '));
});
await run('КАТАЛОГ: процесс для manager, роль hr (иерархия)', f=>{f.profiles[0].role='hr';f.processes[0].visible_to_role='manager';}, async(page)=>{
 await go(page,'/cabinet/processes');
 console.log('каталог:',(await page.locator('main').innerText()).split('\n').filter(Boolean).slice(0,6).join(' | '));
});
await run('КАТАЛОГ: без ограничения, роль employee', f=>{f.profiles[0].role='employee';}, async(page)=>{
 await go(page,'/cabinet/processes');
 console.log('каталог:',(await page.locator('main').innerText()).split('\n').filter(Boolean).slice(0,6).join(' | '));
 await go(page,'/cabinet/processes/'+PROC);
 console.log('форма:',(await page.locator('main').innerText()).split('\n').filter(Boolean).slice(0,6).join(' | '));
});
await b.close();
