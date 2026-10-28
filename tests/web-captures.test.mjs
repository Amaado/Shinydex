import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWebCapture,WebCapturesClient,capturePreview} from '../js/web-captures.mjs';
import {mergeSnapshots,readSnapshots,botPvpRecords,botVariantRecords} from '../js/bot-sync.mjs';
const catalog=[{id:25,name:'Pikachu',slug:'pikachu',aliases:[]},{id:41,name:'Zubat',slug:'zubat',aliases:[]}];
const valid={pokemon:'Pikachu',attack:'15',defense:'15',stamina:'15',size:'XXS',level:'1',form:'normal',costume:'',account:'principal',confirmed:true};
test('web: shiny 100 XXS marca dos casillas',()=>{
  const c=buildWebCapture(valid,catalog);
  assert.equal(c.form_key,'normal');assert.deepEqual(capturePreview(c),['shundo','shundo_xxs']);
  assert.equal(c.dex_id,25);assert.equal(c.account,'principal');
});
test('web: shiny IV 0, XXS, nivel 1 marca tres casillas',()=>{
 const c=buildWebCapture({...valid,pokemon:'41',attack:'0',defense:'0',stamina:'0',size:'XXS',costume:'halloween-2026-01'},catalog);
 assert.deepEqual(capturePreview(c),['snundo_l1','snundo_xxs','snundo_xxs_l1']);
 assert.equal(c.form_key,'normal|costume:halloween-2026-01');
});
test('web: IV PvP no 100/0 se guardan sin forzar objetivos',()=>{
 const c=buildWebCapture({...valid,attack:'0',defense:'15',stamina:'14',size:'XXL'},catalog);
 assert.deepEqual(capturePreview(c),[]);
 assert.equal(c.size,'XXL');
});
test('web: datos parciales, fecha futura, IV falsos o cuenta inválida son rechazados',()=>{
 for(const patch of [{attack:'',defense:'15'},{attack:'16'},{account:'hola mundo'},{confirmed:false},{level:'1.3'},{caughtAt:'2999-01-01'}]){
   assert.throws(()=>buildWebCapture({...valid,...patch},catalog));
 }
});
test('web: captura desconocida conserva IV nulos (no inventa atributos)',()=>{
 const c=buildWebCapture({...valid,attack:'',defense:'',stamina:'',level:'',size:''},catalog);
 assert.equal(c.attack,null);assert.equal(c.level,null);assert.deepEqual(capturePreview(c),[]);
});
test('web: inserta con JWT, sin credenciales de servidor ni Discord',async()=>{
 let request;
 const client=new WebCapturesClient({url:'https://example.supabase.co',key:'sb_publishable_TEST',token:async()=> 'user.jwt',fetcher:async(url,opts)=>{request={url,...opts};return {ok:true,status:201,json:async()=>[{id:'11111111-1111-1111-1111-111111111111'}]};}});
 const c=buildWebCapture(valid,catalog);await client.add('principal',c);
 assert.match(request.url,/\/rest\/v1\/shinydex_web_captures$/);
 assert.equal(request.headers.Authorization,'Bearer user.jwt');
 assert.deepEqual(JSON.parse(request.body),[{collection:'principal',capture:c,caught_at:c.caught_at}]);
});
test('web: rechaza error Supabase sin afirmar que se guardó',async()=>{
 const client=new WebCapturesClient({url:'https://example.supabase.co',key:'pub',token:async()=> 'user.jwt',fetcher:async()=>({ok:false,status:404,json:async()=>({code:'PGRST205'})})});
 await assert.rejects(()=>client.add('principal',buildWebCapture(valid,catalog)),/registro_web.sql/);
});
test('web: agrupa con fuente de bot sin perder entradas ni progreso para PvP',()=>{
 const c=buildWebCapture({...valid,attack:'0',defense:'15',stamina:'15',level:'24',size:'XXL'},catalog);
 const s=(captures)=>({version:1,collection:'principal',collection_available:true,captures_total:captures.length,entries:captures.map((x)=>({dex_id:x.dex_id,form_key:x.form_key,form_label:x.form_label,pokemon_name:x.pokemon_name,capture_count:1,goals:[]})),recent_captures:captures,bot_progress:captures});
 const snap=mergeSnapshots({shinydex_bot_snapshot:s([]),shinydex_web_snapshot:s([c])},'principal');
 assert.equal(snap.captures_total,1);assert.equal(snap.bot_progress.length,1);assert.equal(snap.entries[0].capture_count,1);
 const marks=botPvpRecords(snap.bot_progress,{leagues:{great:[{destination:{key:'25:normal'},iv:[0,15,15],level:40,candidates:[{key:'25:normal',dexId:25,form:'normal',name:'Pikachu'}]}]}});
 assert.ok(marks['great:25:normal#XXL']);assert.ok(marks['great:25:normal']);
});
test('web: consulta la RPC privada si hay sesión',async()=>{
 const calls=[],s={version:1,collection:'principal',collection_available:true,captures_total:0,entries:[],recent_captures:[],bot_progress:[]};
 await readSnapshots({url:'https://example.supabase.co',key:'pub',collection:'principal',accessToken:'jwt',fetcher:async(url,opts)=>{calls.push([url,opts.headers.Authorization]);return {ok:true,json:async()=>s};}});
 assert.equal(calls.length,3);assert.ok(calls.some(([url,auth])=>url.endsWith('/shinydex_web_snapshot')&&auth==='Bearer jwt'));
});

test('web: disfraz o fondo seleccionado se contabiliza solo en la variante exacta',()=>{
  const c=buildWebCapture({...valid,pokemon:'41',attack:'0',defense:'0',stamina:'0',level:'1',variantKey:'c:seed:41:disfrazverificado',variantKind:'costume',variantDex:41,costume:'disfrazverificado'},catalog);
  const marks=botVariantRecords([c]);
  assert.deepEqual(Object.keys(marks).sort(),['snundo_l1','snundo_xxs','snundo_xxs_l1'].map(g=>'c:seed:41:disfrazverificado#'+g).sort());
  const b=buildWebCapture({...valid,variantKey:'b:es:ejemplo',variantKind:'background',variantDex:25,background:'especial'},catalog);
  assert.ok(botVariantRecords([b])['b:es:ejemplo']);
  assert.equal(botVariantRecords([{...b,variant_key:''}])['b:es:ejemplo'],undefined);
});
test('web: una variante no se asigna a otra especie por error',()=>{
  assert.throws(()=>buildWebCapture({...valid,variantKey:'c:external:test',variantKind:'costume',variantDex:41},catalog),/no corresponde/);
});
test('web: borrar exige confirmación de la fila afectada',async()=>{
  const client=new WebCapturesClient({url:'https://example.supabase.co',key:'pub',token:async()=> 'jwt',fetcher:async()=>({ok:true,status:200,json:async()=>[]})});
  await assert.rejects(()=>client.remove('principal','11111111-1111-1111-1111-111111111111'),/No se pudo confirmar/);
});
