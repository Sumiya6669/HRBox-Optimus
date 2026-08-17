import fs from 'fs'; import path from 'path';
const root='/home/claude/hrbox';
const mig=fs.readdirSync(path.join(root,'supabase/migrations')).sort();
const cols={}; // table -> Set(columns)
let sql=mig.map(f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8')).join('\n');
// create table
const ct=/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\);/gi;
let m;
while((m=ct.exec(sql))){
  const t=m[1]; const body=m[2];
  cols[t]=cols[t]||new Set();
  for(const raw of body.split('\n')){
    const line=raw.trim();
    if(!line||line.startsWith('--')||line.startsWith('/*')||line.startsWith('*')) continue;
    if(/^(constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/i.test(line)) continue;
    const c=line.match(/^([a-z_][a-z_0-9]*)\s+/i);
    if(c) cols[t].add(c[1]);
  }
}
// alter table add column
const at=/alter\s+table\s+([a-z_0-9]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi;
while((m=at.exec(sql))){ cols[m[1]]=cols[m[1]]||new Set(); cols[m[1]].add(m[2]); }
// views: v_process_requests = process_requests + extras
if(cols['process_requests']){
  cols['v_process_requests']=new Set([...cols['process_requests'],'stage_name','stage_type','is_overdue','awaiting_me','points_preview']);
}
// entity name -> table (из client.js)
const client=fs.readFileSync(path.join(root,'src/api/client.js'),'utf8');
const ent={}; const er=/^\s*([A-Za-z0-9_]+):\s*createEntity\('([a-z_0-9]+)'/gm;
while((m=er.exec(client))) ent[m[1]]=m[2];

// сканируем src
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())w(p); else if(/\.jsx?$/.test(e.name))files.push(p);}})(path.join(root,'src'));
const problems=[];
function keysOf(objSrc){
  // верхнеуровневые ключи объектного литерала
  const out=[]; let depth=0, i=0;
  let expectKey=true; let buf='';
  for(;i<objSrc.length;i++){
    const ch=objSrc[i];
    if('{[('.includes(ch)) depth++;
    else if('}])'.includes(ch)) depth--;
    if(depth===0){
      if(ch===','){expectKey=true;buf='';continue;}
      if(ch===':'&&expectKey){const k=buf.trim().replace(/['"]/g,''); if(/^[a-z_][a-z_0-9]*$/i.test(k))out.push(k); expectKey=false;buf='';continue;}
      buf+=ch;
    }
  }
  return out;
}
function extractBalanced(s,start){ // start — индекс '{'
  let d=0; for(let i=start;i<s.length;i++){ if(s[i]==='{')d++; else if(s[i]==='}'){d--; if(d===0)return s.slice(start+1,i);} } return '';
}
for(const f of files){
  const s=fs.readFileSync(f,'utf8');
  // api.entities.X.create({...}) / .update(id, {...}) / .filter({...}) / bulkCreate([{...}])
  const re=/entities\.([A-Za-z0-9_]+)\.(create|update|filter|bulkCreate|page|count)\s*\(/g;
  let mm;
  while((mm=re.exec(s))){
    const table=ent[mm[1]]; if(!table||!cols[table]) continue;
    const rest=s.slice(mm.index+mm[0].length, mm.index+mm[0].length+4000);
    const bi=rest.indexOf('{');
    if(bi<0||bi>200) continue;
    const body=extractBalanced(rest,bi);
    const ks=keysOf(body);
    const line=s.slice(0,mm.index).split('\n').length;
    for(const k of ks){
      if(['where','sort','page','pageSize','columns'].includes(k)&&['page','count'].includes(mm[2])) continue;
      if(!cols[table].has(k)) problems.push(`${path.relative(root,f)}:${line} ${mm[1]}.${mm[2]} — колонки «${k}» нет в ${table}`);
    }
  }
  // createEntity('table') локально (view)
  const re2=/createEntity\('([a-z_0-9]+)'/g;
  while((mm=re2.exec(s))){ if(!cols[mm[1]]) problems.push(`${path.relative(root,f)}: таблица/вьюха ${mm[1]} не найдена в DDL`); }
}
console.log(problems.length?problems.join('\n'):'OK: все колонки в payload найдены в DDL');
