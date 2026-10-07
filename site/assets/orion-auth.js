(() => {
  'use strict';
  const root = new URL('../', document.currentScript.src);
  const moduleName = document.documentElement.dataset.orionModule;
  const cfg = window.ORION_CONFIG || {};
  let client=null,configError='';
  try {
    if(cfg.url && cfg.publishableKey){
      if(cfg.publishableKey.startsWith('sb_secret_'))throw new Error('Utilisez uniquement une clé publique publishable ou anon.');
      if(cfg.publishableKey.split('.').length===3){
        const role=JSON.parse(atob(cfg.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;
        if(role!=='anon')throw new Error('Utilisez uniquement une clé publique publishable ou anon.');
      }
      client=supabase.createClient(cfg.url,cfg.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    }
  }catch(e){configError='Configuration Supabase invalide. Vérifiez l’URL et utilisez une clé publique publishable ou anon.';}

  const portal = (mode='login') => new URL('compte.html?mode='+encodeURIComponent(mode),root).href;
  const readyDOM = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded',fn,{once:true}) : fn();
  window.OrionDomReady=readyDOM;
  async function rpc(name,args={}) {
    if(!client) throw new Error(configError||'Renseignez le projet Supabase dans assets/orion-config.js.');
    const {data,error}=await client.rpc(name,args); if(error) throw error; return data;
  }
  async function access() {
    if(!client) return null;
    const {data,error}=await client.auth.getUser(); if(error || !data.user) return null;
    return rpc('orion_my_access');
  }
  async function guard() {
    const data=await rpc('orion_require_module',{p_module:moduleName});
    if(window.OrionAccountId && data.user_id!==window.OrionAccountId) throw new Error('Le compte a changé. Rechargez la page.');
    return data;
  }
  function blocked(error) {
    document.documentElement.classList.add('orion-locked');
    readyDOM(()=>{
      let box=document.getElementById('orionGate');
      if(!box){box=document.createElement('div');box.id='orionGate';document.body.append(box);}
      box.replaceChildren();
      const title=document.createElement('h1');title.textContent='Accès Orion BTP';
      const p=document.createElement('p');p.textContent=error?.message||'Connectez-vous à un compte autorisé pour ouvrir ce module.';
      const a=document.createElement('a');a.href=portal();a.textContent='Mon compte et mes accès';
      const b=document.createElement('button');b.textContent='Réessayer';b.onclick=()=>location.reload();
      box.append(title,p,a,b);
    });
  }
  if(client)client.auth.onAuthStateChange((event,session)=>{
    if(moduleName && window.OrionAccountId && (event==='SIGNED_OUT'||(session?.user?.id && session.user.id!==window.OrionAccountId)))
      setTimeout(()=>blocked(new Error('La session a changé. Revenez à votre espace compte.')),0);
  });
  window.OrionAuth={client,configError,rpc,access,guard,portal,root,blocked};
  window.OrionReady=(async()=>{
    if(!moduleName){try{window.OrionSession=await access();}catch{}return;}
    document.documentElement.classList.add('orion-locked');
    try {
      const data=await guard(); window.OrionAccountId=data.user_id; window.OrionSession=await access();
      document.documentElement.classList.remove('orion-locked');
      let checking=false;
      const check=async()=>{if(checking)return;checking=true;try{await guard();}catch(e){blocked(e);}finally{checking=false;}};
      setInterval(check,45000);window.addEventListener('focus',check);
    }catch(e){blocked(e);await new Promise(()=>{});}
  })();
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button,a');if(!b)return;
    if(/logout/i.test(b.id)){
      e.preventDefault();e.stopImmediatePropagation();
      if(client){const {error}=await client.auth.signOut();if(error){alert(error.message);return;}}
      location.href=portal();return;
    }
    if(/^(dropdown(Login|Register|Admin)Btn|openLoginModalBtn|openRegisterModalBtn|loginBtn|registerBtn)$/.test(b.id)){
      e.preventDefault();e.stopImmediatePropagation();location.href=portal(/register/i.test(b.id)?'register':/admin/i.test(b.id)?'admin':'login');
    }
  },true);
  // Existing local authentication forms never collect credentials in this build.
  document.addEventListener('submit',e=>{
    if(['loginForm','registerForm','forgotPasswordForm'].includes(e.target.id)){
      e.preventDefault();e.stopImmediatePropagation();location.href=portal(e.target.id==='registerForm'?'register':e.target.id==='forgotPasswordForm'?'recover':'login');
    }
  },true);
  readyDOM(()=>{
    if(document.getElementById('orionAccountLink'))return;
    const a=document.createElement('a');a.id='orionAccountLink';a.href=portal();a.textContent='Mon compte · Accès · Administration';
    a.style.cssText='position:fixed;bottom:80px;right:12px;z-index:160;background:#0f172a;color:white;border-radius:12px;padding:10px;font:13px system-ui';document.body.append(a);
  });
})();
