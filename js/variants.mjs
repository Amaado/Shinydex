/* Shinydex — objetivos de disfraz, fondos de localización y fondos especiales.
   Fuente remota: psoren/pogo-bg (agrega Serebii, Dittobase y sprites de PokeMiners).
   NO confundir elegibilidad para fondo con disponibilidad shiny confirmada. */
const ROOT='https://raw.githubusercontent.com/psoren/pogo-bg/main/docs/';
const DATA=ROOT+'data/data.json';
const HOME='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const slug=v=>fold(v).replace(/\s+/g,'-')||'sin-nombre';
const safePath=v=>typeof v==='string'&&/^img\/(?:pm|bg)\/[a-zA-Z0-9_./-]+\.(?:png|jpg|webp)$/.test(v)&&!v.includes('..')?ROOT+v:null;
const simpleDate=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d/.test(v)?v.slice(0,10):null;
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
const isAvailable=date=>!date||date<=today();
const localDate=v=>v?new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Madrid'}).format(new Date(v+'T12:00:00Z')):'Fecha no especificada';
const download=(str,name)=>{const u=URL.createObjectURL(new Blob([str],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);};
const alertBox=text=>{el('variantError').hidden=!text;el('variantError').textContent=text||'';};

export function initVariantExplorer({catalog,collection,supabaseUrl}){
  const species=new Map(catalog.map(c=>[Number(c.id),c]));
  const storeKey=`shinydex:variants:v1:${supabaseUrl}:${collection}`;
  const data={rows:[],marks:{},botMarks:{},limit:24,ready:false,fetching:false,mode:'all',visible:false,sources:'',generated:'',sort:'dex'};
  try{const backup=JSON.parse(localStorage.getItem(storeKey)||'{}');if(backup.version===1&&backup.records&&typeof backup.records==='object'&&!Array.isArray(backup.records))data.marks=backup.records;}catch{}
  const persist=()=>{try{localStorage.setItem(storeKey,JSON.stringify({version:1,collection,records:data.marks}));return true;}catch{alertBox('Almacenamiento del navegador bloqueado: exporta una copia de tus registros.');return false;}};
  const record=row=>data.marks[row.key]||data.botMarks[row.key];
  const validMark=row=>Boolean(record(row)?.date);
  function makeSeedRows(seed){
    return (seed.costumes||[]).filter(x=>Array.isArray(x)&&Number.isInteger(x[0])&&isAvailable(x[3])).map(([dex,name,costume,date,shiny],i)=>({
      key:`c:seed:${dex}:${slug(costume)}`,kind:'costume',dex,name:species.get(dex)?.name||name,costume,background:'',bgType:'',date,shinyConfirmed:shiny===true,shinyStatus:shiny===true?'confirmado':'sin-verificar',picture:null,basePicture:(dex<=24?`./assets/sprites/${dex}.png`:HOME+dex+'.png'),backgroundPicture:null,source:'WikiDex / Pokémon GO',sourceUrl:shiny===true?'https://pokemongo.com/news/halloween-part-1-2026':'https://www.wikidex.net/wiki/Lista_de_Pok%C3%A9mon_de_Pok%C3%A9mon_GO',note:'Imagen genérica si no hay ilustración exacta del disfraz',formId:null
    }));
  }
  function makeExternalRows(raw){
    if(!raw||!Array.isArray(raw.backgrounds)||!raw.variants||typeof raw.variants!=='object')throw Error('El catálogo externo no tiene el formato esperado.');
    const out=[]; const variants=raw.variants;
    for(const [id,v] of Object.entries(variants)){
      if(!v||!Number.isInteger(Number(v.dex))||!v.costume)continue;
      const dex=Number(v.dex); const name=species.get(dex)?.name||String(v.name||id);
      // Catálogo de disfraces que están documentados también en fuentes de fondos.
      out.push({key:`c:external:${id}`,kind:'costume',dex,name,costume:String(v.name||id),background:'',bgType:'',date:null,shinyConfirmed:false,shinyStatus:'sin-verificar',picture:safePath(v.shiny_sprite)||safePath(v.sprite),basePicture:(dex<=24?`./assets/sprites/${dex}.png`:HOME+dex+'.png'),backgroundPicture:null,source:'Dittobase / Serebii / PokeMiners',sourceUrl:'https://www.dittobase.com/pokemon-go/backgrounds',note:'Disfraz del catálogo de fondos; shiny no verificado para todos los eventos',formId:id});
    }
    for(const bg of raw.backgrounds){
      if(!bg||typeof bg.id!=='string'||!isAvailable(simpleDate(bg.first)))continue;
      const bgId=bg.id; const date=simpleDate(bg.first);
      const events=Array.isArray(bg.events)?bg.events:[];
      for(const vid of [...new Set(Array.isArray(bg.pokemon)?bg.pokemon:[])]){
        const v=variants[vid];if(!v||!Number.isInteger(Number(v.dex)))continue;
        const relevant=events.filter(e=>Array.isArray(e.pokemon)&&e.pokemon.includes(vid)&&isAvailable(simpleDate(e.start)));
        // En un fondo reutilizado, evita incorporar especies anunciadas para eventos futuros.
        const windows=Array.isArray(bg.windows)?bg.windows:[];
        const inPastWindow=windows.some(w=>Array.isArray(w.pokemon)&&w.pokemon.includes(vid)&&(!Array.isArray(w.ranges)||!w.ranges.length||w.ranges.some(range=>isAvailable(simpleDate(range.start)))));
        if((events.length||windows.length)&&!relevant.length&&!inPastWindow)continue;
        const confirms=relevant.some(e=>Array.isArray(e.shiny)&&e.shiny.includes(vid));
        const dex=Number(v.dex),isCostume=v.costume===true;
        const record={key:`b:${bgId}:${vid}`,kind:isCostume?'both':'background',dex,name:species.get(dex)?.name||String(v.name||vid),costume:isCostume?String(v.name||vid):'',background:String(bg.name||bgId),bgType:bg.type==='location'?'location':'special',date,shinyConfirmed:confirms,shinyStatus:confirms?'confirmado':'sin-verificar',picture:safePath(v.shiny_sprite)||safePath(v.sprite),basePicture:(dex<=24?`./assets/sprites/${dex}.png`:HOME+dex+'.png'),backgroundPicture:safePath(bg.image),source:'Serebii / Dittobase / PokeMiners',sourceUrl:'https://www.serebii.net/pokemongo/backgrounds.shtml',note:confirms?'Shiny indicado por Dittobase en al menos un evento de ese fondo':'Pokémon elegible; posibilidad shiny de esta combinación sin verificar',formId:vid};
        out.push(record);
      }
    }
    return out;
  }
  function uniqueRows(rows){
    const map=new Map(); for(const row of rows)map.set(row.key,row);
    // Evita que el seed duplique un disfraz si hay coincidencia exacta de nombre y especie.
    const imported=new Set(rows.filter(r=>r.kind==='costume'&&r.formId).map(r=>`${r.dex}:${fold(r.costume)}`));
    return [...map.values()].filter(r=>r.formId||r.kind!=='costume'||!imported.has(`${r.dex}:${fold(r.costume)}`));
  }
  async function refresh(force=false){
    if(data.fetching)return;
    data.fetching=true;el('variantRefresh').disabled=true;
    if(!data.ready)el('variantResults').textContent='Cargando catálogo de disfraces y fondos…';
    let seed={costumes:[]};
    try{const r=await fetch('./assets/variants-seed.json');if(r.ok)seed=await r.json();}catch{}
    let rows=makeSeedRows(seed);
    try{
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),11000);
      let resp;
      try{resp=await fetch(DATA,{cache:'no-store',signal:ctrl.signal});}finally{clearTimeout(timer);}
      if(!resp.ok)throw Error('HTTP '+resp.status);
      const raw=await resp.json();
      rows=uniqueRows([...rows,...makeExternalRows(raw)]);
      data.sources='Catálogo de fondos externo cargado';data.generated=raw.generated||'';
      alertBox('');
    }catch(error){data.sources='Solo selección local verificada';
      alertBox('No se pudo actualizar el catálogo de fondos externo. Se muestra una selección local de disfraces. Comprueba tu conexión y pulsa Actualizar fuentes.');
    }
    data.rows=rows;data.ready=true;data.fetching=false;el('variantRefresh').disabled=false;
    // El catálogo externo puede actualizarse: los años se derivan de sus fechas, sin inventar eventos.
    const yearSelect=el('variantYear'),previousYear=yearSelect.value;
    const years=[...new Set(rows.map(r=>r.date?.slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort((a,b)=>b.localeCompare(a));
    yearSelect.replaceChildren(new Option('Todos los años','all'),...years.map(y=>new Option(y,y)));
    yearSelect.value=years.includes(previousYear)?previousYear:'all';
    updateSummary();render();
  }
  const filtered=()=>{
    const q=fold(el('variantSearch').value),category=el('variantType').value,status=el('variantState').value,
      shiny=el('variantShiny').value,generation=el('variantGeneration').value,
      bgType=el('variantBackgroundType').value,year=el('variantYear').value,image=el('variantImage').value;
    const kinds={costume:'costume',background:'background',both:'both'};
    const arr=data.rows.filter(row=>{
      if(category!=='all'&&row.kind!==kinds[category])return false;
      if(q&&!fold([row.name,row.dex,row.costume,row.background,row.bgType,row.date].join(' ')).includes(q))return false;
      if(status==='done'&&!validMark(row))return false;
      if(shiny==='confirmed'&&!row.shinyConfirmed)return false;
      if(generation!=='all'&&species.get(row.dex)?.generation!==Number(generation))return false;
      if(bgType!=='all'&&(bgType==='none'?row.bgType!=='':row.bgType!==bgType))return false;
      if(year!=='all'&&row.date?.slice(0,4)!==year)return false;
      const specific=Boolean(row.picture||row.backgroundPicture);
      if(image==='specific'&&!specific)return false;
      if(image==='generic'&&specific)return false;
      return true;
    });
    const textCmp=(a,b)=>String(a||'').localeCompare(String(b||''),'es',{numeric:true});
    const tie=(a,b)=>textCmp(a.costume,b.costume)||textCmp(a.background,b.background)||textCmp(a.key,b.key);
    const byDex=(a,b)=>a.dex-b.dex||tie(a,b);
    switch(el('variantSort').value){
      case 'dex-desc': arr.sort((a,b)=>b.dex-a.dex||tie(a,b));break;
      case 'recent': arr.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||byDex(a,b));break;
      case 'oldest': arr.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||byDex(a,b));break;
      case 'name': arr.sort((a,b)=>textCmp(a.name,b.name)||byDex(a,b));break;
      case 'costume': arr.sort((a,b)=>textCmp(a.costume||a.background,b.costume||b.background)||byDex(a,b));break;
      default: arr.sort(byDex);
    }
    return arr;
  };
  const label=row=>row.kind==='both'?'Disfraz + fondo':row.kind==='costume'?'Con disfraz':'Con fondo';
  function picture(row){
    const primary=row.picture||row.basePicture;
    return `<div class="variant-picture ${row.backgroundPicture?'has-background':''}">
      ${row.backgroundPicture?`<img class="variant-scene" src="${esc(row.backgroundPicture)}" alt="Arte del fondo ${esc(row.background)}" loading="lazy">`:''}
      <img class="variant-mon" src="${esc(primary)}" data-fallback="${esc(row.basePicture)}" alt="${row.picture?'Icono de la variante de':'Imagen de referencia de la especie'} ${esc(row.name)}" loading="lazy" decoding="async">
      ${!row.picture?'<span class="variant-picture-note">Imagen de especie (no del disfraz)</span>':''}
    </div>`;
  }
  function card(row){
    const done=validMark(row);
    return `<article class="variant-card ${done?'variant-done':''}">
      <div class="variant-card-top"><span class="variant-type variant-type-${row.kind}">${label(row)}</span>${done?'<span class="variant-state done">✓ Conseguido</span>':''}</div>
      ${picture(row)}
      <div class="variant-card-body"><span class="variant-number">#${String(row.dex).padStart(4,'0')}</span><h3>${esc(row.name)}</h3>
      ${row.costume?`<p class="variant-description"><strong>Disfraz:</strong> ${esc(row.costume)}</p>`:''}
      ${row.background?`<p class="variant-description"><strong>Fondo:</strong> ${esc(row.background)} <span class="variant-subtle">(${row.bgType==='location'?'ubicación':'especial'})</span></p>`:''}
      <div class="variant-metadata"><span>${esc(localDate(row.date))}</span><span title="La elegibilidad para un fondo no demuestra que esa combinación pudiera salir shiny">${row.shinyConfirmed?'✦ Shiny documentado':'Shiny no verificado'}</span></div>
      ${done?`<p class="variant-own-record">✓ ${record(row)?.source==='bot'?'Desde Discord · ':''}Marcado el ${esc(localDate(record(row).date))}</p>`:''}
      <a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="variant-source">Consultar fuente ↗</a>
      <button type="button" class="button ${done?'button-quiet':'button-primary'} variant-mark-button" data-variant-key="${esc(row.key)}">${done?'Modificar registro':'Registrar shiny conseguido'}</button></div>
    </article>`;
  }
  function updateSummary(){
    const total=data.rows.length,done=data.rows.filter(validMark).length;
    const costume=data.rows.filter(r=>r.kind==='costume').length, backgrounds=data.rows.filter(r=>r.kind==='background').length,both=data.rows.filter(r=>r.kind==='both').length;
    el('variantNavCount').textContent=String(done);
    el('variantDone').textContent=`${done} / ${total}`;
    el('variantPercent').textContent=total?`${Math.round(100*done/total)} % registrado`:'Sin catálogo';
    el('variantProgressBar').style.width=`${total?done*100/total:0}%`;
    el('variantDescription').textContent=`${costume} disfraces · ${backgrounds} Pokémon con fondo · ${both} combinaciones de ambos. ${data.sources}${data.generated?' (datos '+data.generated+')':''}.`;
  }
  function render(){
    updateSummary();if(!data.visible)return;
    const all=filtered(),shown=all.slice(0,data.limit);
    el('variantCatalog').innerHTML=shown.map(card).join('');
    el('variantResults').textContent=`${all.length.toLocaleString('es-ES')} objetivos de variantes`;
    el('variantShown').textContent=all.length?`${shown.length} de ${all.length}`:'Sin coincidencias';
    el('variantMore').hidden=shown.length>=all.length;
    el('variantEmpty').hidden=all.length>0;
  }
  function showMore(){
    if(!data.visible)return;
    const all=filtered(),next=all.slice(data.limit,data.limit+24);if(!next.length){el('variantMore').hidden=true;return;}
    el('variantCatalog').insertAdjacentHTML('beforeend',next.map(card).join(''));
    data.limit+=next.length;
    el('variantShown').textContent=`${Math.min(data.limit,all.length)} de ${all.length}`;
    el('variantMore').hidden=data.limit>=all.length;
  }
  function open(row){
    data.selected=row;
    el('variantDialogTitle').textContent=`${row.name} · ${label(row)}`;
    el('variantDialogDescription').textContent=[row.costume?`Disfraz: ${row.costume}`:'',row.background?`Fondo: ${row.background}`:''].filter(Boolean).join(' · ');
    el('variantRecordDate').value=record(row)?.date||today();
    el('variantRecordNote').value=record(row)?.note||'';
    el('variantRecordConfirm').checked=false;
    el('variantRecordDelete').hidden=!data.marks[row.key];
    if(record(row)?.source==='bot')el('variantDialogDescription').textContent+=' · Captura sincronizada. Para deshacerla utiliza el bot.';
    el('variantDialog').showModal();
  }
  el('variantCatalog').addEventListener('click',e=>{
    const btn=e.target.closest('[data-variant-key]');if(!btn)return;
    const row=data.rows.find(r=>r.key===btn.dataset.variantKey);if(row)open(row);
  });
  el('variantForm').addEventListener('submit',e=>{
    e.preventDefault();if(!data.selected||!el('variantRecordConfirm').checked)return;
    const date=el('variantRecordDate').value;if(!/^\d{4}-\d\d-\d\d$/.test(date)){alertBox('Selecciona una fecha válida.');return;}
    data.marks[data.selected.key]={date,note:el('variantRecordNote').value.slice(0,240)};
    if(persist()){el('variantDialog').close();render();}
  });
  el('variantRecordDelete').addEventListener('click',()=>{
    if(!data.selected||!confirm('¿Eliminar este registro local?'))return;
    delete data.marks[data.selected.key];if(persist()){el('variantDialog').close();render();}
  });
  const filterIds=['variantSearch','variantType','variantState','variantShiny','variantGeneration','variantBackgroundType','variantYear','variantImage','variantSort'];
  for(const id of filterIds)el(id).addEventListener(id==='variantSearch'?'input':'change',()=>{data.limit=24;render();});
  el('variantReset').addEventListener('click',()=>{
    el('variantSearch').value='';
    for(const id of filterIds.filter(id=>id!=='variantSearch'&&id!=='variantSort'))el(id).value='all';
    el('variantSort').value='dex';data.limit=24;render();
  });
  el('variantMore').addEventListener('click',showMore);
  el('variantRefresh').addEventListener('click',()=>refresh(true));
  el('variantExport').addEventListener('click',()=>download(JSON.stringify({version:1,collection,exportedAt:new Date().toISOString(),records:data.marks},null,2),`shinydex-variantes-${collection}.json`));
  el('variantImport').addEventListener('click',()=>el('variantFile').click());
  el('variantFile').addEventListener('change',async()=>{
    const file=el('variantFile').files?.[0];el('variantFile').value='';if(!file||file.size>2000000)return;
    try{const backup=JSON.parse(await file.text());if(backup.version!==1||backup.collection!==collection||!backup.records||Array.isArray(backup.records))throw Error('Copia incompatible.');
      const safeKey=/^(?:c:seed:[0-9]+:[a-z0-9-]+|c:external:[a-z0-9_-]+|b:[a-z0-9_-]+:[a-z0-9_-]+)$/;
      let count=0;
      for(const [key,v] of Object.entries(backup.records)){
        if(safeKey.test(key)&&v&&/^\d{4}-\d\d-\d\d$/.test(v.date)){
          data.marks[key]={date:v.date,note:String(v.note||'').slice(0,240)};count++;
        }
      }
      if(persist()){alertBox(`Importados ${count} registros. Los de fondos que no estén cargados volverán a mostrarse cuando se actualice la fuente.`);render();}
    }catch{alertBox('No se ha podido importar la copia de variantes.');}
  });
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting&&!el('variantMore').hidden&&data.visible&&!(document.querySelector('dialog[open]'))){requestAnimationFrame(showMore);}}, {rootMargin:'0px 0px 600px 0px',threshold:0});
    observer.observe(el('variantMore'));
  }
  refresh();
  return {show(isVisible){data.visible=isVisible;if(isVisible){data.limit=24;render();}},refresh,
    setBotMarks(marks){data.botMarks=marks;render();}};
}
