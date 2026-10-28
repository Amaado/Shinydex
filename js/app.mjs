import {initVariantExplorer} from './variants.mjs';
import {GOALS,buildEntries,filterEntries,escapeHtml as esc,fold,makeCommand,toCsv} from './domain.mjs';

const $=id=>document.getElementById(id);
const raw=window.POKEDEX_CONFIG||{};
if(typeof raw.title==='string'&&raw.title.trim())document.title=raw.title.slice(0,60);
const config={supabaseUrl:String(raw.supabaseUrl||'').replace(/\/$/,''),publishableKey:String(raw.publishableKey||''),collection:String(raw.collection||'principal'),refreshSeconds:Math.max(60,Math.min(600,Number(raw.refreshSeconds)||60))};
const HOME='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/';
const state={catalog:[],entries:[],snapshot:null,pvpData:null,variantExplorer:null,pvpMarks:{},pvpLookup:new Map(),pvpLimit:24,pvpSelected:null,view:'collection',layout:'grid',status:'all',limit:24,hasData:false,fetching:false,lastUpdated:0,lastAttempt:0,failures:0};
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
const pvpCacheKey=`shinydex:pvp:v1:${config.supabaseUrl}:${config.collection}`;
const LEAGUE_LABELS={great:'Superliga',ultra:'Ultraliga'};
function pvpKey(league,target){return `${league}:${target.destination.key}`;}
function pvpItem(league,key){return state.pvpLookup.get(`${league}:${key}`);}
function pvpDone(league,target){return Boolean(state.pvpMarks[pvpKey(league,target)]);}
function pvpBadge(entry){
  if(!state.pvpData)return '';
  const chips=[];
  const form=entry.form_key==='normal'?'normal':entry.form_key.replace(/^form:/,'').split('|')[0];
  for(const league of ['great','ultra']){
    const target=pvpItem(league,`${entry.id}:${form}`);
    if(!target)continue;
    const done=pvpDone(league,target);
    chips.push(`<button class="pvp-chip ${done?'pvp-chip-done':''}" data-pvp-open="${esc(league)}" data-pvp-dest="${esc(target.destination.key)}" title="${esc(LEAGUE_LABELS[league])} #${target.rank} · IV ${target.iv.join('/')}">${league==='great'?'Super':'Ultra'} · ${done?'✓ Shiny':'Pendiente'}</button>`);
  }
  return chips.length?`<div class="pvp-chips">${chips.join('')}</div>`:'';
}
function pvpMarkValid(league,target,value){
  if(!value||typeof value!=='object'||!Array.isArray(value.iv)||value.iv.length!==3)return false;
  if(value.iv.some((iv,i)=>iv!==target.iv[i]))return false;
  return target.candidates.some(candidate=>candidate.key===value.candidateKey);
}
function loadPvpMarks(){
  try{
    const data=JSON.parse(localStorage.getItem(pvpCacheKey)||'{}');
    const records=data?.version===1&&data?.records&&typeof data.records==='object'?data.records:{};
    state.pvpMarks={};
    for(const [key,record] of Object.entries(records)){
      const target=state.pvpLookup.get(key);
      if(target&&pvpMarkValid(target.league,target,record))state.pvpMarks[key]=record;
    }
  }catch{state.pvpMarks={};}
}
function savePvpMarks(){
  try{localStorage.setItem(pvpCacheKey,JSON.stringify({version:1,collection:config.collection,records:state.pvpMarks}));return true;}
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
      const item=state.pvpLookup.get(key);
      if(item&&pvpMarkValid(item.league,item,record))accepted[key]=record;else rejected++;
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
  const goals=GOALS.map(g=>`<div class="goal-cell ${g.group==='0'?'group-zero ':''}${entry.completed.has(g.id)?'done':''}" title="${esc(g.label)}: ${state.hasData?(entry.completed.has(g.id)?'conseguido':'pendiente'):'sin sincronizar'}"><span class="goal-circle" aria-hidden="true">${entry.completed.has(g.id)?'✓':''}</span><span>${g.short}</span><span class="sr-only">${state.hasData?(entry.completed.has(g.id)?'conseguido':'pendiente'):'sin sincronizar'}</span>${g.group==='100'?'<span class="tiny-star" aria-hidden="true">✦</span>':''}</div>`).join('');
  return `<article class="pokemon-card"><div class="card-top"><span class="dex-number">#${String(entry.id).padStart(4,'0')}</span><span class="card-progress ${progress?'has-goals':''}">${state.hasData?`${progress} / 8`:'SIN DATOS'}</span></div><div class="pokemon-portrait">${portrait(entry)}</div><h3 class="pokemon-name">${esc(entry.name)}</h3><p class="form-name">${esc(entry.form_label)}</p><div class="card-goals">${goals}</div>${pvpBadge(entry)}<div class="card-footer"><span>${state.hasData?(entry.capture_count?`${entry.capture_count} captura${entry.capture_count===1?'':'s'}`:'Sin capturas'):'Sin sincronizar'}</span><button data-detail="${esc(entry.key)}" aria-label="Ver ficha de ${esc(entry.name)}, ${esc(entry.form_label)}">Ver ficha <span aria-hidden="true">↗</span></button></div></article>`;
}

