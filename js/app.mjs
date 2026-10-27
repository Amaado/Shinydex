import {GOALS,buildEntries,filterEntries,escapeHtml as esc,fold,makeCommand,toCsv} from './domain.mjs';

const $=id=>document.getElementById(id);
const raw=window.POKEDEX_CONFIG||{};
if(typeof raw.title==='string'&&raw.title.trim())document.title=raw.title.slice(0,60);
const config={supabaseUrl:String(raw.supabaseUrl||'').replace(/\/$/,''),publishableKey:String(raw.publishableKey||''),collection:String(raw.collection||'principal'),refreshSeconds:Math.max(60,Math.min(600,Number(raw.refreshSeconds)||60))};
const HOME='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/';
const state={catalog:[],entries:[],snapshot:null,view:'collection',layout:'grid',status:'all',limit:24,hasData:false,fetching:false,lastUpdated:0,lastAttempt:0,failures:0};
let pollTimer,toastTimer,configError='';

function validConfig(){
  if(!config.supabaseUrl&&!config.publishableKey) return false;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl)){configError='Revisa la URL de Supabase en config.js.';return false;}
  let publicKey=config.publishableKey.startsWith('sb_publishable_');
  if(config.publishableKey.startsWith('eyJ')){
    try{const part=config.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');publicKey=JSON.parse(atob(part)).role==='anon';}catch{publicKey=false;}
  }
  if(!publicKey){configError='config.js necesita la clave publicable de Supabase. Las claves secretas solo van en el servidor del bot.';return false;}
  if(!/^[a-z0-9_-]{1,48}$/.test(config.collection)){configError='Revisa el identificador de colección en config.js.';return false;}
  return true;
}
const configured=validConfig();
const cacheKey=`shinydex:v1:${config.supabaseUrl}:${config.collection}`;

