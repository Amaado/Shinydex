// Integra la fuente del bot con la colección anterior sin sustituir su esquema.
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

export async function readSnapshots({url,key,collection,signal,previous={},fetcher=fetch}){
  const headers={apikey:key,'Content-Type':'application/json'};
  if(key.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
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
    const capture=matching[0];if(!capture)continue;
    const candidate=target.candidates.find(c=>c.dexId===capture.dex_id&&c.form===capture.form);
    marks[`${league}:${target.destination.key}`]={candidateKey:candidate.key,candidateName:candidate.name,
      iv:[capture.attack,capture.defense,capture.stamina],date:capture.caught_at,source:'bot'};
  }
  return marks;
}

export function botVariantRecords(captures){
  const marks={};
  for(const c of captures){
    // Única equivalencia de disfraz explícita ya contrastada en el código del bot.
    if(c.shiny===true&&c.dex_id===41&&c.form==='halloween-2026-01'&&!c.costume){
      const key='c:seed:41:sombrerodecopadehalloween2026';
      if(!marks[key]||c.caught_at<marks[key].date)marks[key]={date:c.caught_at.slice(0,10),note:'Captura confirmada en Discord',source:'bot'};
    }
  }
  return marks;
}
