/* M43 browser recipe with the real pinned document generators and a local Supabase transport.
 * Run with CODEX_PRIMARY_RUNTIME_NODE_MODULES and optionally ORION_EDGE_PATH set.
 * Optional pinned generator caches: docx-8.5.0.umd.js and html2pdf-0.10.1.bundle.js
 * under ORION_M43_VENDOR_DIR or ../qa-m43; otherwise the production CDN URLs are used.
 * No request reaches production Supabase. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const dependency = name => require(modules ? path.join(modules, name) : name);
const { chromium } = dependency('playwright');
const JSZip = dependency('jszip');
const { PDFDocument, PDFName, PDFRawStream } = dependency('pdf-lib');
const root = path.resolve(__dirname, '..'), qa = path.resolve(root, '../qa-m43');
const vendor = path.resolve(process.env.ORION_M43_VENDOR_DIR || qa);
fs.mkdirSync(qa, { recursive: true });
const id = '11111111-1111-4111-8111-111111111111';
const clone = value => JSON.parse(JSON.stringify(value));
const text = 'Prescription de recette : étanchéité, matériaux et réception.\n' + Array.from({length:36}, (_, i) => `${i + 1}. Contrôler les supports et les interfaces entre lots. Conserver les accents et les retours à la ligne.`).join('\n');
let row = {revision:1,projects:[{id:'qa-m43',name:'École de recette',client:'Client fictif',location:'Paris',status:'En cours',companies:[],lots:[],cctp:{context:'Rénovation de recette — données fictives.',sections:[{id:'s1',lot:'Étanchéité',chapter:'Toitures',subpart:'Exécution',title:'Support et réception',text}],templates:[]}}]};
const files = new Map(), checks = [], errors = [], dialogs = [];
let saveCount = 0, failSaves = false;
const sdk = `window.supabase={createClient(){
const call=async(path,options={})=>{const r=await fetch('/__qa/'+path,options);const data=await r.json();return r.ok?{data,error:null}:{data:null,error:data};};
return {auth:{getUser:async()=>({data:{user:{id:${JSON.stringify(id)}}},error:null}),onAuthStateChange:()=>({}),signOut:async()=>({error:null})},
rpc:(name,args={})=>call('rpc/'+name,{method:'POST',body:JSON.stringify(args)}),
from:()=>({select:()=>({eq:()=>({maybeSingle:()=>call('projects')})})}),
storage:{from:()=>({upload:async(key,blob)=>{const r=await fetch('/__qa/files/'+key,{method:'POST',headers:{'X-Blob-Type':blob.type},body:blob});return r.ok?{error:null}:{error:await r.json()};},download:async key=>{const r=await fetch('/__qa/files/'+key);return r.ok?{data:await r.blob(),error:null}:{data:null,error:await r.json()};}})}};}};`;
const server = http.createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const json = (data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname.startsWith('/__qa/')){
    const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
    if(url.pathname.startsWith('/__qa/files/')){
      const key=decodeURIComponent(url.pathname.slice('/__qa/files/'.length));
      if(!key.startsWith(id+'/'))return json({message:'Forbidden'},403);
      if(req.method==='POST'){if(files.has(key))return json({statusCode:'409'},409);files.set(key,{bytes,type:req.headers['x-blob-type']});return json({});}
      const file=files.get(key);if(!file)return json({message:'Missing'},404);
      res.writeHead(200,{'Content-Type':file.type||'application/octet-stream'});return res.end(file.bytes);
    }
    const body=bytes.length?JSON.parse(bytes):{};
    if(url.pathname==='/__qa/projects')return json(row);
    if(url.pathname==='/__qa/rpc/orion_my_access')return json({user:{id,full_name:'Recette M43',email:'qa@example.invalid',enabled:true},is_admin:false,modules:{m42:true,m43:true,m78:true}});
    if(url.pathname==='/__qa/rpc/orion_require_module')return json({user_id:id,allowed:true});
    if(url.pathname==='/__qa/rpc/orion_save_projects'){
      saveCount++;if(failSaves)return json({message:'Panne de recette'},503);
      if(row.revision!==body.p_expected_revision)return json({saved:false,revision:null});
      row={projects:clone(body.p_projects),revision:row.revision+1};return json({saved:true,revision:row.revision});
    }
    return json({message:'Not found'},404);
  }
  if(url.pathname==='/assets/supabase.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(sdk);}
  const relative=decodeURIComponent(url.pathname.slice(1));
  const filename=path.resolve(root,relative||'index.html');
  if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':'text/javascript'});fs.createReadStream(filename).pipe(res);
});
async function check(name,run){try{await run();checks.push({name,passed:true});console.log('PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});throw e;}}
let browser,context,page,base;
async function visit(){await page.goto(base+'/m43/index.html');await page.evaluate(()=>window.OrionReady);await page.locator('#projectsGrid > div').first().click();await page.locator('#selectModuleReunion').click();await page.locator('#sectionText').waitFor();}
async function flush(){await page.evaluate(()=>OrionStore.flush());}
async function exportFile(button,extension){
  await page.locator('#openReportConfigBtn').click();
  const downloadPromise=page.waitForEvent('download');await page.locator(button).click();const download=await downloadPromise;
  const filename=path.join(qa,'cctp-brouillon.'+extension);await download.saveAs(filename);return fs.readFileSync(filename);
}
function archivedFile(source){return row.projects[0].documents.files.filter(f=>f.source===source).at(-1);}
function archivedBytes(file){return files.get(id+'/'+(file.storageId||file.id)).bytes;}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.ORION_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
  const generator = filename => route => fs.existsSync(path.join(vendor,filename)) ? route.fulfill({path:path.join(vendor,filename),contentType:'text/javascript'}) : route.continue();
  await context.route('https://unpkg.com/docx@8.5.0/build/index.umd.js',generator('docx-8.5.0.umd.js'));
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',generator('html2pdf-0.10.1.bundle.js'));
  await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await check('Ajout, édition, réordonnancement et rechargement du CCTP',async()=>{
    await visit();await page.locator('#cctpAdd').click();const dialog=page.getByRole('dialog');
    await dialog.locator('[name="title"]').fill('Deuxième prescription');await dialog.locator('button[type="submit"]').click();await dialog.waitFor({state:'detached'});
    await page.locator('#sectionText').fill('Prescription ajoutée — à conserver.');await flush();await page.locator('#sectionUp').click();await page.waitForFunction(()=>document.getElementById('sectionUp').disabled);await flush();
    assert.equal(row.projects[0].cctp.sections[0].title,'Deuxième prescription');
    await visit();assert.equal(await page.locator('#sectionText').inputValue(),'Prescription ajoutée — à conserver.');
  });
  await check('Validation TXT versionnée, snapshot stable et brouillon indépendant',async()=>{
    assert.match(await page.locator('#cctpValidate').textContent(),/TXT/);await page.locator('#cctpValidate').click();await page.locator('#cctpStatus').filter({hasText:'Version TXT validée'}).waitFor();
    const first=archivedFile('CCTP validé');assert.equal(first.version,1);const bytes=archivedBytes(first);assert.match(bytes.toString(),/Version 1/);
    await page.locator('#sectionText').fill('Prescription modifiée après validation.');await flush();
    assert.ok(!archivedBytes(first).toString().includes('modifiée après validation'));
    await page.locator('#cctpValidate').click();await page.locator('#cctpStatus').filter({hasText:'Version TXT validée'}).waitFor();
    assert.equal(archivedFile('CCTP validé').version,2);assert.deepEqual(Object.keys(row.projects[0].cctp.validatedSnapshot).sort(),['context','sections']);
    assert.equal(row.projects[0].documents.counters.CCTP,2);assert.deepEqual(archivedBytes(first),bytes);
  });
  await check('Word bleu au repos, survol, focus et génération désactivée',async()=>{
    await page.locator('#openReportConfigBtn').click();const button=page.locator('#exportWordReportBtn');
    assert.match(await button.textContent(),/Word · Brouillon/);assert.match(await page.locator('#reportConfigSubtitle').textContent(),/séparément une version TXT/);
    const color=()=>button.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(await color(),'rgb(37, 99, 235)');
    await button.hover();await page.waitForTimeout(200);assert.equal(await color(),'rgb(59, 130, 246)');
    await button.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.waitForTimeout(200);assert.equal(await button.evaluate(el=>getComputedStyle(el).outlineColor),'rgb(37, 99, 235)');
    await button.evaluate(el=>{el.disabled=true;});await page.waitForTimeout(200);assert.equal(await color(),'rgb(37, 99, 235)');
    await button.evaluate(el=>{el.disabled=false;});await page.locator('#closeReportConfigBtn').click();
  });
  await check('DOCX réel : contenu, auteur M43, archive identique et statut Brouillon',async()=>{
    const bytes=await exportFile('#exportWordReportBtn','docx'),zip=await JSZip.loadAsync(bytes);
    const props=await zip.file('docProps/core.xml').async('string'),doc=await zip.file('word/document.xml').async('string');
    assert.match(props,/<dc:creator>Orion BTP M43<\/dc:creator>/);assert.ok(!props.includes('M73'));assert.match(doc,/Brouillon/);assert.match(doc,/Prescription modifiée après validation/);assert.match(doc,/Étanchéité/);
    assert.deepEqual(archivedBytes(archivedFile('Export CCTP (brouillon)')),bytes);assert.equal(row.projects[0].documents.counters.CCTP,2);
  });
  await check('Excel réel : XML ouvrable, chaînes, accents, paragraphes et archive',async()=>{
    const bytes=await exportFile('#exportExcelReportBtn','xls');const xml=bytes.toString();
    assert.match(xml,/ss:Type="String">Brouillon/);assert.match(xml,/Étanchéité/);assert.match(xml,/Prescription modifiée après validation/);assert.match(xml,/36\. Contrôler/);
    assert.equal(await page.evaluate(xml=>new DOMParser().parseFromString(xml,'application/xml').querySelectorAll('parsererror').length,xml),0);
    assert.deepEqual(archivedBytes(archivedFile('Export CCTP (brouillon)')),bytes);
  });
  await check('PDF réel multipage et archive identique',async()=>{
    const bytes=await exportFile('#exportPdfReportBtn','pdf');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=2);assert.deepEqual(archivedBytes(archivedFile('Export CCTP (brouillon)')),bytes);
    let image=0;for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream&&String(object.dict.get(PDFName.of('Subtype')))==='/Image'&&String(object.dict.get(PDFName.of('Filter')))==='/DCTDecode')fs.writeFileSync(path.join(qa,`cctp-pdf-image-${++image}.jpg`),object.contents);
    assert.ok(image>=2);
    await page.screenshot({path:path.join(qa,'cctp-desktop.png'),fullPage:true});
  });
  await check('Documents : archives et octets retrouvés après rechargement sans cache',async()=>{
    await context.close();context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
    await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await visit();
    const archived=row.projects[0].documents.files;assert.equal(archived.length,5);
    const restored=await page.evaluate(async ids=>Promise.all(ids.map(async id=>Array.from(new Uint8Array(await(await OrionStore.fileGet(id)).arrayBuffer())))),archived.map(f=>f.storageId||f.id));
    for(let i=0;i<archived.length;i++)assert.deepEqual(Buffer.from(restored[i]),archivedBytes(archived[i]));
    await page.locator('#backToPreviousBtn').click();await page.locator('#selectModuleReserves').click();await page.locator('#driveItems button').filter({has:page.getByText('CCTP',{exact:true})}).click();
    assert.equal(await page.locator('#driveItems').getByText('CCTP validé',{exact:false}).count(),2);assert.equal(await page.locator('#driveItems').getByText('Export CCTP (brouillon)',{exact:false}).count(),3);
    await page.screenshot({path:path.join(qa,'documents-mobile.png'),fullPage:true});
  });
  await check('Partage indisponible explicite, aucune permission ou sauvegarde implicite',async()=>{
    assert.ok(await page.getByText('Partage externe indisponible : aucun lien',{exact:false}).isVisible());
    await page.locator('#driveBreadcrumb summary').click();await page.getByRole('button',{name:'Partage externe · Indisponible',exact:true}).click();const modal=page.getByRole('dialog');
    assert.ok(await modal.getByText('Le partage externe est indisponible.',{exact:false}).isVisible());
    for(const selector of ['#sharePermission','#shareCreate','#shareCopy','#shareRevoke'])assert.ok(await modal.locator(selector).isDisabled());
    assert.ok(await modal.evaluate(el=>el.contains(document.activeElement)));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(qa,'sharing-unavailable-mobile.png'),fullPage:true});
    assert.equal(await modal.locator('#shareUrl').inputValue(),'');const before=saveCount;
    await modal.locator('#sharePermission').evaluate(el=>{el.value='deposit';el.dispatchEvent(new Event('change'));});await flush();assert.equal(saveCount,before);
    assert.ok(!row.projects[0].documents.folders.some(f=>f.sharePermission));await modal.getByRole('button',{name:'Fermer',exact:true}).click();
  });
  await check('Échec serveur de validation : aucune confirmation de réussite ni compteur avancé',async()=>{
    await page.locator('#backToPreviousBtn').click();await page.locator('#selectModuleReunion').click();failSaves=true;const before=row.projects[0].documents.counters.CCTP;
    await page.locator('#cctpValidate').click();await page.waitForFunction(()=>!document.getElementById('cctpValidate').disabled);assert.equal(row.projects[0].documents.counters.CCTP,before);assert.ok(!await page.locator('#cctpStatus').textContent().then(t=>t.startsWith('Version TXT validée')));
    failSaves=false;
  });
  await check('Aucune exception JavaScript inattendue',async()=>assert.deepEqual(errors,[]));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(qa,'m43-results.json'),JSON.stringify({checks,errors,dialogs,limitations:['Transport Supabase local simulé ; aucun changement en production.','Lecture visuelle Office et téléphone physique non exécutées.']},null,2));
  if(browser)await browser.close();server.close();
});
