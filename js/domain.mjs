export const GOALS = Object.freeze([
  {id:'shundo',label:'IV 100 · Shiny',short:'100',iv:100,size:null,level:null,group:'100'},
  {id:'shundo_xxs',label:'IV 100 · Shiny · XXS',short:'100 · XXS',iv:100,size:'XXS',level:null,group:'100'},
  {id:'shundo_xxl',label:'IV 100 · Shiny · XXL',short:'100 · XXL',iv:100,size:'XXL',level:null,group:'100'},
  {id:'snundo_l1',label:'IV 0 · Shiny · Nivel 1',short:'0 · N1',iv:0,size:null,level:1,group:'0'},
  {id:'snundo_xxs',label:'IV 0 · Shiny · XXS',short:'0 · XXS',iv:0,size:'XXS',level:null,group:'0'},
  {id:'snundo_xxl',label:'IV 0 · Shiny · XXL',short:'0 · XXL',iv:0,size:'XXL',level:null,group:'0'},
  {id:'snundo_xxs_l1',label:'IV 0 · Shiny · XXS · Nivel 1',short:'0 · XXS · N1',iv:0,size:'XXS',level:1,group:'0'},
  {id:'snundo_xxl_l1',label:'IV 0 · Shiny · XXL · Nivel 1',short:'0 · XXL · N1',iv:0,size:'XXL',level:1,group:'0'}
]);

export function matchedGoals(capture) {
  const ivs=[capture.attack,capture.defense,capture.stamina];
  if(capture.shiny!==true || !ivs.every(v=>Number.isInteger(v)&&v>=0&&v<=15)) return [];
  const sum=ivs.reduce((a,b)=>a+b,0);
  return GOALS.filter(g=>sum===(g.iv===100?45:0) && (!g.size||g.size===capture.size) && (!g.level||capture.level===g.level)).map(g=>g.id);
}

export function fold(text) { return String(text??'').replace(/♀/g,'-f').replace(/♂/g,'-m').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
export function entryKey(dex,form='normal') {return `${dex}:${form}`;}
export function escapeHtml(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

export function buildEntries(catalog,snapshot={}) {
  const byKey=new Map((snapshot.entries||[]).map(e=>[entryKey(e.dex_id,e.form_key),e]));
  const entries=catalog.map(p=>({...p,form_key:'normal',form_label:'Forma normal',sprite_url:null,goals:[],capture_count:0,...byKey.get(entryKey(p.id))}));
  for(const e of byKey.values()) {
    if(e.form_key==='normal') continue;
    const base=catalog.find(p=>p.id===e.dex_id);
    if(base) entries.push({...base,...e,id:e.dex_id,name:base.name});
  }
  return entries.map(e=>({...e,key:entryKey(e.id,e.form_key),completed:new Set(e.goals.map(g=>g.id)),search:fold([e.name,e.id,e.form_label,...(e.aliases||[])].join(' '))}));
}

export function filterEntries(entries,{query='',generation='',status='all',goal='',form='all',view='collection'}={}) {
  const q=fold(query);
  return entries.filter(e=>{
    if(q && !e.search.includes(q) && !String(e.id).padStart(4,'0').includes(q)) return false;
    if(generation && e.generation!==Number(generation)) return false;
    if(form==='normal' && e.form_key!=='normal') return false;
    if(form==='variants' && e.form_key==='normal') return false;
    // El filtro por categoría solo muestra objetivos ya registrados; no existe la vista Pendientes.
    if(goal && !e.completed.has(goal)) return false;
    if(!goal && status==='caught' && !e.completed.size) return false;
    if(status==='complete' && e.completed.size!==8) return false;
    return true;
  });
}

export function makeCommand({pokemon,goal='shundo',size='',level='',account='principal',form='',costume=''}) {
  const g=GOALS.find(x=>x.id===goal)||GOALS[0];
  const options=[`/pokedex registrar pokemon:${pokemon}`,`iv:${g.iv}`,`cuenta:${account}`];
  if(g.size||size) options.push(`tamano:${g.size||size}`);
  if(g.level||level) options.push(`nivel:${g.level||level}`);
  if(form&&form!=='normal') options.push(`forma:${form}`);
  if(costume) options.push(`disfraz:${costume}`);
  return options.join(' ');
}

export function toCsv(snapshot,catalog) {
  const names=new Map(catalog.map(p=>[p.id,p.name]));
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const rows=[['numero','pokemon','forma','capturas',...GOALS.map(g=>g.label)],...(snapshot.entries||[]).map(e=>[
    e.dex_id,names.get(e.dex_id)||e.pokemon_name,e.form_label,e.capture_count,...GOALS.map(g=>e.goals.find(x=>x.id===g.id)?.count||0)
  ])];
  return '\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n');
}
