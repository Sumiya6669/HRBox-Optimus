import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111';
const PROC='33333333-3333-3333-3333-333333333333';
const REQ='44444444-4444-4444-4444-444444444444';
const base=JSON.parse(fs.readFileSync('fixtures.tmp.json','utf8'));
const scenarios={
 'ПУСТО (нет данных)': f=>{f.processes=[];f.process_categories=[];f.process_stages=[];f.process_fields=[];f.process_routes=[];f.process_requests=[];f.v_process_requests=[];f.process_request_values=[];f.process_request_history=[];f.achievement_rules=[];},
 'ПРОЦЕСС БЕЗ ЭТАПОВ': f=>{f.process_stages=[];f.process_fields=[];f.process_routes=[];},
 'ЗАЯВКА РЕШЕНА': f=>{f.v_process_requests[0]={...f.v_process_requests[0],status:'resolved',current_stage_id:null,stage_name:null,stage_type:null,awaiting_me:false,is_overdue:false,points_awarded:15,resolved_at:'2026-08-01T00:00:00Z'};f.process_requests[0].status='resolved';},
 'ЗАЯВКА ОТМЕНЕНА, ПОЛЯ NULL': f=>{f.v_process_requests[0]={...f.v_process_requests[0],status:'cancelled',current_stage_id:null,stage_name:null,stage_type:null,awaiting_me:false,due_date:null,category_name:null,employee_name:null,process_name:null,points_preview:0};f.process_request_values=[{id:'x',request_id:REQ,field_id:'нет',stage_id:null,field_label:null,value_text:null,value_number:null,value_json:null,file_url:null,file_path:null}];f.process_request_history=[{id:1,request_id:REQ,stage_id:null,stage_name:null,actor_id:null,actor_name:null,action:'cancelled',comment:null,created_date:'2026-07-01T00:00:00Z'}];},
 'ПРАВИЛО БЕЗ УСЛОВИЯ + БИТАЯ КАРТИНКА': f=>{f.achievement_rules=[{id:'66666666-6666-6666-6666-666666666666',title:'Без условия',description:null,icon:null,image_url:'https://broken.example/x.png',image_path:null,points:0,type:'special',reason_code:null,auto_award:true,param:null,operator:null,threshold:null,period:'once',is_active:true,last_run:null,created_date:'2026-01-01T00:00:00Z'}];},
 'ПОЛЕ SELECT БЕЗ ВАРИАНТОВ': f=>{f.process_fields=[{id:'bbbb0000-0000-0000-0000-000000000001',stage_id:'aaaaaaaa-0000-0000-0000-000000000001',label:'Выбор',hint:null,type:'select',options:null,required:true,sort_order:0,visible_to_role:null}];},
 'ЭТАП БЕЗ МАРШРУТОВ': f=>{f.process_routes=[];},
};
const allErrs=[];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for(const [name,mut] of Object.entries(scenarios)){
  const F=JSON.parse(JSON.stringify(base)); mut(F);
  const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:1200}});
  await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
  await ctx.route(`**://${HOST}/**`,async route=>{const req=route.request();const url=new URL(req.url());const p=url.pathname;
   const single=(req.headers()['accept']||'').includes('pgrst.object');const m=req.method();
   if(p.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   if(p.startsWith('/rest/v1/rpc/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   if(p.startsWith('/rest/v1/')){const t=p.replace('/rest/v1/','').split('?')[0];
    let rows=F[t]??[];
    if(m!=='GET'&&m!=='HEAD')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x'}:[{id:'x'}])});
    return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(rows.length-1,0)}/${rows.length}`,'access-control-expose-headers':'content-range'},body:single?JSON.stringify(rows[0]??null):JSON.stringify(rows)});}
   return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('console',mm=>{const t=mm.text();if(mm.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,200));});
  const urls=['/cabinet/processes','/cabinet/processes/'+PROC,'/cabinet/processes/requests','/cabinet/processes/requests/'+REQ,'/admin/processes','/admin/processes/'+PROC,'/admin/process-requests','/admin/achievement-rules'];
  const texts=[];
  for(const u of urls){await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(800);
    texts.push(u.padEnd(45)+'| '+(await page.evaluate(()=>document.getElementById('root')?.innerText?.length??0)));}
  console.log('\n=== '+name);
  console.log(texts.join('\n'));
  console.log(errs.length?'ОШИБКИ:\n'+[...new Set(errs)].join('\n'):'ошибок нет');
  allErrs.push(...errs.map(e=>name+': '+e));
  await ctx.close();
}
await b.close();
console.log('\n===== ИТОГ =====');
console.log(allErrs.length?[...new Set(allErrs)].join('\n'):'ошибок нет ни в одном сценарии');
