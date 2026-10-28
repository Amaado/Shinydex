import {matchedGoals} from './domain.mjs';

const FORM_RE=/^[a-z0-9][a-z0-9_-]{0,79}$/;
const SIZE_VALUES=['','XXS','XS','M','XL','XXL'];

export function parseIv(value){
  if(value===''||value===null||value===undefined)return null;
  if(!/^\d{1,2}$/.test(String(value)))throw Error('Los IV deben ser enteros entre 0 y 15.');
  const n=Number(value);
  if(n>15)throw Error('Los IV deben ser enteros entre 0 y 15.');
  return n;
}
export function buildWebCapture(fields,catalog){
  const text=String(fields.pokemon||'').trim();
  const dex=catalog.find(p=>String(p.id)===text.replace(/^#/,'')||[p.name,p.slug,...(p.aliases||[])].some(name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));
  if(!dex)throw Error('Selecciona un Pokémon existente del catálogo.');
  const ivs=[parseIv(fields.attack),parseIv(fields.defense),parseIv(fields.stamina)];
  if(ivs.some(iv=>iv!==null)&&ivs.some(iv=>iv===null))throw Error('Introduce los tres IV o deja los tres vacíos.');
  const size=String(fields.size||'');
  if(!SIZE_VALUES.includes(size))throw Error('Selecciona un tamaño válido.');
  let level=null;
  if(fields.level!==''&&fields.level!==undefined&&fields.level!==null){
    level=Number(String(fields.level).replace(',','.'));
    if(!Number.isFinite(level)||level<1||level>51||level*2!==Math.round(level*2))throw Error('El nivel debe estar entre 1 y 51, en intervalos de 0,5.');
  }
  const form=String(fields.form||'normal').trim().toLowerCase()||'normal';
  const costume=String(fields.costume||'').trim().toLowerCase();
  if(!FORM_RE.test(form)||costume&&!FORM_RE.test(costume))throw Error('La forma y el disfraz deben ser identificadores de hasta 80 caracteres (letras sin tildes, números, - o _).');
  const account=String(fields.account||'principal').trim();
  if(!/^[a-zA-Z0-9_-]{1,32}$/.test(account))throw Error('La cuenta debe tener de 1 a 32 caracteres sin espacios.');
  const background=String(fields.background||'').trim().toLowerCase();
  if(background&&!FORM_RE.test(background))throw Error('El fondo necesita un identificador válido.');
  const variantKey=String(fields.variantKey||'');
  if(variantKey&&!/^(?:c:seed:\d+:[a-z0-9-]+|c:external:[a-z0-9_-]+|b:[a-z0-9_-]+:[a-z0-9_-]+)$/.test(variantKey))throw Error('La variante seleccionada no es válida.');
  if(variantKey&&Number(fields.variantDex)!==dex.id)throw Error('El Pokémon no corresponde a la variante seleccionada.');
  const variantKind=variantKey?String(fields.variantKind||''):'';
  if(variantKey&&!['costume','background','both'].includes(variantKind))throw Error('Tipo de variante desconocido.');
  const form_key=(form==='normal'?'normal':`form:${form}`)+(costume?`|costume:${costume}`:'')+(background?`|background:${background}`:'');
  const form_label=(form==='normal'?'Forma normal':`Forma ${form}`)+(costume?` · disfraz ${costume}`:'')+(background?` · fondo ${background}`:'');
  let caughtAt=new Date();
  if(fields.caughtAt){caughtAt=new Date(fields.caughtAt);if(!Number.isFinite(caughtAt.getTime()))throw Error('La fecha de captura no es válida.');}
  if(caughtAt.getTime()>Date.now()+60000)throw Error('La fecha de captura no puede estar en el futuro.');
  if(fields.confirmed!==true)throw Error('Confirma que has capturado el shiny indicado.');
  return {dex_id:dex.id,pokemon_name:dex.name,form_key,form_label,form,costume,disguised:Boolean(costume),shiny:true,
    attack:ivs[0],defense:ivs[1],stamina:ivs[2],level,size:size||null,account,caught_at:caughtAt.toISOString(),
    ...(variantKey?{variant_key:variantKey,variant_kind:variantKind}:{} )};
}
export function capturePreview(capture){return matchedGoals(capture);}
export class WebCapturesClient{
  constructor({url,key,fetcher=(...args)=>globalThis.fetch(...args),token}){this.url=url;this.key=key;this.fetcher=fetcher;this.token=token;}
  async request(method,path,body){
    const accessToken=await this.token();
    if(!accessToken)throw Error('Inicia sesión para registrar capturas.');
    const response=await this.fetcher(`${this.url}/rest/v1/${path}`,{
      method,headers:{'apikey':this.key,'Authorization':`Bearer ${accessToken}`,'Content-Type':'application/json','Prefer':'return=representation'},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    if(!response.ok){
      let detail;try{detail=await response.json();}catch{}
      if(response.status===404||detail?.code==='PGRST205'||detail?.code==='42P01')throw Error('Falta instalar supabase/registro_web.sql en este proyecto Supabase.');
      if(response.status===401||response.status===403)throw Error('Tu sesión no tiene permiso para registrar capturas. Comprueba RLS y vuelve a iniciar sesión.');
      throw Error(`Supabase rechazó el registro (HTTP ${response.status}): ${String(detail?.message||detail?.details||'error no especificado').slice(0,180)}`);
    }
    return response.status===204?null:await response.json();
  }
  async add(collection,capture){
    const result=await this.request('POST','shinydex_web_captures',[{collection,capture,caught_at:capture.caught_at}]);
    if(!Array.isArray(result)||!result[0]?.id)throw Error('No se recibió confirmación del registro. Comprueba la colección antes de repetirlo.');
    return result[0];
  }
  async remove(collection,id){
    if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Identificador de captura no válido.');
    const result=await this.request('DELETE',`shinydex_web_captures?id=eq.${id}&collection=eq.${encodeURIComponent(collection)}`);
    if(!Array.isArray(result)||result.length!==1)throw Error('No se pudo confirmar la eliminación. Actualiza Actividad.');
  }
}