function table(entries){return `<div class="table-container"><table class="dex-table"><thead><tr><th scope="col">Pokémon / forma</th>${GOALS.map(g=>`<th scope="col" title="${esc(g.label)}">${esc(g.short)}</th>`).join('')}<th scope="col">Superliga</th><th scope="col">Ultraliga</th></tr></thead><tbody>${entries.map(e=>`<tr><td><button class="table-pokemon" data-detail="${esc(e.key)}">${portrait(e)}<span><strong>#${String(e.id).padStart(4,'0')} ${esc(e.name)}</strong><small>${esc(e.form_label)}</small></span></button></td>${GOALS.map(g=>`<td>${e.completed.has(g.id)?'<span class="table-check" aria-label="Conseguido">✓</span>':`<span class="table-pending" aria-label="${state.hasData?'Pendiente':'Sin sincronizar'}">·</span>`}</td>`).join('')}${['great','ultra'].map(league=>{const target=pvpItem(league,`${e.id}:${e.form_key==='normal'?'normal':e.form_key.replace(/^form:/,'').split('|')[0]}`);return `<td>${target?`<button class="pvp-table-link" data-pvp-open="${league}" data-pvp-dest="${esc(target.destination.key)}">${pvpDone(league,target)?'✓':'·'} #${target.rank}</button>`:'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;}

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

function filteredCatalogEntries(){
  return filterEntries(state.entries,{
    query:$('search').value,generation:$('generation').value,
    status:state.status,goal:$('goalFilter').value,
    form:$('formFilter').value,view:state.view
  });
}

function render(){
  state.entries=buildEntries(state.catalog,state.snapshot||{});updateStats();
  if(state.pvpData)for(const league of ['great','ultra'])$(league+'NavCount').textContent=String(state.pvpData.leagues[league].filter(t=>pvpDone(league,t)).length);
  if(state.view==='activity'){renderActivity();return;}
  if(state.view==='variants'){return;}
  if(state.view==='great'||state.view==='ultra'){renderPvp();return;}
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
  $('goalHint').textContent=goal?(state.status==='caught'||state.status==='complete'?'✓ Conseguidos: ':'✧ Pendientes: ')+GOALS.find(g=>g.id===goal).short:'✧ 8 objetivos por Pokémon';
}

/** Añade solo el siguiente bloque al DOM para evitar saltos de scroll. */
function showMoreCatalog(){
  if(state.view==='activity'||state.view==='great'||state.view==='ultra')return;
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
  const title={collection:'Pokédex',pending:'Pendientes',activity:'Actividad',great:'Superliga',ultra:'Ultraliga',variants:'Disfraces y fondos'}[view];
  $('pageTitle').textContent=title;$('breadcrumb').textContent=title;
  $('collectionHeading').textContent=view==='pending'?'Objetivos pendientes':'Pokémon';
  const isPvp=view==='great'||view==='ultra';
  const isVariant=view==='variants';
  state.variantExplorer?.show(isVariant);
  $('activitySection').hidden=view!=='activity';$('collectionSection').hidden=view==='activity'||isPvp||isVariant;
  $('pvpSection').hidden=!isPvp;$('variantSection').hidden=!isVariant;document.querySelector('.stats').hidden=isPvp||isVariant;
  if(isPvp||isVariant){$('registerButton').hidden=true;$('exportButton').hidden=true;}else{$('registerButton').hidden=false;$('exportButton').hidden=false;}
  if(view==='pending'){state.status='all';$('goalFilter').value='';updateStatusTabs();}
  if(isPvp){state.pvpLimit=24;$('pvpSearch').value='';$('pvpStateFilter').value='all';$('pvpSort').value='rank';}
  render();
}
function updateStatusTabs(){for(const b of document.querySelectorAll('[data-status]')){const selected=b.dataset.status===state.status;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}}
function resetFilters(){state.limit=24;state.status='all';for(const id of ['search','generation','goalFilter'])$(id).value='';$('formFilter').value='all';updateStatusTabs();render();}

function openDetail(key){
  const entry=state.entries.find(e=>e.key===key);if(!entry)return;
  const goals=GOALS.map(g=>{const record=entry.goals.find(x=>x.id===g.id);return `<div class="detail-goal ${record?'done':''}"><span aria-hidden="true">${record?'✓':''}</span><div>${esc(g.label)}${record?`<small class="sr-only"> Primera captura ${esc(dateLabel(record.first_caught_at))}</small>`:''}</div><span>${state.hasData?(record?`${record.count} captura${record.count===1?'':'s'}`:'Pendiente'):'Sin datos'}</span></div>`;}).join('');
  const pvpForm=entry.form_key==='normal'?'normal':entry.form_key.replace(/^form:/,'').split('|')[0];
  const pvpGoals=['great','ultra'].map(league=>({league,target:pvpItem(league,`${entry.id}:${pvpForm}`)})).filter(x=>x.target);
  const pvpDetails=pvpGoals.length?`<h3 class="pvp-detail-heading">Objetivos PvP</h3><div class="pvp-details">${pvpGoals.map(({league,target})=>`<button class="pvp-detail-action" data-pvp-open="${league}" data-pvp-dest="${esc(target.destination.key)}"><strong>${esc(LEAGUE_LABELS[league])} · #${target.rank}</strong><small>IV ${target.iv.join('/')} · ${pvpDone(league,target)?'✓ Registrado':'Pendiente'}</small></button>`).join('')}</div>`:'';
  $('detailContent').innerHTML=`<button class="close-dialog aria-label="Cerrar">×</button><div class="detail-portrait">${portrait(entry,true)}</div><p class="detail-label">#${String(entry.id).padStart(4,'0')} · ${esc(entry.form_label)}</p><h2 id="detailTitle" class="detail-title">${esc(entry.name)}</h2><div class="detail-goals">${goals}</div>${pvpDetails}<button class="button button-primary detail-command" data-register="${esc(entry.key)}">Registrar una captura <span aria-hidden="true">＋</span></button><p class="field-note">Las condiciones de una captura se aplican a todas las categorías compatibles. Las formas se contabilizan por separado.</p>`;
  openDialog('detailDialog');
}

function filteredPvpTargets(league){
  const targets=state.pvpData?.leagues?.[league]||[];
  const query=fold($('pvpSearch').value.trim());
  const status=$('pvpStateFilter').value;
  let entries=targets.filter(t=>(!query||fold([t.destination.name,t.rank,...t.candidates.map(c=>c.name)].join(' ')).includes(query))&&(status==='all'||(status==='done')===pvpDone(league,t)));
  if($('pvpSort').value==='name')entries=entries.slice().sort((a,b)=>a.destination.name.localeCompare(b.destination.name,'es'));
  return entries;
}

function renderPvp(){
  const league=state.view;
  const targets=state.pvpData?.leagues?.[league]||[];
  const done=targets.filter(t=>pvpDone(league,t)).length;
  $('greatNavCount').textContent=state.pvpData?String(state.pvpData.leagues.great.filter(t=>pvpDone('great',t)).length):'—';
  $('ultraNavCount').textContent=state.pvpData?String(state.pvpData.leagues.ultra.filter(t=>pvpDone('ultra',t)).length):'—';
  $('pvpSectionTitle').textContent=LEAGUE_LABELS[league];
  $('pvpDescription').textContent=`${targets.length} destinos del CSV. El objetivo se registra una sola vez, aunque haya varias preevoluciones capturables.`;
  $('pvpDone').textContent=`${done} / ${targets.length}`;
  $('pvpPercent').textContent=`${targets.length?Math.round(done*100/targets.length):0} % completado`;
  $('pvpProgressBar').style.width=`${targets.length?done*100/targets.length:0}%`;
  const entries=filteredPvpTargets(league);
  const shown=entries.slice(0,state.pvpLimit);
  $('pvpCatalog').innerHTML=shown.map(t=>pvpCard(league,t)).join('');
  $('pvpEmpty').hidden=entries.length!==0;
  $('pvpResults').textContent=`${entries.length} objetivos · ${done} registrados de ${targets.length}`;
  $('pvpShown').textContent=entries.length?`${shown.length} de ${entries.length} objetivos`:'';
  $('pvpMore').hidden=shown.length>=entries.length;
}
function showMorePvp(){
  if(state.view!=='great'&&state.view!=='ultra')return;
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
  const marked=pvpDone(league,target),record=state.pvpMarks[pvpKey(league,target)];
  const {destination:dest,iv,rank,candidates,level}=target;
  const photo=dest.form==='normal'?`<img src="${esc(dest.dexId<=24?`./assets/sprites/${dest.dexId}.png`:`${HOME}${dest.dexId}.png`)}" alt="Imagen shiny de ${esc(dest.name)}" loading="lazy" width="102" height="102" data-dex="${dest.dexId}" data-normal="true">`:'<span class="pvp-form-image" aria-label="Forma especial, sin imagen verificada">✧</span>';
  return `<article class="pvp-target-card ${marked?'pvp-target-completed':''}">
    <div class="pvp-target-head"><span class="pvp-rank">#${rank} en el ranking</span><span class="pvp-state ${marked?'done':''}">${marked?'✓ Registrado':'Pendiente'}</span></div>
    <div class="pvp-target-main"><div class="pvp-target-portrait">${photo}</div><div><span class="dex-number">#${String(dest.dexId).padStart(4,'0')}</span><h3>${esc(dest.name)}</h3><p>Pokémon destino</p></div></div>
    <div class="pvp-specs"><span><small>IV objetivo</small><strong>${iv.join(' / ')}</strong></span><span><small>Nivel del destino</small><strong>${Number.isInteger(level)?level:String(level).replace('.',',')}</strong></span></div>
    <div class="pvp-candidate-list"><strong>Candidatos de captura del CSV</strong><div>${candidates.map(c=>`<span>${esc(c.name)}</span>`).join('')}</div></div>
    ${marked?`<div class="pvp-record">✓ ${esc(record.candidateName||'Shiny registrado')} · ${iv.join('/')} · ${esc(dateLabel(record.date))}</div>`:''}
    <button class="button ${marked?'button-quiet':'button-primary'} pvp-card-action" data-pvp-open="${esc(league)}" data-pvp-dest="${esc(dest.key)}">${marked?'Ver o modificar registro':'Registrar shiny conseguido'}</button>
  </article>`;
}
function openPvpDialog(league,destinationKey){
  const target=pvpItem(league,destinationKey);if(!target)return;
  if($('detailDialog').open)$('detailDialog').close();
  state.pvpSelected={league,destinationKey};
  const record=state.pvpMarks[pvpKey(league,target)];
  $('pvpDialogTitle').textContent=`${LEAGUE_LABELS[league]} · ${target.destination.name}`;
  $('pvpDialogDescription').textContent=`Puesto #${target.rank}. Registra un shiny de la lista que puedas evolucionar hasta ${target.destination.name} (o el propio destino).`;
  $('pvpCandidate').replaceChildren();
  for(const candidate of target.candidates){const opt=document.createElement('option');opt.value=candidate.key;opt.textContent=candidate.name;$('pvpCandidate').append(opt);}
  $('pvpCandidate').value=record?.candidateKey||target.candidates[0].key;
  $('pvpExpected').textContent=`IV requeridos: ${target.iv.join('/')} · Nivel objetivo tras evolucionar: ${target.level}`;
  for(const [id,i] of [['pvpAtk',0],['pvpDef',1],['pvpHp',2]])$(id).value=record?String(record.iv[i]):'';
  $('pvpConfirm').checked=false;
  $('pvpRemove').hidden=!record;
  openDialog('pvpDialog');
}
function savePvpRecord(event){
  event.preventDefault();const {league,destinationKey}=state.pvpSelected||{};
  const target=pvpItem(league,destinationKey);if(!target)return;
  const iv=['pvpAtk','pvpDef','pvpHp'].map(id=>$(id).value.trim());
  if(iv.some(v=>!/^\d{1,2}$/.test(v))){notify('Introduce los tres IV en formato 0–15.');return;}
  const parsed=iv.map(Number);
  if(parsed.some((v,i)=>v!==target.iv[i])){notify(`Estos IV no coinciden con el objetivo: ${target.iv.join('/')}. No se ha registrado.`);return;}
  const candidate=target.candidates.find(c=>c.key===$('pvpCandidate').value);
  if(!candidate||!$('pvpConfirm').checked){notify('Elige un Pokémon válido y confirma que es shiny.');return;}
  const key=pvpKey(league,target),previous=state.pvpMarks[key];
  state.pvpMarks[key]={candidateKey:candidate.key,candidateName:candidate.name,iv:parsed,date:previous?.date||new Date().toISOString()};
  if(savePvpMarks()){$('pvpDialog').close();render();notify('Objetivo PvP registrado en este navegador.');}
}
function removePvpRecord(){
  const {league,destinationKey}=state.pvpSelected||{};
  const target=pvpItem(league,destinationKey);if(!target)return;
  if(!confirm(`¿Quitar el registro PvP de ${target.destination.name} en ${LEAGUE_LABELS[league]}?`))return;
  delete state.pvpMarks[pvpKey(league,target)];
  if(savePvpMarks()){$('pvpDialog').close();render();notify('Registro PvP eliminado.');}
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
$('loadMore').addEventListener('click',showMoreCatalog);
for(const [id,layout] of [['gridView','grid'],['tableView','table']])$(id).addEventListener('click',()=>{state.layout=layout;for(const [other,l] of [['gridView','grid'],['tableView','table']]){$(other).classList.toggle('selected',l===layout);$(other).setAttribute('aria-pressed',String(l===layout));}render();});
document.addEventListener('click',e=>{const pvp=e.target.closest('[data-pvp-open]');if(pvp)openPvpDialog(pvp.dataset.pvpOpen,pvp.dataset.pvpDest);const detail=e.target.closest('[data-detail]');if(detail)openDetail(detail.dataset.detail);const reg=e.target.closest('[data-register]');if(reg)registerFor(reg.dataset.register);});
$('registerButton').addEventListener('click',()=>registerFor());
for(const id of ['pvpSearch','pvpStateFilter','pvpSort'])$(id).addEventListener(id==='pvpSearch'?'input':'change',()=>{state.pvpLimit=24;render();});
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
    const [response,pvpResponse]=await Promise.all([fetch('./assets/catalog.json'),fetch('./assets/pvp-targets.json')]);
    if(!response.ok)throw new Error('No se pudo cargar el catálogo.');state.catalog=await response.json();
    if(!pvpResponse.ok)throw new Error('No se pudo cargar el catálogo PvP.');state.pvpData=await pvpResponse.json();
    if(state.pvpData.version!==1||!Array.isArray(state.pvpData.leagues.great)||!Array.isArray(state.pvpData.leagues.ultra))throw new Error('Datos PvP no válidos.');
    for(const league of ['great','ultra'])for(const target of state.pvpData.leagues[league])state.pvpLookup.set(pvpKey(league,target),target);
    loadPvpMarks();
    state.variantExplorer=initVariantExplorer({catalog:state.catalog,collection:config.collection,supabaseUrl:config.supabaseUrl});
    $('goalFilter').insertAdjacentHTML('beforeend',GOALS.map(g=>`<option value="${g.id}">${esc(g.label)}</option>`).join(''));
    $('commandGoal').innerHTML=GOALS.map(g=>`<option value="${g.id}">${esc(g.label)}</option>`).join('');
    $('pokemonNames').innerHTML=state.catalog.map(p=>`<option value="${esc(p.name)}">#${p.id}</option>`).join('');
    if(configured){try{const cached=JSON.parse(localStorage.getItem(cacheKey));if(cached){state.snapshot=assertSnapshot(cached.data);state.hasData=true;state.lastUpdated=cached.savedAt;syncState('Última copia guardada');}}catch{/* Una caché inválida no se utiliza. */}}
    render();await sync();
  }catch(error){notice(error.message+' Abre la web desde GitHub Pages o un servidor HTTP local.');syncState('Catálogo no disponible','error');$('catalog').setAttribute('aria-busy','false');$('resultCount').textContent='Catálogo no disponible';}
}
await init();
