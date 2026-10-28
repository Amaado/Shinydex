import {initVariantExplorer} from './variants.mjs';
import {ShinydexAuth} from './auth.mjs';
import {WebCapturesClient,buildWebCapture,capturePreview} from './web-captures.mjs';
import {readSnapshots,botPvpRecords,botVariantRecords} from './bot-sync.mjs';
import {GOALS,buildEntries,filterEntries,escapeHtml as esc,fold,makeCommand,toCsv} from './domain.mjs';
import {PVP_SIZES,pvpVariantKey,pvpMarkValid,pvpCompletedSizes} from './extra-goals.mjs';

const $=id=>document.getElementById(id);
const raw=window.POKEDEX_CONFIG||{};
if(typeof raw.title==='string'&&raw.title.trim())document.title=raw.title.slice(0,60);
const config={supabaseUrl:String(raw.supabaseUrl||'').replace(/\/$/,''),publishableKey:String(raw.publishableKey||''),collection:String(raw.collection||'principal'),refreshSeconds:Math.max(10,Math.min(600,Number(raw.refreshSeconds)||10))};
const HOME='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/';
const state={catalog:[],entries:[],snapshot:null,sources:{},botPvpMarks:{},pvpData:null,variantExplorer:null,pvpMarks:{},pvpLookup:new Map(),pvpLimit:24,pvpSelected:null,view:'collection',layout:'grid',status:'all',limit:24,hasData:false,fetching:false,lastUpdated:0,lastAttempt:0,failures:0};
let pollTimer,toastTimer,configError='',selectedVariant=null;

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
const auth=configured?new ShinydexAuth({url:config.supabaseUrl,key:config.publishableKey}):null;
let initCompleted=false;
const cacheKey=()=>`shinydex:v1:${config.supabaseUrl}:${config.collection}:${auth?.value?.user_id||'guest'}`;
const webClient=auth?new WebCapturesClient({url:config.supabaseUrl,key:config.publishableKey,token:()=>auth.token()}):null;
const pvpCacheKey=()=>`shinydex:pvp:v1:${config.supabaseUrl}:${config.collection}:${auth?.value?.user_id||'guest'}`;
// Migra las marcas locales previas una sola vez al primer usuario autenticado.
// Evita que una segunda cuenta del mismo navegador herede marcas de la primera.
function migrateLegacyMarks(){
  const owner=auth?.value?.user_id;
  if(!owner)return;
  const prefix=`${config.supabaseUrl}:${config.collection}`;
  const migrationOwner=`shinydex:migration-owner:v1:${prefix}`;
  try{
    const assigned=localStorage.getItem(migrationOwner);
    if(assigned&&assigned!==owner)return;
    const keys=[
      [`shinydex:pvp:v1:${prefix}`,`shinydex:pvp:v1:${prefix}:${owner}`],
      [`shinydex:variants:v2:${prefix}`,`shinydex:variants:v2:${prefix}:${owner}`]
    ];
    // Si la instalación antigua solo utilizaba el formato v1 de variantes, se
    // conserva como copia de respaldo y el explorador lo importa como v2.
    const oldVariant=`shinydex:variants:v1:${prefix}`;
    const newVariant=`shinydex:variants:v2:${prefix}:${owner}`;
    if(!localStorage.getItem(newVariant)&&!localStorage.getItem(`shinydex:variants:v2:${prefix}`)){
      const legacy=localStorage.getItem(oldVariant);
      if(legacy){try{const data=JSON.parse(legacy);if(data?.version===1&&data.records)localStorage.setItem(newVariant,JSON.stringify({version:2,collection:config.collection,records:data.records}));}catch{}}
    }
    for(const [oldKey,newKey] of keys)if(!localStorage.getItem(newKey)){
      const legacy=localStorage.getItem(oldKey);
      if(legacy)localStorage.setItem(newKey,legacy);
    }
    if(!assigned)localStorage.setItem(migrationOwner,owner);
  }catch{/* Si no hay almacenamiento, la conexión de Supabase sigue funcionando. */}
}
const LEAGUES=['great','ultra','baby'];
const LEAGUE_LABELS={great:'Superliga',ultra:'Ultraliga',baby:'Baby League'};
const LEAGUE_CHIPS={great:'Super',ultra:'Ultra',baby:'Baby'};
function pvpKey(league,target,size=''){return pvpVariantKey(league,target.destination.key,size);}
function pvpItem(league,key){return state.pvpLookup.get(`${league}:${key}`);}
function pvpRecord(league,target,size=''){
  const key=pvpKey(league,target,size);
  if(size)return state.pvpMarks[key]||state.botPvpMarks[key];
  return state.pvpMarks[key]||state.botPvpMarks[key]
    ||state.pvpMarks[pvpKey(league,target,'XXS')]||state.botPvpMarks[pvpKey(league,target,'XXS')]
    ||state.pvpMarks[pvpKey(league,target,'XXL')]||state.botPvpMarks[pvpKey(league,target,'XXL')];
}
function pvpDone(league,target,size=''){return Boolean(pvpRecord(league,target,size));}
function pvpProgress(league,target){return pvpCompletedSizes(league,target,state.pvpMarks,state.botPvpMarks).length;}
function pvpSelection(){return $('pvpSizeFilter').value;}
function pvpBadge(entry){
  if(!state.pvpData)return '';
  const chips=[];
  const form=entry.form_key==='normal'?'normal':entry.form_key.replace(/^form:/,'').split('|')[0];
  for(const league of LEAGUES){
    const target=pvpItem(league,`${entry.id}:${form}`);
    if(!target)continue;
    const done=pvpDone(league,target);
    chips.push(`<button class="pvp-chip ${done?'pvp-chip-done':''}" data-pvp-open="${esc(league)}" data-pvp-dest="${esc(target.destination.key)}" title="${esc(LEAGUE_LABELS[league])} #${target.rank} · IV ${target.iv.join('/')}">${LEAGUE_CHIPS[league]} · ${done?'✓ Shiny':'Ver objetivo'}</button>`);
  }
  return chips.length?`<div class="pvp-chips">${chips.join('')}</div>`:'';
}
function loadPvpMarks(){
  try{
    const data=JSON.parse(localStorage.getItem(pvpCacheKey())||'{}');
    const records=data?.version===1&&data?.records&&typeof data.records==='object'?data.records:{};
    state.pvpMarks={};
    for(const [key,record] of Object.entries(records)){
      const size=key.endsWith('#XXS')?'XXS':key.endsWith('#XXL')?'XXL':'';
      const base=size?key.slice(0,-(size.length+1)):key;
      const target=state.pvpLookup.get(base);
      if(target&&pvpMarkValid(target,record,size))state.pvpMarks[key]=record;
    }
  }catch{state.pvpMarks={};}
}
function savePvpMarks(){
  try{localStorage.setItem(pvpCacheKey(),JSON.stringify({version:1,collection:config.collection,records:state.pvpMarks}));return true;}
  catch{notify('No se pudo guardar el progreso. Comprueba el almacenamiento del navegador.');return false;}
}
function pvpExport(){
  const backup={version:1,collection:config.collection,exportedAt:new Date().toISOString(),records:state.pvpMarks};
  download(JSON.stringify(backup,null,2),'application/json','shinydex-pvp-'+config.collection+'.json');
}
async function pvpImport(file){
  if(!file)return;
  if(file.size>2000000){notify('El archivo supera 2 MB.');return;}
  try{
    const backup=JSON.parse(await file.text());
    if(backup.version!==1||backup.collection!==config.collection||!backup.records||typeof backup.records!=='object'||Array.isArray(backup.records))throw new Error('El archivo no corresponde a esta colección o versión.');
    const accepted={};let rejected=0;
    for(const [key,record] of Object.entries(backup.records)){
      const size=key.endsWith('#XXS')?'XXS':key.endsWith('#XXL')?'XXL':'';
      const item=state.pvpLookup.get(size?key.slice(0,-size.length-1):key);
      if(item&&pvpMarkValid(item,record,size))accepted[key]=record;else rejected++;
    }
    const count=Object.keys(accepted).length;
    if(!confirm(`Importar ${count} objetivos válidos (${rejected} descartados)? Se mantendrán los objetivos locales que no estén en el archivo.`))return;
    state.pvpMarks={...state.pvpMarks,...accepted};if(savePvpMarks()){render();notify(`Importados ${count} objetivos PvP.`);}
  }catch(error){notify('No se pudo importar el progreso: '+error.message);}
}


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
  if(img.classList.contains('variant-scene')){img.remove();return;}
  if(img.classList.contains('variant-mon')&&!img.dataset.retried){img.dataset.retried='1';img.src=img.dataset.fallback;const note=img.parentElement?.querySelector('.variant-picture-note');if(!note)img.insertAdjacentHTML('afterend','<span class="variant-picture-note">Imagen de especie (no del disfraz)</span>');return;}
  if(img.dataset.normal==='true'&&!img.dataset.retried){img.dataset.retried='1';img.src=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${img.dataset.dex}.png`;return;}
  const fallback=document.createElement('span');fallback.className='unknown-form';fallback.textContent='✧';fallback.setAttribute('aria-label','Imagen no disponible');img.replaceWith(fallback);
},true);

function card(entry){
  const progress=entry.completed.size;
  // Orden visual: los tres IV 100 y cinco IV 0, sin crear una novena categoría.
  const goals=GOALS.map(g=>`<div class="goal-cell ${g.group==='0'?'group-zero ':''}${entry.completed.has(g.id)?'done':''}" title="${esc(g.label)}: ${state.hasData?(entry.completed.has(g.id)?'conseguido':'sin registrar'):'sin sincronizar'}"><span class="goal-circle" aria-hidden="true">${entry.completed.has(g.id)?'✓':''}</span><span>${g.short}</span><span class="sr-only">${state.hasData?(entry.completed.has(g.id)?'conseguido':'sin registrar'):'sin sincronizar'}</span>${g.group==='100'?'<span class="tiny-star" aria-hidden="true">✦</span>':''}</div>`).join('');
  return `<article class="pokemon-card"><div class="card-top"><span class="dex-number">#${String(entry.id).padStart(4,'0')}</span><span class="card-progress ${progress?'has-goals':''}">${state.hasData?`${progress} / 8`:'SIN DATOS'}</span></div><div class="pokemon-portrait">${portrait(entry)}</div><h3 class="pokemon-name">${esc(entry.name)}</h3><p class="form-name">${esc(entry.form_label)}</p><div class="card-goals">${goals}</div>${pvpBadge(entry)}<div class="card-footer"><span>${state.hasData?(entry.capture_count?`${entry.capture_count} captura${entry.capture_count===1?'':'s'}`:'Sin capturas'):'Sin sincronizar'}</span><button data-detail="${esc(entry.key)}" aria-label="Ver ficha de ${esc(entry.name)}, ${esc(entry.form_label)}">Ver ficha <span aria-hidden="true">↗</span></button></div></article>`;
}

