import test from 'node:test';
import assert from 'node:assert/strict';
import {GOALS} from '../js/domain.mjs';
import {goalIdsForCapture,costumeGoalKey,costumeCompletedGoals,costumeGoalTotals,validCostumeBackupKey,pvpVariantKey,pvpCompletedSizes,pvpMarkValid} from '../js/extra-goals.mjs';
import {botPvpRecords,botVariantRecords} from '../js/bot-sync.mjs';
import {ShinydexAuth} from '../js/auth.mjs';

const zubat='c:seed:41:sombrerodecopadehalloween2026';
const c=(ivs,size,level)=>({shiny:true,attack:ivs,defense:ivs,stamina:ivs,size,level});

test('los ocho objetivos son exactamente los mismos de la Pokédex',()=>{
  assert.equal(GOALS.length,8);
  assert.deepEqual(goalIdsForCapture(c(15,'XXS',30)),['shundo','shundo_xxs']);
  assert.deepEqual(goalIdsForCapture(c(15,'XXL',30)),['shundo','shundo_xxl']);
  assert.deepEqual(goalIdsForCapture(c(0,'XXS',1)),['snundo_l1','snundo_xxs','snundo_xxs_l1']);
  assert.deepEqual(goalIdsForCapture(c(0,'XXL',1)),['snundo_l1','snundo_xxl','snundo_xxl_l1']);
  assert.deepEqual(goalIdsForCapture(c(0,'XXS',2)),['snundo_xxs']);
  assert.deepEqual(goalIdsForCapture(c(0,'M',2)),[]);
});

test('el mismo disfraz + fondo tiene ocho casillas independientes de otros fondos',()=>{
  const rows=[{key:zubat,kind:'costume'},{key:'b:2026-halloween:costume-41',kind:'both'},{key:'b:city:pid25',kind:'background'}];
  const marks={[costumeGoalKey(zubat,'shundo')]:{date:'2026-10-28'},
    [costumeGoalKey(rows[1].key,'shundo_xxs')]:{date:'2026-10-28'},
    [rows[2].key]:{date:'2026-10-28'}};
  assert.deepEqual(costumeCompletedGoals(rows[0],marks,{}),['shundo']);
  assert.deepEqual(costumeCompletedGoals(rows[1],marks,{}),['shundo_xxs']);
  assert.deepEqual(costumeGoalTotals(rows,marks,{}),{done:3,total:17});
  assert.equal(validCostumeBackupKey(costumeGoalKey(zubat,'snundo_xxl_l1')),true);
  assert.equal(validCostumeBackupKey(`${zubat}#inventado`),false);
});

test('los registros legacy se mantienen pero nunca se transforman en shundos sin IV',()=>{
  const row={key:zubat,kind:'costume'};
  assert.deepEqual(costumeCompletedGoals(row,{[zubat]:{date:'2026-10-27'}},{}),[]);
});

test('PvP reconoce shiny base, XXS y XXL sin cruzar tamaños',()=>{
  const t={destination:{key:'25:normal'},iv:[0,15,15],candidates:[{key:'25:normal'}]};
  const key=pvpVariantKey('great',t.destination.key);
  const xxs={candidateKey:'25:normal',iv:[0,15,15],size:'XXS'};
  const xxl={...xxs,size:'XXL'};
  assert.equal(pvpMarkValid(t,xxs,'XXS'),true);
  assert.equal(pvpMarkValid(t,xxs,'XXL'),false);
  assert.deepEqual(pvpCompletedSizes('great',t,{}, {[key+'#XXS']:xxs}),['','XXS']);
  assert.deepEqual(pvpCompletedSizes('great',t,{}, {[key+'#XXL']:xxl}),['','XXL']);
  assert.deepEqual(pvpCompletedSizes('great',t,{[key]:{...xxl,size:''}},{}),['']);
});

test('las capturas del bot conservan todas las tallas y permiten varias capturas del mismo destino',()=>{
  const target={destination:{key:'25:normal'},iv:[0,15,15],level:40,candidates:[{key:'25:normal',dexId:25,form:'normal',name:'Pikachu'}]};
  const mk=size=>({dex_id:25,form:'normal',shiny:true,attack:0,defense:15,stamina:15,level:24,size,caught_at:'2026-10-28T10:10:00Z'});
  const marks=botPvpRecords([mk('XXS'),mk('XXL')],{leagues:{great:[target]}});
  assert.equal(Object.keys(marks).length,3);
  assert.equal(marks['great:25:normal#XXS'].size,'XXS');
  assert.equal(marks['great:25:normal#XXL'].size,'XXL');
  assert.deepEqual(Object.keys(botPvpRecords([mk(null)],{leagues:{great:[target]}})),['great:25:normal']);
});

test('bot: Zubat exacto aporta 3 objetivos al registrar 0/0/0 XXL nivel 1',()=>{
  const cap={...c(0,'XXL',1),dex_id:41,form:'halloween-2026-01',costume:'',caught_at:'2026-10-28T12:00:00Z'};
  const marks=botVariantRecords([cap]);
  assert.deepEqual(Object.keys(marks).sort(),['snundo_l1','snundo_xxl','snundo_xxl_l1'].map(g=>costumeGoalKey(zubat,g)).sort());
  assert.deepEqual(botVariantRecords([{...cap,form:'wrong'}]),{});
  assert.deepEqual(Object.keys(botVariantRecords([{...cap,attack:null}])),[zubat]); // sin IV crea solo la marca legacy
});

function mem(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('iniciar sesión conserva tokens solo al activar mantener sesión',async()=>{
  const local=mem(),session=mem(),clock=()=>1000000;
  const payload={access_token:'access1',refresh_token:'refresh1',expires_in:3600,user:{email:'test@example.com'}};
  const fetcher=async (url)=>({ok:true,json:async()=>url.endsWith('/user')?{email:'test@example.com'}:payload});
  const args={url:'https://example.supabase.co',key:'sb_publishable_test',local,session,clock,fetcher};
  const client=new ShinydexAuth(args);
  await client.signIn('test@example.com','secret',false);
  assert.equal(local.getItem(client.storeKey),null);
  assert.ok(session.getItem(client.storeKey));
  await client.signIn('test@example.com','secret',true);
  assert.ok(local.getItem(client.storeKey));
  assert.equal(session.getItem(client.storeKey),null);
  const newClient=new ShinydexAuth(args);
  assert.equal(await newClient.restore(),true);
  await newClient.signOut();
  assert.equal(local.getItem(client.storeKey),null);
});