function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function notice(text,button=false){$('statusNotice').hidden=!text;$('statusNotice').replaceChildren();if(!text)return;const span=document.createElement('span');span.textContent=text;$('statusNotice').append(span);if(button){const b=document.createElement('button');b.textContent='Configuración';b.addEventListener('click',()=>openDialog('infoDialog'));$('statusNotice').append(b);}}
function syncState(text,kind=''){$('syncLabel').textContent=text;$('statusDot').className='status-dot '+kind;}
function openDialog(id){const d=$(id);if(!d.open)d.showModal();}
function dateLabel(value,withTime=false){const d=new Date(value);return Number.isNaN(d.getTime())?'Sin fecha':new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',...(withTime?{timeStyle:'short'}:{})}).format(d);}

function sprite(entry){
  if(entry.sprite_url&&/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//.test(entry.sprite_url))return entry.sprite_url;
  return entry.form_key==='normal'?(entry.id<=24?`./assets/sprites/${entry.id}.png`:`${HOME}${entry.id}.png`):null;
}
function portrait(entry,detail=false){
  const url=sprite(entry);
  return url?`<img src="${esc(url)}" alt="${esc(entry.name)} shiny${entry.form_key==='normal'?'':', '+esc(entry.form_label)}" width="${detail?150:116}" height="${detail?150:116}" loading="lazy" decoding="async" data-dex="${entry.id}" data-normal="${entry.form_key==='normal'}">`:'<span class="unknown-form" title="Sin imagen verificada para esta forma" aria-label="Sin imagen verificada">✧</span>';
}
document.addEventListener('error',event=>{
  const img=event.target;
  if(!(img instanceof HTMLImageElement))return;
  if(img.dataset.normal==='true'&&!img.dataset.retried){img.dataset.retried='1';img.src=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${img.dataset.dex}.png`;return;}
  const fallback=document.createElement('span');fallback.className='unknown-form';fallback.textContent='✧';fallback.setAttribute('aria-label','Imagen no disponible');img.replaceWith(fallback);
},true);

function card(entry){
  const progress=entry.completed.size;
  // Orden visual: los tres IV 100 y cinco IV 0, sin crear una novena categoría.
  const goals=GOALS.map(g=>`<div class="goal-cell ${g.group==='0'?'group-zero ':''}${entry.completed.has(g.id)?'done':''}" title="${esc(g.label)}: ${state.hasData?(entry.completed.has(g.id)?'conseguido':'pendiente'):'sin sincronizar'}"><span class="goal-circle" aria-hidden="true">${entry.completed.has(g.id)?'✓':''}</span><span>${g.short}</span><span class="sr-only">${state.hasData?(entry.completed.has(g.id)?'conseguido':'pendiente'):'sin sincronizar'}</span>${g.group==='100'?'<span class="tiny-star" aria-hidden="true">✦</span>':''}</div>`).join('');
  return `<article class="pokemon-card"><div class="card-top"><span class="dex-number">#${String(entry.id).padStart(4,'0')}</span><span class="card-progress ${progress?'has-goals':''}">${state.hasData?`${progress} / 8`:'SIN DATOS'}</span></div><div class="pokemon-portrait">${portrait(entry)}</div><h3 class="pokemon-name">${esc(entry.name)}</h3><p class="form-name">${esc(entry.form_label)}</p><div class="card-goals">${goals}</div><div class="card-footer"><span>${state.hasData?(entry.capture_count?`${entry.capture_count} captura${entry.capture_count===1?'':'s'}`:'Sin capturas'):'Sin sincronizar'}</span><button data-detail="${esc(entry.key)}" aria-label="Ver ficha de ${esc(entry.name)}, ${esc(entry.form_label)}">Ver ficha <span aria-hidden="true">↗</span></button></div></article>`;
}

function table(entries){return `<div class="table-container"><table class="dex-table"><thead><tr><th scope="col">Pokémon / forma</th>${GOALS.map(g=>`<th scope="col" title="${esc(g.label)}">${esc(g.short)}</th>`).join('')}</tr></thead><tbody>${entries.map(e=>`<tr><td><button class="table-pokemon" data-detail="${esc(e.key)}">${portrait(e)}<span><strong>#${String(e.id).padStart(4,'0')} ${esc(e.name)}</strong><small>${esc(e.form_label)}</small></span></button></td>${GOALS.map(g=>`<td>${e.completed.has(g.id)?'<span class="table-check" aria-label="Conseguido">✓</span>':`<span class="table-pending" aria-label="${state.hasData?'Pendiente':'Sin sincronizar'}">·</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}

function updateStats(){
  $('navCount').textContent=state.hasData?String(state.entries.filter(e=>e.completed.size).length):'—';
  $('catalogTotal').textContent=state.catalog.length.toLocaleString('es-ES');
  if(!state.hasData){for(const id of ['statCaptures','statSpecies','statGoals','statComplete'])$(id).textContent='—';$('statGoalTotal').textContent='';$('progressBar').style.width='0%';return;}
  const count=state.entries.filter(e=>e.completed.size).length;
  const goals=state.entries.reduce((n,e)=>n+e.completed.size,0);
  const complete=state.entries.filter(e=>e.completed.size===8).length;
  $('statCaptures').textContent=Number(state.snapshot.captures_total).toLocaleString('es-ES');
  $('statSpecies').textContent=count.toLocaleString('es-ES');$('statGoals').textContent=goals.toLocaleString('es-ES');
  $('statGoalTotal').textContent=`/ ${(state.entries.length*8).toLocaleString('es-ES')}`;
  $('statComplete').textContent=String(complete);$('progressBar').style.width=`${100*complete/state.entries.length}%`;
}

function render(){
  state.entries=buildEntries(state.catalog,state.snapshot||{});updateStats();
  if(state.view==='activity'){renderActivity();return;}
  const goal=$('goalFilter').value;
  const filtered=filterEntries(state.entries,{query:$('search').value,generation:$('generation').value,status:state.status,goal,form:$('formFilter').value,view:state.view});
  const shown=filtered.slice(0,state.limit);
  $('catalog').innerHTML=state.layout==='grid'?shown.map(card).join(''):table(shown);
  $('catalog').setAttribute('aria-busy','false');
  $('emptyState').hidden=filtered.length>0;
  $('catalog').hidden=filtered.length===0;
  $('resultCount').textContent=`${filtered.length.toLocaleString('es-ES')} Pokémon y formas`;
  $('shownCount').textContent=filtered.length?`${shown.length} de ${filtered.length.toLocaleString('es-ES')} registros del catálogo`:'';
  $('loadMore').hidden=shown.length>=filtered.length;
  $('goalHint').textContent=goal?(state.status==='caught'||state.status==='complete'?'✓ Conseguidos: ':'✧ Pendientes: ')+GOALS.find(g=>g.id===goal).short:'✧ 8 objetivos por Pokémon';
}

function renderActivity(){
  const recent=state.snapshot?.recent_captures||[];
  if(!recent.length){$('activityList').innerHTML=`<div class="empty-state"><span aria-hidden="true">✧</span><h3>${state.hasData?'Sin capturas registradas':'Sin datos sincronizados'}</h3><p>${state.hasData?'Registra una captura desde Discord.':'Configura Supabase para consultar las capturas.'}</p><button class="button button-quiet" data-register="true">Registrar una captura</button></div>`;return;}
  const byKey=new Map(state.entries.map(e=>[e.key,e]));
  $('activityList').innerHTML=recent.map(c=>{
    const entry=byKey.get(`${c.dex_id}:${c.form_key}`);
    return `<article class="activity-row">${entry?portrait(entry):'<span class="activity-star" aria-hidden="true">✧</span>'}<div><strong>${esc(c.pokemon_name)} <span aria-hidden="true">✦</span></strong><p>${esc(c.form_label)} · ${esc(c.account)} · ${c.source==='manual'?'Registro manual':'ShinyChecker'}<br>${(c.goals||[]).map(g=>esc(GOALS.find(x=>x.id===g)?.short||g)).join(' &nbsp; / &nbsp; ')}</p></div><time datetime="${esc(c.caught_at)}">${esc(dateLabel(c.caught_at,true))}</time></article>`;
  }).join('');
}

function setView(view){
  state.view=view;state.limit=24;
  for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  const title={collection:'Pokédex',pending:'Pendientes',activity:'Actividad'}[view];
  $('pageTitle').textContent=title;$('breadcrumb').textContent=title;
  $('collectionHeading').textContent=view==='pending'?'Objetivos pendientes':'Pokémon';
  $('activitySection').hidden=view!=='activity';$('collectionSection').hidden=view==='activity';
  if(view==='pending'){state.status='all';$('goalFilter').value='';updateStatusTabs();}
  render();
}
function updateStatusTabs(){for(const b of document.querySelectorAll('[data-status]')){const selected=b.dataset.status===state.status;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}}
function resetFilters(){state.limit=24;state.status='all';for(const id of ['search','generation','goalFilter'])$(id).value='';$('formFilter').value='all';updateStatusTabs();render();}

function openDetail(key){
  const entry=state.entries.find(e=>e.key===key);if(!entry)return;
  const goals=GOALS.map(g=>{const record=entry.goals.find(x=>x.id===g.id);return `<div class="detail-goal ${record?'done':''}"><span aria-hidden="true">${record?'✓':''}</span><div>${esc(g.label)}${record?`<small class="sr-only"> Primera captura ${esc(dateLabel(record.first_caught_at))}</small>`:''}</div><span>${state.hasData?(record?`${record.count} captura${record.count===1?'':'s'}`:'Pendiente'):'Sin datos'}</span></div>`;}).join('');
  $('detailContent').innerHTML=`<button class="close-dialog" aria-label="Cerrar">×</button><div class="detail-portrait">${portrait(entry,true)}</div><p class="detail-label">#${String(entry.id).padStart(4,'0')} · ${esc(entry.form_label)}</p><h2 id="detailTitle" class="detail-title">${esc(entry.name)}</h2><div class="detail-goals">${goals}</div><button class="button button-primary detail-command" data-register="${esc(entry.key)}">Registrar una captura <span aria-hidden="true">＋</span></button><p class="field-note">Las condiciones de una captura se aplican a todas las categorías compatibles. Las formas se contabilizan por separado.</p>`;
  openDialog('detailDialog');
}

function registerFor(key){
  if($('detailDialog').open)$('detailDialog').close();
  $('commandForm').reset();$('commandAccount').value='principal';$('commandResult').hidden=true;
  if(key&&key!=='true'){
    const entry=state.entries.find(e=>e.key===key);
    if(entry){$('commandPokemon').value=String(entry.id);const [form,costume]=entry.form_key.split('|costume:');$('commandFormName').value=form==='normal'?'':form.replace(/^form:/,'');$('commandCostume').value=costume||'';}
  }
  onGoalChange();openDialog('registerDialog');
}
function onGoalChange(){const goal=GOALS.find(g=>g.id===$('commandGoal').value)||GOALS[0];$('commandLevel').disabled=Boolean(goal.level);$('commandSize').disabled=Boolean(goal.size);if(goal.level)$('commandLevel').value=String(goal.level);else if($('commandLevel').disabled===false)$('commandLevel').value='';if(goal.size)$('commandSize').value=goal.size;else $('commandSize').value='';$('commandResult').hidden=true;}

function assertSnapshot(data){
  if(!data||data.version!==1||data.collection!==config.collection||!Array.isArray(data.entries)||!Array.isArray(data.recent_captures)||typeof data.captures_total!=='number')throw new Error('La respuesta de Supabase no tiene el formato esperado. Revisa schema.sql.');
  if(!data.collection_available)throw new Error('La colección no existe o su lectura pública está desactivada.');
  for(const e of data.entries){if(!Number.isInteger(e.dex_id)||typeof e.form_key!=='string'||!Array.isArray(e.goals))throw new Error('Datos de colección incompletos.');}
  return data;
}

async function sync(manual=false){
  clearTimeout(pollTimer);
  if(!configured){syncState('Sin conectar');notice(configError||'Supabase sin configurar.',true);schedule();return;}
  if(state.fetching){schedule();return;}
  if(manual&&Date.now()-state.lastAttempt<10000){notify('La colección se ha consultado hace unos segundos.');schedule();return;}
  if(!navigator.onLine){syncState(state.hasData?'Copia local · sin conexión':'Sin conexión','error');notice('Sin conexión. Se muestran los últimos datos disponibles en este navegador.');schedule();return;}
  state.fetching=true;state.lastAttempt=Date.now();syncState('Sincronizando…');$('syncButton').disabled=true;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const headers={'apikey':config.publishableKey,'Content-Type':'application/json'};
    if(config.publishableKey.startsWith('eyJ'))headers.Authorization=`Bearer ${config.publishableKey}`;
    const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/pokedex_snapshot`,{method:'POST',headers,body:JSON.stringify({p_collection:config.collection}),signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error(`No se pudo leer la colección (HTTP ${response.status}). Revisa la configuración y el SQL.`);
    const data=assertSnapshot(await response.json());
    state.snapshot=data;state.hasData=true;state.lastUpdated=Date.now();state.failures=0;
    try{localStorage.setItem(cacheKey,JSON.stringify({savedAt:state.lastUpdated,data}));}catch{/* La colección no depende del almacenamiento del navegador. */}
    syncState('Colección sincronizada','live');notice('');render();
    $('connectionTitle').textContent='Colección conectada';$('connectionInfo').textContent=`Colección: ${config.collection}. Última lectura: ${dateLabel(new Date(state.lastUpdated),true)}. Se actualiza cada ${config.refreshSeconds} segundos mientras esta página está visible.`;
    if(manual)notify('Colección actualizada.');
  }catch(error){
    state.failures++;syncState(state.hasData?'Última copia · sin actualizar':'No se pudo conectar','error');
    const message=error.name==='AbortError'?'La consulta ha tardado demasiado. Volveremos a intentarlo.':error.message;
    notice(message+(state.hasData?` Últimos datos: ${dateLabel(new Date(state.lastUpdated),true)}.`:''));
  }finally{clearTimeout(timeout);state.fetching=false;$('syncButton').disabled=false;schedule();}
}
function schedule(){clearTimeout(pollTimer);if(configured&&!document.hidden)pollTimer=setTimeout(()=>sync(),Math.min(600,config.refreshSeconds*2**Math.min(state.failures,3))*1000);}

function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}

for(const d of document.querySelectorAll('dialog')){d.addEventListener('click',e=>{if(e.target===d)d.close();});d.addEventListener('click',e=>{if(e.target.closest('.close-dialog'))d.close();});}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>setView(b.dataset.view));
for(const b of document.querySelectorAll('[data-status]'))b.addEventListener('click',()=>{state.status=b.dataset.status;state.limit=24;updateStatusTabs();render();});
for(const id of ['generation','goalFilter','formFilter'])$(id).addEventListener('change',()=>{state.limit=24;render();});
$('search').addEventListener('input',()=>{state.limit=24;render();});
$('resetFilters').addEventListener('click',resetFilters);
$('loadMore').addEventListener('click',()=>{state.limit+=24;render();});
for(const [id,layout] of [['gridView','grid'],['tableView','table']])$(id).addEventListener('click',()=>{state.layout=layout;for(const [other,l] of [['gridView','grid'],['tableView','table']]){$(other).classList.toggle('selected',l===layout);$(other).setAttribute('aria-pressed',String(l===layout));}render();});
document.addEventListener('click',e=>{const detail=e.target.closest('[data-detail]');if(detail)openDetail(detail.dataset.detail);const reg=e.target.closest('[data-register]');if(reg)registerFor(reg.dataset.register);});
$('registerButton').addEventListener('click',()=>registerFor());
for(const id of ['aboutButton','sourcesButton'])$(id).addEventListener('click',()=>openDialog('infoDialog'));
$('syncButton').addEventListener('click',()=>sync(true));
$('commandGoal').addEventListener('change',onGoalChange);
$('commandForm').addEventListener('submit',e=>{e.preventDefault();const text=$('commandPokemon').value.trim();const dex=state.catalog.find(p=>String(p.id)===text.replace(/^#/,'')||[p.name,p.slug,...p.aliases].some(n=>fold(n)===fold(text)));if(!dex){notify('Selecciona un nombre o número de Pokémon del catálogo.');return;}$('generatedCommand').value=makeCommand({pokemon:dex.id,goal:$('commandGoal').value,account:$('commandAccount').value,size:$('commandSize').value,level:$('commandLevel').value,form:$('commandFormName').value.trim(),costume:$('commandCostume').value.trim()});$('commandResult').hidden=false;$('generatedCommand').focus();});
$('copyCommand').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('generatedCommand').value);notify('Comando copiado. Ejecútalo en Discord.');}catch{$('generatedCommand').focus();$('generatedCommand').select();notify('Selecciona el comando y cópialo con Ctrl+C.');}});
$('exportButton').addEventListener('click',()=>{if(!state.hasData){notify('Conecta la colección para exportar tus capturas.');return;}$('exportNote').textContent=`Datos consultados el ${dateLabel(new Date(state.lastUpdated),true)}. Para una copia de seguridad completa conserva también la base SQLite del bot.`;openDialog('exportDialog');});
$('exportCsv').addEventListener('click',()=>{download(toCsv(state.snapshot,state.catalog),'text/csv;charset=utf-8','shinydex-'+config.collection+'.csv');$('exportDialog').close();});
$('exportJson').addEventListener('click',()=>{download(JSON.stringify(state.snapshot,null,2),'application/json','shinydex-'+config.collection+'.json');$('exportDialog').close();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();if(state.view==='activity')setView('collection');$('search').focus();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(Date.now()-state.lastAttempt>=config.refreshSeconds*1000)sync();else schedule();});
window.addEventListener('online',()=>sync());

async function init(){
  try{
    const response=await fetch('./assets/catalog.json');if(!response.ok)throw new Error('No se pudo cargar el catálogo.');state.catalog=await response.json();
    $('goalFilter').insertAdjacentHTML('beforeend',GOALS.map(g=>`<option value="${g.id}">${esc(g.label)}</option>`).join(''));
    $('commandGoal').innerHTML=GOALS.map(g=>`<option value="${g.id}">${esc(g.label)}</option>`).join('');
    $('pokemonNames').innerHTML=state.catalog.map(p=>`<option value="${esc(p.name)}">#${p.id}</option>`).join('');
    if(configured){try{const cached=JSON.parse(localStorage.getItem(cacheKey));if(cached){state.snapshot=assertSnapshot(cached.data);state.hasData=true;state.lastUpdated=cached.savedAt;syncState('Última copia guardada');}}catch{/* Una caché inválida no se utiliza. */}}
    render();await sync();
  }catch(error){notice(error.message+' Abre la web desde GitHub Pages o un servidor HTTP local.');syncState('Catálogo no disponible','error');$('catalog').setAttribute('aria-busy','false');$('resultCount').textContent='Catálogo no disponible';}
}
await init();
