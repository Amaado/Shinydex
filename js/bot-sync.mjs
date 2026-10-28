// Integra la fuente del bot con la colección anterior sin sustituir su esquema.
import {goalIdsForCapture,costumeGoalKey,pvpVariantKey} from './extra-goals.mjs';
export function validateSnapshot(data,collection){
  if(!data||data.version!==1||data.collection!==collection||!Array.isArray(data.entries)||!Array.isArray(data.recent_captures)||!Number.isFinite(data.captures_total))throw Error('Formato de colección no válido. Revisa el SQL de conexión.');
  if(!data.collection_available)throw Error('La colección no existe o su lectura pública está desactivada.');
  for(const entry of data.entries)if(!Number.isInteger(entry.dex_id)||typeof entry.form_key!=='string'||!Array.isArray(entry.goals))throw Error('Datos de colección incompletos.');
  return data;
}

export function mergeSnapshots(parts,collection){
  const entries=new Map(),recent=[];let total=0;
  for(const snapshot of Object.values(parts)){
    total+=snapshot.captures_total;
    for(const entry of snapshot.entries){
      const key=`${entry.dex_id}:${entry.form_key}`,old=entries.get(key),goals=new Map((old?.goals||[]).map(g=>[g.id,{...g}]));
      for(const goal of entry.goals){
        const previous=goals.get(goal.id);
        goals.set(goal.id,{...goal,count:(previous?.count||0)+(goal.count||0),first_caught_at:[previous?.first_caught_at,goal.first_caught_at].filter(Boolean).sort()[0]});
      }
      entries.set(key,{...old,...entry,capture_count:(old?.capture_count||0)+(entry.capture_count||0),goals:[...goals.values()]});
    }
    recent.push(...snapshot.recent_captures);
  }
  recent.sort((a,b)=>String(b.caught_at).localeCompare(String(a.caught_at)));
  return {version:1,collection,collection_available:true,captures_total:total,
    entries:[...entries.values()],recent_captures:recent.slice(0,30),
    bot_progress:parts.shinydex_bot_snapshot?.bot_progress||[]};
}

export async function readSnapshots({url,key,collection,signal,previous={},fetcher=fetch,accessToken=null}){
  const headers={apikey:key,'Content-Type':'application/json'};
  if(accessToken)headers.Authorization=`Bearer ${accessToken}`;
  else if(key.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
  const results=await Promise.all(['pokedex_snapshot','shinydex_bot_snapshot'].map(async rpc=>{
    try{
      const response=await fetcher(`${url}/rest/v1/rpc/${rpc}`,{method:'POST',headers,
        body:JSON.stringify({p_collection:collection}),signal,cache:'no-store'});
      if(response.status===404)return {rpc,missing:true};
      if(!response.ok)throw Error(`No se pudo leer ${rpc==='shinydex_bot_snapshot'?'las capturas del bot':'la colección anterior'} (HTTP ${response.status}).`);
      return {rpc,data:validateSnapshot(await response.json(),collection)};
    }catch(error){return {rpc,error};}
  }));
  const parts={},warnings=[];
  for(const {rpc,data,error,missing} of results){
    if(data)parts[rpc]=data;
    else if(!missing){
      if(previous[rpc])parts[rpc]=previous[rpc];
      warnings.push(error.name==='AbortError'?'La consulta ha tardado demasiado. Se reintentará.':error.message);
    }
  }
  if(!results.some(r=>r.data))throw Error(warnings.join(' ')||'No hay una colección disponible. Ejecuta supabase/conectar_bot.sql.');
  return {parts,warnings,snapshot:mergeSnapshots(parts,collection)};
}

export function botPvpRecords(captures,pvpData){
  const marks={};
  for(const [league,targets] of Object.entries(pvpData?.leagues||{}))for(const target of targets){
    const matching=captures.filter(c=>c.shiny===true&&[c.attack,c.defense,c.stamina].every((iv,i)=>Number.isInteger(iv)&&iv===target.iv[i])
      &&typeof c.level==='number'&&c.level>=1&&c.level<=Math.floor(target.level)
      &&target.candidates.some(candidate=>candidate.dexId===c.dex_id&&candidate.form===c.form));
    matching.sort((a,b)=>String(a.caught_at).localeCompare(String(b.caught_at)));
    for(const capture of matching){
      const candidate=target.candidates.find(c=>c.dexId===capture.dex_id&&c.form===capture.form);
      const record={candidateKey:candidate.key,candidateName:candidate.name,
        iv:[capture.attack,capture.defense,capture.stamina],size:capture.size||'',date:capture.caught_at,source:'bot'};
      const keys=[pvpVariantKey(league,target.destination.key)];
      if(capture.size==='XXS'||capture.size==='XXL')keys.push(pvpVariantKey(league,target.destination.key,capture.size));
      for(const key of keys)if(!marks[key])marks[key]={...record};
    }
  }
  return marks;
}

export function botVariantRecords(captures){
  const marks={};
  for(const c of captures){
    // Solo el mapeo del Zubat de Halloween 2026 está confirmado en este paquete.
    // No asociar automáticamente códigos numéricos de disfraz ambiguos ni fondos.
    if(c.shiny!==true||c.dex_id!==41||c.form!=='halloween-2026-01'||c.costume)continue;
    const base='c:seed:41:sombrerodecopadehalloween2026';
    const date=String(c.caught_at||'').slice(0,10);
    if(!/^\d{4}-\d\d-\d\d$/.test(date))continue;
    const goals=goalIdsForCapture(c);
    if(!goals.length){
      // Una captura antigua puede carecer de IV: se conserva como registro sin categoría.
      if(!marks[base])marks[base]={date,note:'Captura desde Discord sin atributos completos',source:'bot'};
      continue;
    }
    for(const goal of goals){
      const key=costumeGoalKey(base,goal);
      if(!marks[key]||date<marks[key].date)marks[key]={date,note:'Captura confirmada en Discord',source:'bot'};
    }
  }
  return marks;
}