function table(entries){return `<div class="table-container"><table class="dex-table"><thead><tr><th scope="col">Pokémon / forma</th>${GOALS.map(g=>`<th scope="col" title="${esc(g.label)}">${esc(g.short)}</th>`).join('')}<th scope="col">Superliga</th><th scope="col">Ultraliga</th><th scope="col">Baby League</th></tr></thead><tbody>${entries.map(e=>`<tr><td><button class="table-pokemon" data-detail="${esc(e.key)}">${portrait(e)}<span><strong>#${String(e.id).padStart(4,'0')} ${esc(e.name)}</strong><small>${esc(e.form_label)}</small></span></button></td>${GOALS.map(g=>`<td>${e.completed.has(g.id)?'<span class="table-check" aria-label="Conseguido">✓</span>':`<span class="table-pending" aria-label="${state.hasData?'Sin registro':'Sin sincronizar'}">·</span>`}</td>`).join('')}${LEAGUES.map(league=>{const target=pvpItem(league,`${e.id}:${e.form_key==='normal'?'normal':e.form_key.replace(/^form:/,'').split('|')[0]}`);return `<td>${target?`<button class="pvp-table-link" data-pvp-open="${league}" data-pvp-dest="${esc(target.destination.key)}">${pvpDone(league,target)?'✓':'·'} #${target.rank}</button>`:'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;}

function updateStats(){
  $('navCount').textContent=state.hasData?String(state.entries.filter(e=>e.completed.size||e.capture_count).length):'—';
  $('catalogTotal').textContent=state.catalog.length.toLocaleString('es-ES');
  if(!state.hasData){for(const id of ['statCaptures','statSpecies','statGoals','statComplete'])$(id).textContent='—';$('statGoalTotal').textContent='';$('progressBar').style.width='0%';return;}
  const count=state.entries.filter(e=>e.completed.size||e.capture_count).length;
  const goals=state.entries.reduce((n,e)=>n+e.completed.size,0);
  const complete=state.entries.filter(e=>e.completed.size===8).length;
  $('statCaptures').textContent=Number(state.snapshot.captures_total).toLocaleString('es-ES');
  $('statSpecies').textContent=count.toLocaleString('es-ES');$('statGoals').textContent=goals.toLocaleString('es-ES');
  $('statGoalTotal').textContent=`/ ${(state.entries.length*8).toLocaleString('es-ES')}`;
  $('statComplete').textContent=String(complete);$('progressBar').style.width=`${100*complete/state.entries.length}%`;
}

function filteredCatalogEntries(){
  return filterEntries(state.entries,{
    query:$('search').value,generation:$('generation').value,
    status:state.status,goal:$('goalFilter').value,
    form:$('formFilter').value,view:state.view
  });
}

function render(){
  state.entries=buildEntries(state.catalog,state.snapshot||{});updateStats();
  if(state.pvpData)for(const league of LEAGUES)$(league+'NavCount').textContent=String(state.pvpData.leagues[league].reduce((n,t)=>n+pvpProgress(league,t),0));
  if(state.view==='activity'){renderActivity();return;}
  if(state.view==='variants'){return;}
  if(LEAGUES.includes(state.view)){renderPvp();return;}
  const goal=$('goalFilter').value;
  const filtered=filteredCatalogEntries();
  const shown=filtered.slice(0,state.limit);
  $('catalog').innerHTML=state.layout==='grid'?shown.map(card).join(''):table(shown);
  $('catalog').setAttribute('aria-busy','false');
  $('emptyState').hidden=filtered.length>0;
  $('catalog').hidden=filtered.length===0;
  $('resultCount').textContent=`${filtered.length.toLocaleString('es-ES')} Pokémon y formas`;
  $('shownCount').textContent=filtered.length?`${shown.length} de ${filtered.length.toLocaleString('es-ES')} registros del catálogo`:'';
  $('loadMore').hidden=shown.length>=filtered.length;
  $('goalHint').textContent=goal?'✓ Objetivo: '+GOALS.find(g=>g.id===goal).short:'✧ 8 objetivos por Pokémon';
}

/** Añade solo el siguiente bloque al DOM para evitar saltos de scroll. */
function showMoreCatalog(){
  if(state.view==='activity'||LEAGUES.includes(state.view))return;
  const filtered=filteredCatalogEntries();
  const next=filtered.slice(state.limit,state.limit+24);
  if(!next.length){$('loadMore').hidden=true;return;}
  if(state.layout==='grid'){
    $('catalog').insertAdjacentHTML('beforeend',next.map(card).join(''));
  }else{
    const template=document.createElement('template');
    template.innerHTML=table(next);
    const tbody=$('catalog').querySelector('tbody');
    const nextRows=template.content.querySelectorAll('tbody tr');
    if(tbody)tbody.append(...nextRows);
    else { state.limit+=next.length;render();return; }
  }
  state.limit+=next.length;
  $('shownCount').textContent=`${Math.min(state.limit,filtered.length)} de ${filtered.length.toLocaleString('es-ES')} registros del catálogo`;
  $('loadMore').hidden=state.limit>=filtered.length;
}

function renderActivity(){
  const recent=state.snapshot?.recent_captures||[];
  if(!recent.length){$('activityList').innerHTML=`<div class="empty-state"><span aria-hidden="true">✧</span><h3>${state.hasData?'Sin capturas registradas':'Sin datos sincronizados'}</h3><p>${state.hasData?'Registra una captura desde la web o desde Discord.':'Configura Supabase para consultar las capturas.'}</p><button class="button button-quiet" data-register="true">Registrar una captura</button></div>`;return;}
  const byKey=new Map(state.entries.map(e=>[e.key,e]));
  $('activityList').innerHTML=recent.map(c=>{
    const entry=byKey.get(`${c.dex_id}:${c.form_key}`);
    return `<article class="activity-row">${entry?portrait(entry):'<span class="activity-star" aria-hidden="true">✧</span>'}<div><strong>${esc(c.pokemon_name)} <span aria-hidden="true">✦</span></strong><p>${esc(c.form_label)} · ${esc(c.account)} · ${c.source==='manual'?'Registro manual':c.source==='web'?'Registro web':c.source==='shiny-sniper'?'Discord / Shiny Sniper':'ShinyChecker'}<br>${(c.goals||[]).map(g=>esc(GOALS.find(x=>x.id===g)?.short||g)).join(' &nbsp; / &nbsp; ')}</p></div><time datetime="${esc(c.caught_at)}">${esc(dateLabel(c.caught_at,true))}</time>${c.source==='web'&&/^[0-9a-f-]{36}$/.test(String(c.web_id))?`<button type="button" class="button button-quiet web-delete" data-web-delete="${esc(c.web_id)}" aria-label="Eliminar captura de ${esc(c.pokemon_name)}">Eliminar</button>`:''}</article>`;
  }).join('');
}

function setView(view){
  state.view=view;state.limit=24;
  for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  const title={collection:'Pokédex',activity:'Actividad',great:'Superliga',ultra:'Ultraliga',baby:'Baby League',variants:'Disfraces y fondos'}[view];
  $('pageTitle').textContent=title;$('breadcrumb').textContent=title;
  $('collectionHeading').textContent='Pokémon';
  const isPvp=LEAGUES.includes(view);
  const isVariant=view==='variants';
  state.variantExplorer?.show(isVariant);
  $('activitySection').hidden=view!=='activity';$('collectionSection').hidden=view==='activity'||isPvp||isVariant;
  $('pvpSection').hidden=!isPvp;$('variantSection').hidden=!isVariant;document.querySelector('.stats').hidden=isPvp||isVariant;
  $('registerButton').hidden=false;$('exportButton').hidden=isPvp||isVariant;
  if(isPvp){state.pvpLimit=24;$('pvpSearch').value='';$('pvpStateFilter').value='all';$('pvpSizeFilter').value='all';$('pvpSort').value='rank';}
  render();
}
function updateStatusTabs(){for(const b of document.querySelectorAll('[data-status]')){const selected=b.dataset.status===state.status;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}}
function resetFilters(){state.limit=24;state.status='all';for(const id of ['search','generation','goalFilter'])$(id).value='';$('formFilter').value='all';updateStatusTabs();render();}

function openDetail(key){
  const entry=state.entries.find(e=>e.key===key);if(!entry)return;
  state.detailKey=key;
  const goals=GOALS.map(g=>{const record=entry.goals.find(x=>x.id===g.id);return `<div class="detail-goal ${record?'done':''}"><span aria-hidden="true">${record?'✓':''}</span><div>${esc(g.label)}${record?`<small class="sr-only"> Primera captura ${esc(dateLabel(record.first_caught_at))}</small>`:''}</div><span>${state.hasData?(record?`${record.count} captura${record.count===1?'':'s'}`:'Sin registrar'):'Sin datos'}</span></div>`;}).join('');
  const pvpForm=entry.form_key==='normal'?'normal':entry.form_key.replace(/^form:/,'').split('|')[0];
  const pvpGoals=LEAGUES.map(league=>({league,target:pvpItem(league,`${entry.id}:${pvpForm}`)})).filter(x=>x.target);
  const pvpDetails=pvpGoals.length?`<h3 class="pvp-detail-heading">Objetivos PvP</h3><div class="pvp-details">${pvpGoals.map(({league,target})=>`<button class="pvp-detail-action" data-pvp-open="${league}" data-pvp-dest="${esc(target.destination.key)}"><strong>${esc(LEAGUE_LABELS[league])} · #${target.rank}</strong><small>IV ${target.iv.join('/')} · ${pvpDone(league,target)?'✓ Registrado':'Sin registrar'}</small></button>`).join('')}</div>`:'';
  $('detailContent').innerHTML=`<button class="close-dialog" aria-label="Cerrar">×</button><div class="detail-portrait">${portrait(entry,true)}</div><p class="detail-label">#${String(entry.id).padStart(4,'0')} · ${esc(entry.form_label)}</p><h2 id="detailTitle" class="detail-title">${esc(entry.name)}</h2><div class="detail-goals">${goals}</div>${pvpDetails}<button class="button button-primary detail-command" data-register="${esc(entry.key)}">Registrar una captura <span aria-hidden="true">＋</span></button><p class="field-note">Las condiciones de una captura se aplican a todas las categorías compatibles. Las formas se contabilizan por separado.</p>`;
  openDialog('detailDialog');
}

function filteredPvpTargets(league){
  const targets=state.pvpData?.leagues?.[league]||[];
  const query=fold($('pvpSearch').value.trim());
  const status=$('pvpStateFilter').value;
  const size=pvpSelection();
  let entries=targets.filter(t=>(!query||fold([t.destination.name,t.rank,...t.candidates.map(c=>c.name)].join(' ')).includes(query))&&(status==='all'||(size==='all'?pvpProgress(league,t)>0:pvpDone(league,t,size))));
  if($('pvpSort').value==='name')entries=entries.slice().sort((a,b)=>a.destination.name.localeCompare(b.destination.name,'es'));
  if($('pvpSort').value==='dex')entries=entries.slice().sort((a,b)=>a.destination.dexId-b.destination.dexId||a.rank-b.rank);
  return entries;
}

function renderPvp(){
  const league=state.view;
  const targets=state.pvpData?.leagues?.[league]||[];
  const done=targets.reduce((n,t)=>n+pvpProgress(league,t),0);
  const goalTotal=targets.length*PVP_SIZES.length;
  $('greatNavCount').textContent=state.pvpData?String(state.pvpData.leagues.great.reduce((n,t)=>n+pvpProgress('great',t),0)):'—';
  $('ultraNavCount').textContent=state.pvpData?String(state.pvpData.leagues.ultra.reduce((n,t)=>n+pvpProgress('ultra',t),0)):'—';
  $('babyNavCount').textContent=state.pvpData?String(state.pvpData.leagues.baby.reduce((n,t)=>n+pvpProgress('baby',t),0)):'—';
  $('pvpSectionTitle').textContent=LEAGUE_LABELS[league];
  $('pvpDescription').textContent=league==='baby'
    ? `${targets.length} destinos de Little Cup (500 PC). Cada uno tiene 3 objetivos: shiny, XXS y XXL. Captura directa, sin evolucionar.`
    : `${targets.length} destinos del CSV con 3 objetivos independientes por destino: shiny, XXS y XXL. Las preevoluciones no suman destinos.`;
  $('pvpDone').textContent=`${done} / ${goalTotal}`;
  $('pvpPercent').textContent=`${goalTotal?Math.round(done*100/goalTotal):0} % completado`;
  $('pvpProgressBar').style.width=`${goalTotal?done*100/goalTotal:0}%`;
  const entries=filteredPvpTargets(league);
  const shown=entries.slice(0,state.pvpLimit);
  $('pvpCatalog').innerHTML=shown.map(t=>pvpCard(league,t)).join('');
  $('pvpEmpty').hidden=entries.length!==0;
  $('pvpResults').textContent=`${entries.length} destinos · ${done} de ${goalTotal} variantes registradas`;
  $('pvpShown').textContent=entries.length?`${shown.length} de ${entries.length} objetivos`:'';
  $('pvpMore').hidden=shown.length>=entries.length;
}
function showMorePvp(){
  if(!LEAGUES.includes(state.view))return;
  const league=state.view;
  const entries=filteredPvpTargets(league);
  const next=entries.slice(state.pvpLimit,state.pvpLimit+24);
  if(!next.length){$('pvpMore').hidden=true;return;}
  $('pvpCatalog').insertAdjacentHTML('beforeend',next.map(t=>pvpCard(league,t)).join(''));
  state.pvpLimit+=next.length;
  $('pvpShown').textContent=`${Math.min(state.pvpLimit,entries.length)} de ${entries.length} objetivos`;
  $('pvpMore').hidden=state.pvpLimit>=entries.length;
}

function pvpCard(league,target){
  const marked=pvpProgress(league,target)>0,record=pvpRecord(league,target);
  const {destination:dest,iv,rank,candidates,level}=target;
  const photo=dest.form==='normal'?`<img src="${esc(dest.dexId<=24?`./assets/sprites/${dest.dexId}.png`:`${HOME}${dest.dexId}.png`)}" alt="Imagen shiny de ${esc(dest.name)}" loading="lazy" width="102" height="102" data-dex="${dest.dexId}" data-normal="true">`:'<span class="pvp-form-image" aria-label="Forma especial, sin imagen verificada">✧</span>';
  return `<article class="pvp-target-card ${marked?'pvp-target-completed':''}">
    <div class="pvp-target-head"><span class="pvp-rank">#${rank} en el ranking</span><span class="pvp-state ${marked?'done':''}">${marked?'✓ Registrado':'Sin registrar'}</span></div>
    <div class="pvp-target-main"><div class="pvp-target-portrait">${photo}</div><div><span class="dex-number">#${String(dest.dexId).padStart(4,'0')}</span><h3>${esc(dest.name)}</h3><p>Pokémon destino</p></div></div>
    <div class="pvp-specs"><span><small>IV objetivo</small><strong>${iv.join(' / ')}</strong></span><span><small>Nivel del destino</small><strong>${Number.isInteger(level)?level:String(level).replace('.',',')}</strong></span></div>
    <div class="pvp-candidate-list"><strong>${league==='baby'?'Captura directa del CSV':'Candidatos de captura del CSV'}</strong><div>${candidates.map(c=>`<span>${esc(c.name)}</span>`).join('')}</div></div>
    <div class="pvp-size-goals" aria-label="Variantes shiny por tamaño">
      ${PVP_SIZES.map(size=>`<button type="button" class="pvp-size-goal ${pvpDone(league,target,size)?'done':''}" data-pvp-open="${esc(league)}" data-pvp-dest="${esc(dest.key)}" data-pvp-size="${esc(size)}" aria-label="${size||'Shiny, cualquier tamaño'}: ${pvpDone(league,target,size)?'conseguido':'sin registrar'}">${pvpDone(league,target,size)?'✓ ':''}${size||'Shiny'}</button>`).join('')}
    </div>
    ${marked?`<div class="pvp-record">${pvpProgress(league,target)} / 3 variantes · ${esc(record.candidateName||'Shiny registrado')} · ${esc(dateLabel(record.date))}</div>`:''}
    <button class="button ${marked?'button-quiet':'button-primary'} pvp-card-action" data-pvp-open="${esc(league)}" data-pvp-dest="${esc(dest.key)}" data-pvp-size="">${marked?'Ver o añadir captura':'Registrar shiny conseguido'}</button>
  </article>`;
}
function openPvpDialog(league,destinationKey,sizeGoal=''){
  const target=pvpItem(league,destinationKey);if(!target)return;
  if($('detailDialog').open)$('detailDialog').close();
  if(!PVP_SIZES.includes(sizeGoal))sizeGoal='';
  state.pvpSelected={league,destinationKey,sizeGoal};
  const record=pvpRecord(league,target,sizeGoal);
  $('pvpDialogTitle').textContent=`${LEAGUE_LABELS[league]} · ${target.destination.name} · ${sizeGoal||'Shiny'}`;
  $('pvpDialogDescription').textContent=league==='baby'
    ? `Puesto #${target.rank} de Little Cup (500 PC). Registra un ${target.destination.name} shiny directamente, con los IV del CSV, sin evolucionarlo.`
    : `Puesto #${target.rank}. Registra un shiny de la lista que puedas evolucionar hasta ${target.destination.name} (o el propio destino).`;
  $('pvpCandidate').replaceChildren();
  for(const candidate of target.candidates){const opt=document.createElement('option');opt.value=candidate.key;opt.textContent=candidate.name;$('pvpCandidate').append(opt);}
  $('pvpCandidate').value=record?.candidateKey||target.candidates[0].key;
  $('pvpExpected').textContent=league==='baby'
    ? `IV requeridos: ${target.iv.join('/')} · Nivel objetivo de captura: ${target.level} · Máximo 500 PC (no verificado por la web)`
    : `IV requeridos: ${target.iv.join('/')} · Nivel objetivo tras evolucionar: ${target.level}`;
  for(const [id,i] of [['pvpAtk',0],['pvpDef',1],['pvpHp',2]])$(id).value=record?String(record.iv[i]):'';
  $('pvpSize').value=sizeGoal||record?.size||'';
  $('pvpSize').disabled=Boolean(sizeGoal);
  $('pvpConfirm').checked=false;
  $('pvpRemove').hidden=!state.pvpMarks[pvpKey(league,target,sizeGoal)];
  if(record?.source==='bot')$('pvpDialogDescription').textContent+=' Captura sincronizada desde Discord. Para deshacerla utiliza el bot.';
  openDialog('pvpDialog');
}
function savePvpRecord(event){
  event.preventDefault();const {league,destinationKey,sizeGoal=''}=state.pvpSelected||{};
  const target=pvpItem(league,destinationKey);if(!target)return;
  const iv=['pvpAtk','pvpDef','pvpHp'].map(id=>$(id).value.trim());
  if(iv.some(v=>!/^\d{1,2}$/.test(v))){notify('Introduce los tres IV en formato 0–15.');return;}
  const parsed=iv.map(Number);
  if(parsed.some((v,i)=>v!==target.iv[i])){notify(`Estos IV no coinciden con el objetivo: ${target.iv.join('/')}. No se ha registrado.`);return;}
  const candidate=target.candidates.find(c=>c.key===$('pvpCandidate').value);
  if(!candidate||!$('pvpConfirm').checked){notify('Elige un Pokémon válido y confirma que es shiny.');return;}
  const size=$('pvpSize').value;
  if(sizeGoal&&size!==sizeGoal){notify('Selecciona el tamaño exacto del objetivo.');return;}
  const key=pvpKey(league,target,sizeGoal),previous=state.pvpMarks[key];
  const value={candidateKey:candidate.key,candidateName:candidate.name,iv:parsed,size,date:previous?.date||new Date().toISOString()};
  state.pvpMarks[key]=value;
  if(size==='XXS'||size==='XXL'){
    state.pvpMarks[pvpKey(league,target,size)]={...value};
  }
  // Una captura pequeña o grande también cumple el shiny genérico.
  if(!state.pvpMarks[pvpKey(league,target)])state.pvpMarks[pvpKey(league,target)]={...value};
  if(savePvpMarks()){$('pvpDialog').close();render();notify('Objetivo PvP registrado en este navegador.');}
}
function removePvpRecord(){
  const {league,destinationKey,sizeGoal=''}=state.pvpSelected||{};
  const target=pvpItem(league,destinationKey);if(!target)return;
  if(!confirm(`¿Quitar el registro PvP de ${target.destination.name} en ${LEAGUE_LABELS[league]}?`))return;
  delete state.pvpMarks[pvpKey(league,target,sizeGoal)];
  if(savePvpMarks()){$('pvpDialog').close();render();notify('Registro PvP eliminado.');}
}

function registerFor(key){
  if($('detailDialog').open)$('detailDialog').close();
  $('webCaptureForm').reset();$('webAccount').value='principal';$('webForm').value='normal';
  $('webCaptureError').hidden=true;selectedVariant=null;$('webVariantDescription').hidden=true;
  if(key&&key!=='true'){
    const entry=state.entries.find(e=>e.key===key);
    if(entry){
      $('webPokemon').value=String(entry.id);
      const [form,costume]=entry.form_key.split('|costume:');
      $('webForm').value=form==='normal'?'normal':form.replace(/^form:/,'');
      $('webCostume').value=costume||'';
    }
  }
  updateWebPreview();openDialog('registerDialog');
}
function registerVariantFromCatalog(row){
  registerFor();
  selectedVariant=row;
  $('webPokemon').value=String(row.dex);
  const slug=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,80);
  $('webCostume').value=row.costume?slug(row.formId||row.costume):'';
  $('webVariantDescription').textContent=`Variante exacta: ${row.costume?`Disfraz ${row.costume}`:''}${row.background?` · Fondo ${row.background}`:''}. No cambies el Pokémon ni la variante para conservar esta asociación.`;
  $('webVariantDescription').hidden=false;
  updateWebPreview();
}
function webFields(){return {
  pokemon:$('webPokemon').value,attack:$('webAttack').value,defense:$('webDefense').value,stamina:$('webStamina').value,
  account:$('webAccount').value,level:$('webLevel').value,size:$('webSize').value,form:$('webForm').value,
  costume:$('webCostume').value,background:selectedVariant?.background?String(selectedVariant.background).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,80):'',
  variantKey:selectedVariant?.key||'',variantKind:selectedVariant?.kind||'',variantDex:selectedVariant?.dex,
  caughtAt:$('webCaughtAt').value,confirmed:$('webConfirmed').checked
};}
function updateWebPreview(){
  try{
    const c=buildWebCapture({...webFields(),confirmed:true},state.catalog);
    const goals=capturePreview(c);
    $('webCapturePreview').textContent=goals.length
      ?`Esta captura completará ${goals.length} objetivo(s): ${goals.map(id=>GOALS.find(g=>g.id===id)?.short).join(', ')}.`
      :'Esta captura se registrará como shiny; no satisface las 8 categorías de IV 100/0 con los datos indicados. Puede contar para PvP si coincide con los IV y el nivel objetivo.';
  }catch(error){$('webCapturePreview').textContent='Introduce el Pokémon y sus datos reales para ver las categorías compatibles.';}
}
async function saveWebCapture(event){
  event.preventDefault();$('webCaptureError').hidden=true;
  if(!webClient){$('webCaptureError').textContent='Configura Supabase e inicia sesión para guardar capturas.';$('webCaptureError').hidden=false;return;}
  const submit=$('webCaptureSubmit');submit.disabled=true;
  try{
    const capture=buildWebCapture(webFields(),state.catalog);
    await webClient.add(config.collection,capture);
    $('registerDialog').close();notify('Captura guardada en Supabase.');
    // No se guardan duplicados locales: sincronización del registro recién confirmado.
    await sync();
  }catch(error){$('webCaptureError').textContent=error.message;$('webCaptureError').hidden=false;}
  finally{submit.disabled=false;}
}
async function deleteWebCapture(id){
  if(!webClient||!confirm('¿Eliminar esta captura registrada desde la web? Se recalcularán las categorías que cubre.'))return;
  try{await webClient.remove(config.collection,id);notify('Captura eliminada.');await sync();}
  catch(error){notify('Error al eliminar: '+error.message);}
}

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
    const accessToken=auth?await auth.token():null;
    if(auth&&!accessToken){lockAuth('Tu sesión ha caducado. Vuelve a iniciar sesión.');return;}
    const {snapshot,parts,warnings}=await readSnapshots({url:config.supabaseUrl,key:config.publishableKey,collection:config.collection,signal:controller.signal,previous:state.sources,accessToken});
    const data=assertSnapshot(snapshot);
    state.snapshot=data;state.sources=parts;state.hasData=true;state.lastUpdated=Date.now();state.failures=warnings.length?state.failures+1:0;
    updateBotProgress();
    try{localStorage.setItem(cacheKey(),JSON.stringify({savedAt:state.lastUpdated,data,sources:parts}));}catch{/* La colección no depende del almacenamiento del navegador. */}
    syncState(warnings.length?'Actualización parcial':'Colección sincronizada',warnings.length?'error':'live');notice(warnings.join(' '));render();
    if($('detailDialog').open&&state.detailKey)openDetail(state.detailKey);
    $('connectionTitle').textContent='Colección conectada';$('connectionInfo').textContent=`Colección: ${config.collection}. Última lectura: ${dateLabel(new Date(state.lastUpdated),true)}. Se actualiza cada ${config.refreshSeconds} segundos mientras esta página está visible.`;
    if(manual)notify('Colección actualizada.');
  }catch(error){
    state.failures++;syncState(state.hasData?'Última copia · sin actualizar':'No se pudo conectar','error');
    const message=error.name==='AbortError'?'La consulta ha tardado demasiado. Volveremos a intentarlo.':error.message;
    notice(message+(state.hasData?` Últimos datos: ${dateLabel(new Date(state.lastUpdated),true)}.`:''));
  }finally{clearTimeout(timeout);state.fetching=false;$('syncButton').disabled=false;schedule();}
}
function schedule(){clearTimeout(pollTimer);if(configured&&(!auth||auth.value)&&!document.hidden)pollTimer=setTimeout(()=>sync(),Math.min(600,config.refreshSeconds*2**Math.min(state.failures,3))*1000);}

