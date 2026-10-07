(() => {
  'use strict';
  const root = new URL('../', document.currentScript.src);
  const moduleName = document.documentElement.dataset.orionModule;
  const cfg = window.ORION_CONFIG || {};
  try { document.documentElement.classList.toggle('dark',localStorage.getItem('theme')==='dark'); } catch {}
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
    const result=await rpc('orion_my_access');
    if(result?.user)result.user={...result.user,name:result.user.full_name||result.user.email||'Mon compte',isAdmin:result.is_admin};
    return result;
  }
  async function guard() {
    const data=await rpc('orion_require_module',{p_module:moduleName});
    if(window.OrionAccountId && data.user_id!==window.OrionAccountId) throw new Error('Le compte a changé. Rechargez la page.');
    return data;
  }
  function blocked(error) {
    document.documentElement.classList.add('orion-locked');
    try {if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark');}catch{}
    readyDOM(()=>{
      let box=document.getElementById('orionGate');
      if(!box){box=document.createElement('main');box.id='orionGate';document.body.append(box);}
      box.replaceChildren();box.setAttribute('aria-labelledby','orionGateTitle');
      const node=(tag,text,parent,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;if(parent)parent.append(n);return n;};
      const icon=(parent,kind)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='brand'?'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z':'M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6V10Zm6 5v2');svg.append(path);parent.append(svg);};
      const header=node('header',null,box,'gate-header'),brand=node('a',null,header,'gate-brand');brand.href=new URL('index.html',root).href;icon(node('span',null,brand,'gate-brand-icon'),'brand');node('span','Orion BTP',brand);
      const home=node('a','← Retour à l’accueil',header,'gate-home');home.href=new URL('index.html',root).href;
      const layout=node('div',null,box,'gate-layout'),intro=node('aside',null,layout,'gate-intro');
      node('span','ESPACE ORION',intro,'gate-overline');node('h2','Les bons outils, pour chaque étape du chantier.',intro);node('p','Préparation, documents et suivi terrain : vos accès sont gérés depuis votre profil Orion.',intro);
      const modules=node('div',null,intro,'gate-module-list');for(const [code,name] of [['M42','Préparation & métrés'],['M43','CCTP & documents'],['M78','Suivi & réserves']]){const row=node('div',null,modules);node('span',code,row,'gate-module-code '+code.toLowerCase());node('span',name,row);}
      const card=node('section',null,layout,'gate-card'),symbol=node('div',null,card,'gate-lock');icon(symbol,'lock');
      const names={m42:'M42 · Préparation & métrés',m43:'M43 · CCTP & documents',m78:'M78 · Suivi & réserves'};
      node('span',names[moduleName]||'Votre espace Orion',card,'gate-module-label');
      // Translate expected failures; never show raw server/network errors to users.
      const reason=String(error?.message||'');let title='Accès non autorisé',copy='Votre compte ne dispose pas encore de l’accès à ce module. Contactez votre administrateur pour demander son activation.',action='Ouvrir mon profil';
      if(!client){title='Service indisponible';copy='La connexion à Orion n’est pas disponible pour le moment. Contactez l’administrateur ou réessayez plus tard.';}
      else if(/connexion requise|not authenticated|not logged|auth session missing|jwt|session.*(expired|missing|changed)|session a changé|compte a changé/i.test(reason)){title='Connexion nécessaire';copy='Connectez-vous à votre compte Orion pour consulter vos accès et ouvrir ce module.';action='Se connecter';}
      else if(/failed to fetch|fetch failed|network|timeout|timed out|load failed|réseau/i.test(reason)){title='Connexion interrompue';copy='Nous ne pouvons pas vérifier vos accès pour le moment. Vérifiez votre connexion internet, puis réessayez.';}
      else if(/administration refusée|double authentification|aal2|mfa/i.test(reason)){title='Vérification nécessaire';copy='L’administration nécessite un compte administrateur actif et une double authentification. Ouvrez votre profil pour effectuer cette vérification.';}
      else if(/profil introuvable/i.test(reason)){title='Profil indisponible';copy='Votre profil ne peut pas être chargé. Contactez l’administrateur pour vérifier votre compte.';}
      else if(/conflit|sauvegarde|projets|pièce jointe|données/i.test(reason)){title='Synchronisation à vérifier';copy='Vos projets sur cet appareil sont conservés. Exportez votre brouillon avant de recharger, puis vérifiez votre connexion et réessayez.';}
      const heading=node('h1',title,card);heading.id='orionGateTitle';heading.tabIndex=-1;
      const message=node('p',copy,card,'gate-message');message.setAttribute('role','alert');
      const actions=node('div',null,card,'gate-actions'),account=node('a',action,actions,'gate-primary');account.href=portal();
      const retry=node('button','Réessayer',actions,'gate-secondary');retry.type='button';retry.onclick=()=>location.reload();
      if(window.OrionCloud?.enabled){const backup=node('button','Exporter le brouillon',actions,'gate-secondary');backup.type='button';backup.onclick=()=>OrionCloud.exportDraft();}
      node('p','Les autorisations sont accordées par votre administrateur, module par module.',card,'gate-note');heading.focus({preventScroll:true});
    });
  }
  if(client)client.auth.onAuthStateChange((event,session)=>{
    if(moduleName && window.OrionAccountId && (event==='SIGNED_OUT'||(session?.user?.id && session.user.id!==window.OrionAccountId)))
      setTimeout(()=>blocked(new Error('La session a changé. Revenez à votre espace compte.')),0);
  });
  window.OrionAuth={client,configError,rpc,access,guard,portal,root,blocked};
  window.OrionReady=(async()=>{
    if(!moduleName){try{window.OrionSession=await access();window.OrionAccountId=window.OrionSession?.user?.id;}catch{}return;}
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
      if(window.OrionStore){try{await OrionStore.flush();}catch(error){OrionUI.notify('Déconnexion interrompue : exportez votre brouillon avant de quitter.',true);return;}}
      if(client){const {error}=await client.auth.signOut();if(error){alert(error.message);return;}}
      location.href=portal();return;
    }
    if(/^(dropdown(Login|Register|Admin|Account)Btn|openLoginModalBtn|openRegisterModalBtn|loginBtn|registerBtn)$/.test(b.id)){
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
    const menu=document.getElementById('userDropdownMenu');
    if(!menu)return;
    menu.setAttribute('aria-label','Compte et administration');
    const section=document.createElement('div');
    section.id='orionMenuAccountSection';
    section.className='py-1 border-b border-slate-100 dark:border-slate-800';
    menu.insertBefore(section,menu.children[1]||null);
    const add=(id,label,mode)=>{
      if(document.getElementById(id))return;
      const a=document.createElement('a');a.id=id;a.href=portal(mode);a.textContent=label;
      a.className='block w-full text-left px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800';
      section.append(a);
    };
    add('orionMenuAccountLink','Mon compte et mes accès','login');
    window.OrionReady.then(()=>{
      if(window.OrionSession?.is_admin)add('orionMenuAdminLink','Administration','admin');
    });
  });
})();
