/** Supabase Auth REST para una página estática. No se usa service_role en el navegador. */
export class ShinydexAuth {
  constructor({url,key,fetcher=(...args)=>globalThis.fetch(...args),local=localStorage,session=sessionStorage,clock=()=>Date.now(),redirectUrl=null}) {
    this.url=url;this.key=key;this.fetcher=fetcher;this.local=local;this.session=session;this.clock=clock;
    // No usar localhost:3000 cuando la web está desplegada en GitHub Pages.
    const current=globalThis.location;
    this.redirectUrl=redirectUrl||(current && ['https:', 'http:'].includes(current.protocol)?`${current.origin}${current.pathname}`:null);
    this.storeKey=`shinydex:auth:v1:${url}`;
    this.value=null;this.remember=false;
  }
  headers(token='') {
    return {'apikey':this.key,'Content-Type':'application/json',...(token?{'Authorization':`Bearer ${token}`}:{})};
  }
  save(value,remember=this.remember){
    const next={access_token:value.access_token,refresh_token:value.refresh_token,
      expires_at:typeof value.expires_at==='number'?value.expires_at*1000:this.clock()+(Number(value.expires_in)||3600)*1000,
      email:value.user?.email||this.value?.email||'',user_id:value.user?.id||this.value?.user_id||''};
    if(!next.access_token||!next.refresh_token)throw Error('Supabase no ha entregado una sesión válida.');
    this.value=next;this.remember=Boolean(remember);
    this.local.removeItem(this.storeKey);this.session.removeItem(this.storeKey);
    (this.remember?this.local:this.session).setItem(this.storeKey,JSON.stringify(next));
    return next;
  }
  forget(){this.value=null;this.remember=false;this.local.removeItem(this.storeKey);this.session.removeItem(this.storeKey);}
  async request(endpoint,body,token){
    const response=await this.fetcher(`${this.url}/auth/v1/${endpoint}`,{
      method:body?'POST':'GET',headers:this.headers(token),...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw Error(data.msg||data.error_description||data.message||`Error de autenticación (HTTP ${response.status}).`);
    return data;
  }
  async signIn(email,password,remember=false){
    const data=await this.request('token?grant_type=password',{email:email.trim(),password});
    this.save(data,remember);return this.value;
  }
  authEndpoint(path){return path+(this.redirectUrl?`?redirect_to=${encodeURIComponent(this.redirectUrl)}`:'');}
  async signUp(email,password,remember=false){
    const data=await this.request(this.authEndpoint('signup'),{email:email.trim(),password});
    if(data.access_token&&data.refresh_token){this.save(data,remember);return {signedIn:true};}
    return {signedIn:false,confirmationRequired:true};
  }
  async resendConfirmation(email){
    if(!email?.trim())throw Error('Introduce primero tu dirección de correo.');
    await this.request(this.authEndpoint('resend'),{type:'signup',email:email.trim()});
  }
  async receiveConfirmation(hash){
    const params=new URLSearchParams((hash||'').replace(/^#/,''));
    const access_token=params.get('access_token');
    const refresh_token=params.get('refresh_token');
    if(!access_token||!refresh_token)return false;
    const user=await this.request('user',null,access_token);
    this.save({access_token,refresh_token,expires_in:Number(params.get('expires_in'))||3600,user},false);
    return true;
  }
  async refresh(){
    if(!this.value?.refresh_token)return null;
    try{const data=await this.request('token?grant_type=refresh_token',{refresh_token:this.value.refresh_token});return this.save(data);}catch{this.forget();return null;}
  }
  async restore(){
    let raw,remember=false;
    try{raw=this.session.getItem(this.storeKey);}catch{}
    if(!raw){try{raw=this.local.getItem(this.storeKey);remember=Boolean(raw);}catch{}}
    if(!raw)return false;
    try{const data=JSON.parse(raw);if(!data?.access_token||!data?.refresh_token)throw Error('Sesión incompleta');this.value=data;this.remember=remember;
      if(data.expires_at<=this.clock()+60000)return Boolean(await this.refresh());
      const user=await this.request('user',null,data.access_token);
      if(user?.email){this.value.email=user.email;this.value.user_id=user.id||this.value.user_id||'';return true;}
    }catch{this.forget();}
    return false;
  }
  async token(){
    if(!this.value)return null;
    if(this.value.expires_at<=this.clock()+60000)await this.refresh();
    return this.value?.access_token||null;
  }
  async signOut(){
    const token=this.value?.access_token;
    this.forget();
    if(token){try{await this.request('logout',{},token);}catch{/* Cierre local inmediato. */}}
  }
}
