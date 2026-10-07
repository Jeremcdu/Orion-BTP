(async()=>{
'use strict';
const {client,rpc,access,root}=OrionAuth, content=document.getElementById('content'),message=document.getElementById('message');
const mode=new URLSearchParams(location.search).get('mode')||'login';
const say=s=>message.textContent=s;
const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;};
const button=(text,fn,parent)=>{const b=el('button',text,parent);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){say(e.message||'Opération impossible');}finally{b.disabled=false;}};return b;};
function field(form,title,name,type='text',required=true){const l=el('label',title,form),i=el('input',null,l);i.name=name;i.type=type;i.required=required;if(type==='password'){i.minLength=12;i.autocomplete=mode==='login'?'current-password':'new-password';}return i;}
function form(title,fields,submit,fn){content.replaceChildren();const s=el('section',null,content);el('h2',title,s);const f=el('form',null,s);const inputs={};for(const [label,name,type] of fields)inputs[name]=field(f,label,name,type);const b=el('button',submit,f);b.type='submit';f.onsubmit=async e=>{e.preventDefault();b.disabled=true;say('Traitement…');try{await fn(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value])));}catch(e){say(e.message);}finally{b.disabled=false;}};return inputs;}
async function checked(result){const {data,error}=await result;if(error)throw error;return data;}
if(!client){say(OrionAuth.configError||'Configuration nécessaire : ajoutez l’URL et la clé publique Supabase dans assets/orion-config.js, puis rechargez.');return;}
let recovery=false;
client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;queueMicrotask(passwordForm);}});
function passwordForm(){form('Choisir un nouveau mot de passe',[['Nouveau mot de passe (12 caractères minimum)','password','password']], 'Enregistrer',async v=>{await checked(client.auth.updateUser({password:v.password}));await checked(client.auth.signOut({scope:'global'}));location.href='compte.html?mode=login';});say('Après modification, reconnectez-vous.');}
function authForm(){
 if(mode==='register'){
  form('Créer un compte',[['Nom complet','name','text'],['Métier','profession','text'],['Email','email','email'],['Mot de passe (12 caractères minimum)','password','password']],'Créer le compte',async v=>{
   await checked(client.auth.signUp({email:v.email,password:v.password,options:{emailRedirectTo:new URL('compte.html',root).href,data:{full_name:v.name,profession:v.profession}}}));
   content.replaceChildren();say('Si l’inscription est possible, un email de confirmation vous sera envoyé. Confirmez votre adresse puis connectez-vous. Les accès aux modules doivent être accordés par l’administrateur.');
  });
 }else if(mode==='recover'){
  form('Réinitialiser le mot de passe',[['Email','email','email']],'Envoyer le lien',async v=>{await checked(client.auth.resetPasswordForEmail(v.email,{redirectTo:new URL('compte.html?mode=reset',root).href}));say('Si un compte correspond à cette adresse, vous recevrez un lien de réinitialisation. Ouvrez-le dans ce navigateur.');});
 }else{
  form('Connexion',[['Email','email','email'],['Mot de passe','password','password']],'Se connecter',async v=>{await checked(client.auth.signInWithPassword({email:v.email,password:v.password}));await dashboard();});
 }
}
async function mfa(parent){
 el('h2','Double authentification administrateur',parent);
 el('p','Les fonctions administrateur exigent un code de votre application d’authentification.',parent);
 const factors=await checked(client.auth.mfa.listFactors());
 let factor=factors.totp.find(f=>f.status==='verified');
 let enrollment;
 if(!factor){
  button('Configurer la double authentification',async()=>{
   if(enrollment)return;
   // Clear only unverified TOTP setups left by this account’s earlier aborted enrollment.
   for(const f of factors.all.filter(f=>f.factor_type==='totp'&&f.status==='unverified'))await checked(client.auth.mfa.unenroll({factorId:f.id}));
   enrollment=await checked(client.auth.mfa.enroll({factorType:'totp',friendlyName:'Orion administration'}));factor=enrollment;
   const img=el('img',null,parent);img.alt='QR code de configuration TOTP';
   img.src=enrollment.totp.qr_code.startsWith('data:')?enrollment.totp.qr_code:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(enrollment.totp.qr_code);
   el('p','Clé manuelle : '+enrollment.totp.secret,parent);codeForm();
  },parent);
 }else codeForm();
 function codeForm(){const f=el('form',null,parent),i=field(f,'Code à 6 chiffres','code');i.pattern='[0-9]{6}';i.inputMode='numeric';i.autocomplete='one-time-code';const b=el('button','Vérifier',f);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await checked(client.auth.mfa.challengeAndVerify({factorId:factor.id,code:i.value}));await dashboard();}catch(e){say(e.message);}finally{b.disabled=false;}};}
}
async function dashboard(){
 const a=await access();if(!a){authForm();return;}content.replaceChildren();say('');
 const s=el('section',null,content);el('h2',a.user.full_name||a.user.email,s);el('p',a.user.email,s);
 button('Se déconnecter',async()=>{await checked(client.auth.signOut());location.href='compte.html?mode=login';},s);
 if(!a.user.enabled){el('p','Votre compte est suspendu. Contactez l’administrateur.',s);return;}
 if(!a.user.email_verified){el('p','Confirmez votre adresse email avant de continuer.',s);return;}
 if(a.mfa_required){await mfa(s);return;}
 el('h3','Modules',s);
 for(const m of ['m42','m43','m78']){if(a.modules[m]){const link=el('a',m.toUpperCase(),s);link.className='action';link.href=new URL(m+'/index.html',root).href;}else el('p',m.toUpperCase()+' : accès non accordé',s);}
 if(a.is_admin)await admin();
}
async function admin(){
 const s=el('section',null,content);el('h2','Administration des comptes',s);el('p','Les nouveaux comptes apparaissent ici dès leur inscription. Les droits ne prennent effet qu’après confirmation de leur email.',s);
 const search=el('input',null,s);search.placeholder='Rechercher un nom ou un email';search.setAttribute('aria-label','Rechercher les comptes');
 let page=0;const summary=el('p','',s),wrap=el('div',null,s);wrap.className='scroll';
 button('Rechercher / Actualiser',async()=>{page=0;await list();},s);
 const prev=button('Précédent',async()=>{page=Math.max(0,page-1);await list();},s),next=button('Suivant',async()=>{page++;await list();},s);
 const audit=el('div',null,s);button('Voir le journal des modifications',async()=>{
   const logs=await rpc('orion_admin_audit');audit.replaceChildren();
   for(const row of logs)el('p',`${new Date(row.created_at).toLocaleString('fr-FR')} · ${row.actor_email||'Initialisation'} → ${row.target_email||''} · ${row.action} · ${JSON.stringify(row.detail)}`,audit);
 },s);
 async function list(){
  const data=await rpc('orion_admin_accounts',{p_search:search.value,p_page:page,p_limit:25});wrap.replaceChildren();summary.textContent=`${data.total} compte(s) · Page ${page+1}`;
  prev.disabled=page===0;next.disabled=(page+1)*25>=data.total;
  const table=el('table',null,wrap),head=el('tr',null,el('thead',null,table));for(const h of ['Compte','État','Modules','Action'])el('th',h,head);
  const tbody=el('tbody',null,table);
  for(const u of data.accounts){
   const row=el('tr',null,tbody),identity=el('td',u.full_name||'Sans nom',row);el('small',u.email,identity);el('small',u.profession,identity);
   el('td',u.is_admin?'Administrateur':!u.enabled?'Suspendu':u.email_verified?'Actif':'Email à confirmer',row);
   const permissions=el('td',null,row);
   for(const m of ['m42','m43','m78']){const l=el('label',null,permissions),cb=el('input',null,l);cb.type='checkbox';cb.checked=u.is_admin||!!u.modules[m];cb.disabled=u.is_admin;l.append(document.createTextNode(m.toUpperCase()));cb.onchange=async()=>{const old=!!u.modules[m];cb.disabled=true;try{await rpc('orion_admin_set_module',{p_user_id:u.id,p_module:m,p_allowed:cb.checked});u.modules[m]=cb.checked;say('Droit enregistré côté serveur.');}catch(e){cb.checked=old;say(e.message);}finally{cb.disabled=u.is_admin;}};}
   const action=el('td',null,row);if(!u.is_admin)button(u.enabled?'Suspendre':'Réactiver',async()=>{await rpc('orion_admin_set_enabled',{p_user_id:u.id,p_enabled:!u.enabled});say('État du compte enregistré.');await list();},action);
  }
 }
 await list();
}
try{
 // Initialization processes the PKCE email callback before choosing the screen.
 await client.auth.getSession();
 if(recovery||mode==='reset'){const a=await access();if(a)passwordForm();else{say('Lien expiré ou ouvert dans un autre navigateur. Demandez un nouveau lien.');authForm();}}
 else if(mode==='register'||mode==='recover')authForm();else await dashboard();
}catch(e){say(e.message);}
})();
