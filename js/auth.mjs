/** Supabase Auth REST para una página estática. No se usa service_role en el navegador. */
export class ShinydexAuth {
  constructor({url,key,fetcher=fetch,local=localStorage,session=sessionStorage,clock=()=>Date.now()}) {
    this.url=url;this.key=key;this.fetcher=fetcher;this.local=local;this.session=session;this.clock=clock;
    this.storeKey=`shinydex:auth:v1:${url}`;
    this.value=null;this.remember=false;
  }
  headers(token='') {
    return {'apikey':this.key,'Content-Type':'application/json',...(token?{'Authorization':`Bearer ${token}`}:{})};
  }
  save(value,remember=this.remember){
    const next={access_token:value.access_token,refresh_token:value.refresh_token,
      expires_at:typeof value.expires_at==='number'?value.expires_at*1000:this.clock()+(Number(value.expires_in)||3600)*1000,
      email:value.user?.email||this.value?.email||''};
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
  async signUp(email,password,remember=false){
    const data=await this.request('signup',{email:email.trim(),password});
    if(data.access_token&&data.refresh_token){this.save(data,remember);return {signedIn:true};}
    return {signedIn:false,confirmationRequired:true};
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
      if(user?.email){this.value.email=user.email;return true;}
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
