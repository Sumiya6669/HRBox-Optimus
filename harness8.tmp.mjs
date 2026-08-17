import { chromium } from 'playwright';
import fs from 'fs';
const HOST='dadnsuviohnzisksdbuj.supabase.co';
const UID='11111111-1111-1111-1111-111111111111', EMP='22222222-2222-2222-2222-222222222222';
const F=JSON.parse(fs.readFileSync('fixtures.tmp.json','utf8'));
F.books=[{id:'b1000000-0000-0000-0000-000000000001',title:'Книга',author:'А',category:'c',description:'d',copies:2,cover_url:null,cover_path:null,created_date:'2026-01-01T00:00:00Z'}];
F.courses=[{id:'c1000000-0000-0000-0000-000000000001',title:'Курс',description:'d',format:'video',category:'c',duration_minutes:10,has_certificate:false,status:'draft',is_mandatory:false,deadline:null,cover_url:null,cover_path:null,created_date:'2026-01-01T00:00:00Z'}];
F.pages=[{id:'p1000000-0000-0000-0000-000000000001',title:'Стр',slug:'str',body:'b',status:'draft',published_date:null,show_in_menu:false,cover_url:null,cover_path:null,views:0,created_date:'2026-01-01T00:00:00Z',updated_date:'2026-01-01T00:00:00Z'}];
F.store_items=[{id:'s1000000-0000-0000-0000-000000000001',name:'Награда',description:'d',price:100,icon:'G',category:'c',stock:-1,active:true,image_url:null,image_path:null,created_date:'2026-01-01T00:00:00Z'}];
F.store_orders=[]; F.enrollments=[]; F.book_loans=[]; F.achievements=[{id:'a1000000-0000-0000-0000-000000000001',employee_id:EMP,employee_name:'Иван Иванов',title:'Дост',type:'special',points:10,date:'2026-01-01',auto:false,rule:null,description:null,reason_code:null,icon:'S',image_url:null,image_path:null,created_date:'2026-01-01T00:00:00Z'}];
F.news=[{id:'n1000000-0000-0000-0000-000000000001',title:'Нов',body:'b',excerpt:'e',category:'company',image_url:null,image_path:null,author_name:'A',published_date:'2026-01-01',pinned:false,status:'draft',views:0,created_date:'2026-01-01T00:00:00Z'}];
F.v_news=F.news; F.v_employees=F.employees; F.departments=[]; F.branches=[]; F.employee_private=[];
const errs=[],writes=[];
function applyQuery(rows,search){const sp=new URLSearchParams(search);let out=[...rows];
 for(const [k,v] of sp.entries()){if(['select','order','limit','offset','on_conflict','columns'].includes(k))continue;
  const i=v.indexOf('.');const op=v.slice(0,i);const val=v.slice(i+1);
  out=out.filter(r=>{const cur=r[k];switch(op){
   case 'eq':return String(cur)===val||(val==='true'&&cur===true)||(val==='false'&&cur===false);
   case 'is':return val==='null'?cur===null||cur===undefined:String(cur)===val;
   case 'in':{const l=val.replace(/^\(|\)$/g,'').split(',').map(s=>s.replace(/^"|"$/g,''));return l.includes(String(cur));}
   default:return true;}});}
 return out;}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:1400}});
await ctx.addInitScript(({uid})=>{localStorage.setItem('optimus-kz-auth',JSON.stringify({access_token:'f.j.t',token_type:'bearer',expires_in:999999,expires_at:Math.floor(Date.now()/1000)+999999,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated',email:'hr@optimus-kz.kz',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));},{uid:UID});
await ctx.route(`**://${HOST}/**`,async route=>{const req=route.request();const url=new URL(req.url());const p=url.pathname;
 const single=(req.headers()['accept']||'').includes('pgrst.object');const m=req.method();
 if(p.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 if(p.startsWith('/storage/v1/')){if(m==='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({Key:'x',path:'images/'+UID+'/1-pic.png'})});return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
 if(p.startsWith('/rest/v1/rpc/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 if(p.startsWith('/rest/v1/')){const t=p.replace('/rest/v1/','').split('?')[0];
  if(m!=='GET'&&m!=='HEAD')writes.push({m,t,q:decodeURIComponent(url.search),body:req.postData()});
  let rows=F[t]; if(!rows){errs.push('NO FIXTURE '+t);rows=[];}
  if(m!=='GET'&&m!=='HEAD'){let inp={};try{inp=JSON.parse(req.postData()||'{}');}catch{}
   const one=Array.isArray(inp)?inp[0]:inp; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(single?{id:'x',...one}:[{id:'x',...one}])});}
  const f=applyQuery(rows,url.search);
  return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${Math.max(f.length-1,0)}/${f.length}`,'access-control-expose-headers':'content-range'},body:single?JSON.stringify(f[0]??null):JSON.stringify(f)});}
 return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/Failed to load resource|net::|Не заданы VITE/.test(t))errs.push('CONSOLE '+t.slice(0,200));});
const go=async u=>{await page.goto('http://localhost:4173'+u,{waitUntil:'networkidle'}).catch(()=>{});await page.waitForTimeout(900);};
const dump=l=>{console.log('\n##### '+l);for(const w of writes)console.log(w.m,w.t,'\n   ',w.body);if(!writes.length)console.log('   (нет)');writes.length=0;};

const cases=[
 ['/admin/news',/^Редактировать|^Изменить/,'Сохранить'],
 ['/admin/library',/^Редактировать|^Изменить/,'Сохранить'],
 ['/admin/courses',/^Редактировать|^Изменить/,'Сохранить'],
 ['/admin/pages',/^Редактировать|^Изменить/,'Сохранить'],
 ['/admin/store',/^Редактировать|^Изменить/,'Сохранить'],
 ['/admin/achievements',/^Редактировать|^Изменить/,'Сохранить'],
];
for(const [u,editRe,saveName] of cases){
  await go(u);
  const eb=page.getByRole('button',{name:editRe});
  if(!await eb.count()){console.log('\n##### '+u+': кнопка редактирования не найдена; кнопки: '+(await page.getByRole('button').allInnerTexts()).slice(0,20).join(' | '));continue;}
  await eb.first().click(); await page.waitForTimeout(700);
  const fi=page.locator('[role="dialog"] input[type="file"]');
  if(await fi.count()){await fi.first().setInputFiles({name:'pic.png',mimeType:'image/png',buffer:Buffer.from('89504e470d0a1a0a','hex')});await page.waitForTimeout(1200);}
  else console.log('!! в диалоге '+u+' нет input[type=file]');
  writes.length=0;
  const sb=page.locator('[role="dialog"]').getByRole('button',{name:new RegExp(saveName)});
  if(await sb.count())await sb.last().click(); else console.log('!! нет кнопки сохранения в '+u);
  await page.waitForTimeout(1500);
  dump(u);
}
console.log('\n--- ОШИБКИ JS ---');
console.log(errs.length?[...new Set(errs)].join('\n'):'нет');
await b.close();