function updateBotProgress(){
  const captures=state.snapshot?.bot_progress||[];
  state.botPvpMarks=botPvpRecords(captures,state.pvpData);
  state.variantExplorer?.setBotMarks(botVariantRecords(captures));
}

function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}

for(const d of document.querySelectorAll('dialog')){d.addEventListener('click',e=>{if(e.target===d)d.close();});d.addEventListener('click',e=>{if(e.target.closest('.close-dialog'))d.close();});}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>setView(b.dataset.view));
for(const b of document.querySelectorAll('[data-status]'))b.addEventListener('click',()=>{state.status=b.dataset.status;state.limit=24;updateStatusTabs();render();});
for(const id of ['generation','goalFilter','formFilter'])$(id).addEventListener('change',()=>{state.limit=24;render();});
$('search').addEventListener('input',()=>{state.limit=24;render();});
$('resetFilters').addEventListener('click',resetFilters);
$('loadMore').addEventListener('click',showMoreCatalog);
for(const [id,layout] of [['gridView','grid'],['tableView','table']])$(id).addEventListener('click',()=>{state.layout=layout;for(const [other,l] of [['gridView','grid'],['tableView','table']]){$(other).classList.toggle('selected',l===layout);$(other).setAttribute('aria-pressed',String(l===layout));}render();});
document.addEventListener('click',e=>{const pvp=e.target.closest('[data-pvp-open]');if(pvp)openPvpDialog(pvp.dataset.pvpOpen,pvp.dataset.pvpDest,pvp.dataset.pvpSize||'');const detail=e.target.closest('[data-detail]');if(detail)openDetail(detail.dataset.detail);const reg=e.target.closest('[data-register]');if(reg)registerFor(reg.dataset.register);const del=e.target.closest('[data-web-delete]');if(del)deleteWebCapture(del.dataset.webDelete);});
$('registerButton').addEventListener('click',()=>registerFor());
for(const id of ['pvpSearch','pvpStateFilter','pvpSizeFilter','pvpSort'])$(id).addEventListener(id==='pvpSearch'?'input':'change',()=>{state.pvpLimit=24;render();});
$('pvpMore').addEventListener('click',showMorePvp);
// Precarga cuando el botón se aproxima al área visible (600 px antes).
// El usuario puede pulsar cualquiera de los botones si falla IntersectionObserver.
if('IntersectionObserver' in window){
  const autoLoadObserver=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){
      if(!isIntersecting||target.hidden||target.closest('section[hidden]'))continue;
      if(document.querySelector('dialog[open]'))continue;
      if(target.dataset.autoLoading==='1')continue;
      target.dataset.autoLoading='1';
      requestAnimationFrame(()=>{
        target.dataset.autoLoading='0';
        if(!target.hidden&&!target.closest('section[hidden]')&&!document.querySelector('dialog[open]'))target.click();
      });
    }
  },{root:null,rootMargin:'0px 0px 600px 0px',threshold:0});
  autoLoadObserver.observe($('loadMore'));
  autoLoadObserver.observe($('pvpMore'));
}
$('pvpForm').addEventListener('submit',savePvpRecord);
$('pvpRemove').addEventListener('click',removePvpRecord);
$('pvpExport').addEventListener('click',pvpExport);
$('pvpImport').addEventListener('click',()=>$('pvpImportFile').click());
$('pvpImportFile').addEventListener('change',async()=>{await pvpImport($('pvpImportFile').files?.[0]);$('pvpImportFile').value='';});
for(const id of ['aboutButton','sourcesButton'])$(id).addEventListener('click',()=>openDialog('infoDialog'));
$('syncButton').addEventListener('click',()=>sync(true));
$('webIvPreset').addEventListener('change',()=>{const preset=$('webIvPreset').value;for(const id of ['webAttack','webDefense','webStamina'])$(id).value=preset==='100'?'15':preset==='0'?'0':'';updateWebPreview();});
for(const id of ['webPokemon','webAttack','webDefense','webStamina','webSize','webLevel','webForm','webCostume'])$(id).addEventListener('input',()=>{
  if(selectedVariant&&['webPokemon','webForm','webCostume'].includes(id)){selectedVariant=null;$('webVariantDescription').hidden=true;}
  updateWebPreview();
});
$('webCaptureForm').addEventListener('submit',saveWebCapture);
$('exportButton').addEventListener('click',()=>{if(!state.hasData){notify('Conecta la colección para exportar tus capturas.');return;}$('exportNote').textContent=`Datos consultados el ${dateLabel(new Date(state.lastUpdated),true)}. Para una copia de seguridad completa conserva también la base SQLite del bot.`;openDialog('exportDialog');});
$('exportCsv').addEventListener('click',()=>{download(toCsv(state.snapshot,state.catalog),'text/csv;charset=utf-8','shinydex-'+config.collection+'.csv');$('exportDialog').close();});
$('exportJson').addEventListener('click',()=>{download(JSON.stringify(state.snapshot,null,2),'application/json','shinydex-'+config.collection+'.json');$('exportDialog').close();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();if(state.view==='activity')setView('collection');$('search').focus();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(Date.now()-state.lastAttempt>=config.refreshSeconds*1000)sync();else schedule();});
window.addEventListener('online',()=>sync());

