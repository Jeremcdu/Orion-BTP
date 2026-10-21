/* Browser regression checks against synthetic accounts; no real Supabase traffic. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright');
const root = path.resolve(__dirname, '..'), output = path.resolve(root, '../qa-output/platform');
fs.mkdirSync(output, { recursive: true });
const sdk = `window.supabase={createClient(){
const user={id:'11111111-1111-4111-8111-111111111111'};
const profile={user:{...user,full_name:'Compte de test',email:'test@example.invalid',enabled:true,email_verified:true},modules:{m42:true,m43:true,m78:true},is_admin:false};
const forever=()=>new Promise(()=>{});
return {auth:{getSession:async()=>window.__slowSession?forever():({data:{session:null},error:null}),getUser:async()=>window.__slowUser?forever():({data:{user:window.__signedIn?user:null},error:null}),onAuthStateChange:()=>({}),signInWithPassword:async args=>{window.__login=args;window.__signedIn=true;return {data:{user},error:null}},signUp:async args=>{window.__register=args;return {data:{},error:null}}},rpc:async name=>window.__slowRpc?forever():({data:name==='orion_require_module'?{user_id:user.id}:profile,error:null}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})};}};`;
const server = http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.endsWith('/assets/supabase.js')){res.setHeader('content-type','text/javascript');return res.end(sdk);}
  const relative=decodeURIComponent(url.pathname.slice(1))||'index.html',file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  const ext=path.extname(file),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[ext]||'application/octet-stream';
  res.setHeader('content-type',type);fs.createReadStream(file).pipe(res);
});
const results=[]; let browser,base;
async function test(name,run){if(process.env.ORION_PLATFORM_ONLY&&!name.includes(process.env.ORION_PLATFORM_ONLY))return;try{await run();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.stack});console.error('FAIL',name,e.message);}}
async function page(options={}){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',...options});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const p=await context.newPage();
  return {context,p};
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.ORION_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  await test('Connexion historique acceptée sans imposer la politique des nouveaux mots de passe',async()=>{
    const {context,p}=await page();await p.goto(base+'/compte.html');await p.locator('input[name=password]').waitFor();
    assert.equal(await p.locator('input[name=password]').getAttribute('minlength'),null);
    assert.equal(await p.locator('input[name=password]').getAttribute('autocomplete'),'current-password');
    await p.locator('input[name=email]').fill('test@example.invalid');await p.locator('input[name=password]').fill('ancien123');
    await p.getByRole('button',{name:'Se connecter',exact:true}).click();await p.getByRole('heading',{name:'Mes outils'}).waitFor();
    assert.equal(await p.evaluate(()=>window.__login.password),'ancien123');await context.close();
  });
  await test('Inscription conserve 12 caractères minimum et new-password',async()=>{
    const {context,p}=await page();await p.goto(base+'/compte.html?mode=register');const input=p.locator('input[name=password]');await input.waitFor();
    assert.equal(await input.getAttribute('minlength'),'12');assert.equal(await input.getAttribute('autocomplete'),'new-password');
    await input.fill('court');assert.equal(await input.evaluate(n=>n.checkValidity()),false);await context.close();
  });
  await test('Compte mobile : champs 16px, bouton accessible, aucun débordement, clair/sombre',async()=>{
    for(const width of [320,375,390])for(const dark of [false,true]){
      const {context,p}=await page({viewport:{width,height:844}});await context.addInitScript(dark=>localStorage.setItem('theme',dark?'dark':'light'),dark);
      await p.goto(base+'/compte.html');await p.locator('input[name=password]').waitFor();
      for(const input of await p.locator('input').all())assert.ok(await input.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await p.getByRole('button',{name:'Se connecter',exact:true}).scrollIntoViewIfNeeded();
      if(width===320){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(output,'compte-320-'+(dark?'dark':'light')+'.png'),fullPage:true});}
      await context.close();
    }
  });
  await test('Démarrage du compte bloqué : attente bornée et action Réessayer',async()=>{
    const {context,p}=await page();await context.addInitScript(()=>{window.__slowSession=true;const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000?35:ms,...args);});
    await p.goto(base+'/compte.html');await p.getByRole('button',{name:'Réessayer',exact:true}).waitFor();
    assert.match(await p.locator('#message').innerText(),/Connexion interrompue/);assert.equal(await p.locator('.loading-card').count(),0);await context.close();
  });
  await test('Contrôle des droits bloqué : accès fermé et reprise disponible après timeout',async()=>{
    const {context,p}=await page();await context.addInitScript(()=>{window.__slowRpc=true;const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000?35:ms,...args);});
    await p.goto(base+'/m42/index.html');await p.locator('#orionGateTitle').waitFor();
    assert.equal(await p.locator('#orionGateTitle').innerText(),'Connexion interrompue');
    assert.ok(await p.evaluate(()=>document.documentElement.classList.contains('orion-locked')));
    await p.waitForFunction(()=>!document.getElementById('orionLoading'));
    assert.equal(await p.locator('#orionLoading').count(),0);await p.getByRole('button',{name:'Réessayer',exact:true}).waitFor();
    await context.close();
  });
  await test('Préférence de mouvement réduit : constellation statique, animations normales conservées',async()=>{
    for(const reducedMotion of ['reduce','no-preference']){
      const {context,p}=await page({reducedMotion});await p.goto(base+'/index.html');await p.waitForFunction(()=>!document.documentElement.classList.contains('orion-booting'));
      const names=await p.locator('.star-twinkle,.star-glow').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).animationName));
      assert.equal(names.length,11);assert.equal(names.every(n=>n==='none'),reducedMotion==='reduce');await context.close();
    }
  });
  await test('Logo partagé chargé sur accueil, compte, 404 et porte d’accès',async()=>{
    for(const file of ['index.html','compte.html','404.html','m42/index.html']){
      const {context,p}=await page();if(file==='m42/index.html')await context.addInitScript(()=>{window.__slowRpc=true;const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000?35:ms,...args);});
      const resources=[];p.on('response',r=>{if(r.url().includes('orion-brand.svg'))resources.push(r.status());});
      await p.goto(base+'/'+file);await p.waitForTimeout(150);
      const use= p.locator('svg:visible use[href*="orion-brand.svg"]').first();await use.waitFor({state:'attached'});
      assert.ok(resources.includes(200));assert.ok(await use.evaluate(n=>n.ownerSVGElement.getBoundingClientRect().width>0));
      if(file==='404.html')await p.screenshot({path:path.join(output,'404.png'),fullPage:true});await context.close();
    }
  });
  await test('Icônes dynamiques : changement après conversion SVG et marque partagée préservée',async()=>{
    const {context,p}=await page();await p.goto(base+'/index.html');await p.waitForFunction(()=>!document.documentElement.classList.contains('orion-booting'));
    const result=await p.evaluate(()=>{
      const icon=document.createElement('i');icon.id='dynamicIconTest';icon.className='w-5 h-5';icon.setAttribute('data-lucide','moon');document.body.append(icon);
      lucide.createIcons();const before=document.getElementById('dynamicIconTest').innerHTML;
      document.getElementById('dynamicIconTest').setAttribute('data-lucide','sun');lucide.createIcons();
      const after=document.getElementById('dynamicIconTest');lucide.createIcons();
      return {changed:before!==after.innerHTML,name:after.getAttribute('data-orion-rendered'),className:after.getAttribute('class'),same:after===document.getElementById('dynamicIconTest'),brand:!!document.querySelector('use[href*="orion-brand.svg"]')};
    });
    assert.equal(result.changed,true);assert.equal(result.name,'sun');assert.equal(result.same,true);assert.equal(result.brand,true);assert.doesNotMatch(result.className,/lucide-moon/);await context.close();
  });
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await browser?.close();server.close();
  let recorded=results;
  if(process.env.ORION_PLATFORM_ONLY&&fs.existsSync(path.join(output,'results.json'))){const previous=JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8')).results||[];const merged=new Map(previous.map(r=>[r.name,r]));for(const r of results)merged.set(r.name,r);recorded=[...merged.values()];}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results:recorded},null,2));
  if(results.some(r=>!r.passed))process.exitCode=1;console.log(results.filter(r=>r.passed).length+'/'+results.length+' checks passed');
});
