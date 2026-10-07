const fs=require('fs'),assert=require('assert/strict'),{JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const base='site/';
async function load(path,{allow=true,configured=true,admin=false,mfa=false}={}){
 const errors=[],calls=[];let denied=!allow;
 const session={user:{id:'alice',email:'alice@test.fr',full_name:'Alice',enabled:true,email_verified:true},is_admin:admin,mfa_required:mfa,modules:{m42:allow,m43:allow,m78:allow}};
 let html=fs.readFileSync(base+path,'utf8').replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g,(m,p)=>{
  if(p.endsWith('orion-auth.js'))return '<script>'+fs.readFileSync(base+'assets/orion-auth.js','utf8').replace('document.currentScript.src',"'https://example.test/assets/orion-auth.js'")+'</script>';
  if(p.endsWith('account.js'))return '';
  return '';
 });
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://example.test/'+path,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 w.ORION_CONFIG=configured?{url:'https://test.supabase.co',publishableKey:'public'}:{};
 w.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'alice'}}}),getSession:async()=>({data:{session:{}}}),onAuthStateChange(){},mfa:{listFactors:async()=>({data:{totp:[{id:'factor',status:'verified'}],all:[]}})}},rpc:async(name,args)=>{calls.push({name,args});if(name==='orion_require_module')return denied?{error:{message:'Refusé'}}:{data:{allowed:true,user_id:'alice'}};if(name==='orion_my_access')return {data:session};if(name==='orion_admin_accounts')return {data:{total:1,accounts:[{id:'bob',full_name:'<img onerror=alert(1)>',email:'bob@test.fr',enabled:true,email_verified:true,is_admin:false,modules:{m42:false}}]}};if(name==='orion_admin_set_module')return {error:{message:'Droit refusé'}};return {data:[]};}})};
 w.indexedDB=new IDBFactory();w.Blob=Blob;w.lucide={createIcons(){}};w.pdfjsLib={GlobalWorkerOptions:{}};w.alert=()=>{};w.confirm=()=>true;w.HTMLCanvasElement.prototype.getContext=()=>({});w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 w.localStorage.setItem('orion_btp_projects',JSON.stringify([{id:'secret',name:'Ancien compte'}]));
 }});
 await new Promise(r=>setTimeout(r,80));if(path==='compte.html'){dom.window.eval(fs.readFileSync(base+'assets/account.js','utf8'));await new Promise(r=>setTimeout(r,40));}
 assert.deepEqual(errors,[],path);return {w:dom.window,calls,revoke(){denied=true},close(){}};
}
(async()=>{
 for(const p of ['index.html','m42/index.html','m43/index.html','m78/index.html']){const a=await load(p);assert(a.w.OrionStore,p);assert.equal(a.w.document.getElementById('orionSaveStatus'),null);assert.equal(a.w.OrionStore.load().length,0,'old account must not leak');a.close();console.log('PASS startup/isolation '+p);}
 for(const opts of [{allow:false},{configured:false}]){const a=await load('m42/index.html',opts);assert(!a.w.OrionStore);assert(a.w.document.getElementById('orionGate'));a.close();}
 const a=await load('m42/index.html');a.revoke();await assert.rejects(a.w.OrionStore.save([{id:'p',name:'Test'}]));a.close();console.log('PASS denied/unconfigured/revoked writes');
 const b=await load('compte.html',{admin:true});assert.equal(b.w.document.querySelectorAll('td img').length,0);const cb=b.w.document.querySelector('input[type=checkbox]');cb.checked=true;await cb.onchange();assert.equal(cb.checked,false);assert.match(b.w.document.getElementById('message').textContent,/Droit refusé/);b.close();console.log('PASS admin XSS escaping and server error rollback');
 const c=await load('compte.html',{admin:true,mfa:true});assert.equal(c.calls.filter(x=>x.name==='orion_admin_accounts').length,0);assert.match(c.w.document.getElementById('content').textContent,/Double authentification/);c.close();console.log('PASS MFA gates admin list');process.stdout.write('',()=>process.exit(0));
})().catch(e=>{console.error(e);process.exit(1)});