async function initCatalog(){
  if(initCompleted)return;
  initCompleted=true;
  try{
    const [response,pvpResponse]=await Promise.all([fetch('./assets/catalog.json'),fetch('./assets/pvp-targets.json')]);
    if(!response.ok)throw new Error('No se pudo cargar el catálogo.');state.catalog=await response.json();
    if(!pvpResponse.ok)throw new Error('No se pudo cargar el catálogo PvP.');state.pvpData=await pvpResponse.json();
    if(state.pvpData.version!==1||LEAGUES.some(league=>!Array.isArray(state.pvpData.leagues?.[league])))throw new Error('Datos PvP no válidos.');
    for(const league of LEAGUES)for(const target of state.pvpData.leagues[league])state.pvpLookup.set(pvpKey(league,target),target);
    loadPvpMarks();
    state.variantExplorer=initVariantExplorer({catalog:state.catalog,collection:config.collection,supabaseUrl:config.supabaseUrl,ownerId:auth?.value?.user_id||'guest',onRegister:registerVariantFromCatalog});
    $('goalFilter').insertAdjacentHTML('beforeend',GOALS.map(g=>`<option value="${g.id}">${esc(g.label)}</option>`).join(''));
    
    $('pokemonNames').innerHTML=state.catalog.map(p=>`<option value="${esc(p.name)}">#${p.id}</option>`).join('');
    if(configured){try{const cached=JSON.parse(localStorage.getItem(cacheKey()));if(cached){state.snapshot=assertSnapshot(cached.data);state.sources=cached.sources||{};state.hasData=true;state.lastUpdated=cached.savedAt;updateBotProgress();syncState('Última copia guardada');}}catch{/* Una caché inválida no se utiliza. */}}
    render();await sync();
  }catch(error){notice(error.message+' Abre la web desde GitHub Pages o un servidor HTTP local.');syncState('Catálogo no disponible','error');$('catalog').setAttribute('aria-busy','false');$('resultCount').textContent='Catálogo no disponible';}
}
function authMessage(text='',error=false){$('authMessage').textContent=text;$('authMessage').hidden=!text;$('authMessage').classList.toggle('error',error);}
function authTab(which){
  const login=which==='login';$('authLoginForm').hidden=!login;$('authRegisterForm').hidden=login;
  for(const [id,on] of [['authLoginTab',login],['authRegisterTab',!login]]){$(id).classList.toggle('selected',on);$(id).setAttribute('aria-pressed',String(on));}
  authMessage();
}
function lockAuth(message=''){
  document.body.classList.add('auth-locked');$('authScreen').hidden=false;
  $('authLogout').hidden=true;$('authAccount').textContent='';
  clearTimeout(pollTimer);
  state.snapshot=null;state.sources={};state.botPvpMarks={};state.hasData=false;state.pvpMarks={};
  state.variantExplorer?.setBotMarks({});authTab('login');authMessage(message,Boolean(message));
}
async function unlockAuth(){
  document.body.classList.remove('auth-locked');$('authScreen').hidden=true;
  $('authLogout').hidden=!auth;$('authAccount').textContent=auth?.value?.email||'';
  migrateLegacyMarks();
  await initCatalog();
  if(initCompleted&&state.catalog.length){loadPvpMarks();state.variantExplorer=initVariantExplorer({catalog:state.catalog,collection:config.collection,supabaseUrl:config.supabaseUrl,ownerId:auth?.value?.user_id||'guest',onRegister:registerVariantFromCatalog});await sync();}
}
$('authLoginTab').addEventListener('click',()=>authTab('login'));
$('authRegisterTab').addEventListener('click',()=>authTab('register'));
$('authLoginForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!auth)return;
  const button=$('authLoginSubmit');button.disabled=true;authMessage('Comprobando credenciales…');
  try{await auth.signIn($('authLoginEmail').value,$('authLoginPassword').value,$('authRemember').checked);$('authLoginPassword').value='';await unlockAuth();}
  catch(error){authMessage(error.message,true);}
  finally{button.disabled=false;}
});
$('authRegisterForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!auth)return;
  const button=$('authRegisterSubmit');button.disabled=true;authMessage('Registrando cuenta…');
  try{
    const result=await auth.signUp($('authRegisterEmail').value,$('authRegisterPassword').value,false);
    $('authRegisterPassword').value='';
    if(result.signedIn)await unlockAuth();
    else authMessage('Cuenta solicitada. Revisa tu correo para confirmar la dirección si Supabase requiere verificación. Después inicia sesión.');
  }catch(error){authMessage(error.message,true);}
  finally{button.disabled=false;}
});
$('authLogout').addEventListener('click',async()=>{if(auth)await auth.signOut();window.location.reload();});
if(auth){
  lockAuth();
  try{if(await auth.restore())await unlockAuth();}catch(error){lockAuth('No se pudo restaurar la sesión. Vuelve a entrar.');}
}else{
  $('authScreen').hidden=true;document.body.classList.remove('auth-locked');
  await initCatalog();
}
