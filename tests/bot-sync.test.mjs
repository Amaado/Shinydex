import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mergeSnapshots,readSnapshots,botPvpRecords,botVariantRecords} from '../js/bot-sync.mjs';
import {buildEntries,filterEntries} from '../js/domain.mjs';

const empty={version:1,collection:'principal',collection_available:true,captures_total:0,entries:[],recent_captures:[]};
const one={...empty,captures_total:1,entries:[{dex_id:25,form_key:'normal',form_label:'Forma normal',capture_count:1,goals:[{id:'shundo',count:1,first_caught_at:'2026-10-28T10:00:00Z'}]}]};
const response=data=>({ok:true,status:200,json:async()=>data});

test('combina los registros anteriores y el bot por forma y categoría',()=>{
  const snapshot=mergeSnapshots({pokedex_snapshot:one,shinydex_bot_snapshot:one},'principal');
  assert.equal(snapshot.captures_total,2);
  assert.equal(snapshot.entries.length,1);
  assert.equal(snapshot.entries[0].goals[0].count,2);
  assert.equal(snapshot.entries[0].capture_count,2);
});

test('funciona si nunca se instaló el esquema antiguo',async()=>{
  const result=await readSnapshots({url:'https://test.supabase.co',key:'sb_publishable_test',collection:'principal',
    fetcher:async url=>url.endsWith('/pokedex_snapshot')?{status:404,ok:false}:response(one)});
  assert.equal(result.snapshot.captures_total,1);
  assert.equal(result.warnings.length,0);
});

test('es compatible con una web todavía sin la migración del bot',async()=>{
  const result=await readSnapshots({url:'https://test.supabase.co',key:'sb_publishable_test',collection:'principal',
    fetcher:async url=>url.endsWith('/shinydex_bot_snapshot')?{status:404,ok:false}:response(one)});
  assert.equal(result.snapshot.captures_total,1);
});

test('un fallo parcial conserva los últimos registros de esa fuente y avisa',async()=>{
  const result=await readSnapshots({url:'https://test.supabase.co',key:'sb_publishable_test',collection:'principal',previous:{shinydex_bot_snapshot:one},
    fetcher:async url=>url.endsWith('/shinydex_bot_snapshot')?{status:503,ok:false}:response(empty)});
  assert.equal(result.snapshot.captures_total,1);
  assert.equal(result.warnings.length,1);
});

test('Deshacer elimina objetivos remotos sin alterar los registros manuales',()=>{
  const pvp={leagues:{baby:[{destination:{key:'163:normal'},iv:[0,15,14],level:33.5,candidates:[{dexId:163,form:'normal',key:'163:normal',name:'Hoothoot'}]}]}};
  const c={dex_id:163,form:'normal',shiny:true,attack:0,defense:15,stamina:14,level:33,caught_at:'2026-10-28T10:00:00Z'};
  assert.equal(Object.keys(botPvpRecords([c],pvp)).length,1);
  assert.deepEqual(botPvpRecords([],pvp),{});
  for(const other of [{...c,form:'77'},{...c,attack:1},{...c,shiny:false},{...c,level:34},{...c,level:null}])assert.deepEqual(botPvpRecords([other],pvp),{});
});

test('coteja un candidato real del catálogo sin inferir su evolución',()=>{
  const pvp=JSON.parse(fs.readFileSync(new URL('../assets/pvp-targets.json',import.meta.url)));
  const target=pvp.leagues.great[0],candidate=target.candidates[0];
  const capture={dex_id:candidate.dexId,form:candidate.form,shiny:true,attack:target.iv[0],defense:target.iv[1],stamina:target.iv[2],level:1,caught_at:'2026-10-28T10:00:00Z'};
  assert.ok(botPvpRecords([capture],pvp)[`great:${target.destination.key}`]);
});

test('solo asigna el disfraz con equivalencia conocida y ningún fondo',()=>{
  const c={dex_id:41,shiny:true,form:'halloween-2026-01',costume:'',caught_at:'2026-10-28T10:00:00Z'};
  assert.deepEqual(Object.keys(botVariantRecords([c])),['c:seed:41:sombrerodecopadehalloween2026']);
  assert.deepEqual(botVariantRecords([{...c,form:'unknown'}]),{});
});

test('la respuesta a Deshacer sustituye el estado anterior',()=>{
  const previous=mergeSnapshots({shinydex_bot_snapshot:one},'principal');
  assert.equal(previous.captures_total,1);
  assert.equal(mergeSnapshots({shinydex_bot_snapshot:empty},'principal').captures_total,0);
});

test('Conseguidos incluye una captura PvP aunque no cumpla los ocho objetivos IV 100/0',()=>{
  const entries=buildEntries([{id:163,name:'Hoothoot',generation:2}],{entries:[{dex_id:163,form_key:'normal',capture_count:1,goals:[]}]});
  assert.equal(filterEntries(entries,{status:'caught'}).length,1);
  assert.equal(filterEntries(entries,{status:'complete'}).length,0);
});
