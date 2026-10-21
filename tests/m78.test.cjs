/* M78 reports and touch regression checks. Uses a local project adapter;
 * no account or production database is accessed. Report hooks exist only in
 * the HTML response served by this test, never in the application file. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const dependency = name => require(modules ? path.join(modules, name) : name);
const { chromium } = dependency('playwright');
const JSZip = dependency('jszip');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../qa-output/m78');
// Download the pinned application bundles into ORION_TEST_VENDOR_DIR for an offline, repeatable test.
const vendor = process.env.ORION_TEST_VENDOR_DIR || path.resolve(root, '../m78-vendor');
fs.mkdirSync(output, { recursive: true });
const results = [], errors = [];
const auth = `window.OrionAccountId='m78-test'; window.OrionSession={user:{id:'m78-test',email:'test@example.invalid'}};
window.OrionReady=new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
window.OrionAuth={root:new URL('../',document.currentScript.src),guard:async()=>true,blocked:error=>console.error(error),portal:()=>'/compte.html'};
window.OrionDomReady=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  let text;
  if (pathname.endsWith('/assets/orion-auth.js')) text = auth;
  if (pathname.endsWith('/assets/orion-cloud.js')) text = 'window.OrionCloud={initialize:async()=>{}};';
  if (pathname.endsWith('/assets/supabase.js')) text = '';
  if (text !== undefined) { response.writeHead(200, {'Content-Type':'text/javascript'}); return response.end(text); }
  const filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { response.writeHead(404); return response.end(); }
  let content = fs.readFileSync(filename);
  if (pathname === '/m78/index.html') content = content.toString().replace('// INITIALISATION',
    'window.__m78Test={state,buildReportHtml,buildReportPlanImage,buildWordReportDocument,getReportReserveNumber,render,renderActiveProject};\n// INITIALISATION');
  const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'text/javascript';
  response.writeHead(200, {'Content-Type':type}); response.end(content);
});
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); throw error; }
}
let browser, context, page, base;
async function docxPackage(view, includePhotos = true) {
  const bytes = await page.evaluate(async ({view,includePhotos}) => {
    const api=window.__m78Test; api.state.currentView=view; api.state.reportConfig.includePhotos=includePhotos;
    const doc=await api.buildWordReportDocument(api.state.projects[0]);
    const blob=await window.docx.Packer.toBlob(doc); return [...new Uint8Array(await blob.arrayBuffer())];
  }, {view,includePhotos});
  const buffer = Buffer.from(bytes); fs.writeFileSync(path.join(output, view+(includePhotos?'':'-without-photos')+'.docx'),buffer);
  const zip=await JSZip.loadAsync(buffer);
  return { xml:await zip.file('word/document.xml').async('string'), images:Object.keys(zip.files).filter(name=>/^word\/media\/.+\.(png|jpe?g|gif)$/.test(name)), zip };
}
async function reportHtml(view, includePhotos = true) {
  return page.evaluate(async ({view,includePhotos}) => {
    const api=window.__m78Test, project=api.state.projects[0];
    api.state.currentView=view; api.state.reportConfig.includePhotos=includePhotos;
    const plans=new Map(); if(view!=='reunion') for(const lot of project.lots) plans.set(lot.id,await api.buildReportPlanImage(lot));
    return api.buildReportHtml(project,plans);
  }, {view,includePhotos});
}
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.ORION_BROWSER_EXECUTABLE || (process.platform==='win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
  context=await chromium.launchPersistentContext(path.join(output,'browser-profile'),{headless:true,executablePath,viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  browser=context.browser();
  await context.addInitScript(() => {
    const image=(width,height,color)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,width,height);return c.toDataURL('image/png');};
    const plan=image(900,600,'#e2e8f0'), landscape=image(400,200,'#fda4af'), portrait=image(200,400,'#7dd3fc');
    const project={id:'p1',name:'École — chantier de recette',client:'Maître d’ouvrage',location:'Paris',status:'En cours',activeLotId:'lot1',
      companies:[{id:'c1',name:'Entreprise Électricité',lot:'Électricité',contactPerson:'Élodie',phone:'0102030405',email:'qa@example.invalid'}],
      layoutSettings:{moeRoles:[{role:'Architecte',intervenant:'Maîtrise d’œuvre',contact:'moe@example.invalid'}],adminBlocks:[{title:'Titre administratif seul',text:''},{title:'Marché',text:'Contrat\nDeuxième ligne'}]},
      reunion:{number:7,date:'2026-10-20',nextDate:'2026-10-27',subject:'Réunion de recette',generalNotes:[{title:'Consigne sélectionnée',text:'À conserver',selected:true},{title:'Consigne non sélectionnée',text:'À exclure',selected:false}],notes:[{id:'n1',company:'c1',status:'À faire',date:'2026-10-25',text:'Observation\nSeconde ligne',photos:[portrait,landscape]}],attendees:[{companyId:'c1',present:true,delay:5}],convocationData:{selectedCompanies:['c1']}},
      lots:[{id:'lot1',name:'RDC',planImage:plan,planSource:{page:2,pageCount:3},pins:[{id:'pin1',reserveNumber:42,title:'Prise à reprendre',x:25,y:50,progress:0,description:'Description\nSuite',photos:[portrait],companies:['c1'],dateConstat:'2026-10-20',dateEcheance:'2026-10-25'},{id:'pin2',number:7,title:'Porte terminée',x:75,y:25,progress:100,photos:[landscape],companies:['c1']}]},{id:'lot2',name:'Sans plan',planImage:null,pins:[]}]};
    localStorage.setItem('orion_btp_projects:m78-test',JSON.stringify([project]));
  });
  page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(base+'/m78/index.html'); await page.waitForFunction(()=>window.__m78Test);
  await page.addScriptTag({path:path.join(vendor,'docx-8.5.0.umd.js')});
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',route=>route.fulfill({path:path.join(vendor,'html2pdf.bundle.min.js'),contentType:'text/javascript'}));
  await check('Réunion HTML : photos, bloc administratif sans texte, accents et absence de marque inventée',async()=>{
    const html=await reportHtml('reunion'); fs.writeFileSync(path.join(output,'reunion.html'),html);
    const doc=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return {text:d.body.textContent,photos:d.querySelectorAll('img[alt^="Photo de la remarque"]').length};},html);
    assert.equal(doc.photos,2); assert.match(doc.text,/Titre administratif seul/); assert.match(doc.text,/Élodie/); assert.doesNotMatch(doc.text,/SCAR Ingénierie|Consigne non sélectionnée/);
    const word=await docxPackage('reunion'); assert.match(word.xml,/Titre administratif seul/); assert.match(word.xml,/Photos — Remarque 1 : Entreprise Électricité/); assert.doesNotMatch(word.xml,/Consigne non sélectionnée|SCAR Ingénierie/); assert.equal(word.images.length,2);
    assert.match(word.xml,/Observation<\/w:t>[\s\S]*?<w:t[^>]*>Seconde ligne/);
  });
  await check('Réserves HTML/DOCX : plans annotés et même numéro sur tableau, photos et repères',async()=>{
    const html=await reportHtml('reserves'); fs.writeFileSync(path.join(output,'reserves.html'),html);
    const report=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return {text:d.body.textContent,plans:d.querySelectorAll('img[alt="Plan avec les numéros des réserves"]').length,photos:d.querySelectorAll('img[alt="Photo de la réserve"]').length};},html);
    assert.equal(report.plans,1); assert.equal(report.photos,2); assert.match(report.text,/page 2\/3/); assert.match(report.text,/042/); assert.match(report.text,/007/); assert.match(report.text,/Aucun plan enregistré/);
    const word=await docxPackage('reserves'); assert.match(word.xml,/Photos — Réserve 042/); assert.match(word.xml,/Photos — Réserve 007/); assert.match(word.xml,/page 2\/3/); assert.equal(word.images.length,3);
    const before=await page.evaluate(()=>JSON.stringify(__m78Test.state.projects[0].lots));
    await page.evaluate(async()=>{await __m78Test.buildReportPlanImage(__m78Test.state.projects[0].lots[0]);});
    assert.equal(await page.evaluate(()=>JSON.stringify(__m78Test.state.projects[0].lots)),before);
    const colors=await page.evaluate(async()=>{const image=new Image();image.src=await __m78Test.buildReportPlanImage(__m78Test.state.projects[0].lots[0]);await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);return [[255,319],[705,169]].map(([a,b])=>[...x.getImageData(a,b,1,1).data]);});
    assert.deepEqual(colors,[[190,18,60,255],[4,120,87,255]]);
  });
  await check('Réserves : désactiver les photos conserve le plan et enlève les photos dans les deux formats',async()=>{
    const html=await reportHtml('reserves',false); assert.doesNotMatch(html,/alt="Photo de la réserve"/); assert.match(html,/alt="Plan avec les numéros des réserves"/);
    const word=await docxPackage('reserves',false); assert.doesNotMatch(word.xml,/Photos — Réserve/); assert.equal(word.images.length,1);
  });
  await check('Rendu PDF Edge multi-pages des rapports HTML : toutes les images chargées',async()=>{
    const print=await context.newPage(); await print.emulateMedia({media:'print'});
    for(const view of ['reunion','reserves']) { const html=await reportHtml(view); await print.setContent(html); await print.waitForFunction(()=>[...document.images].every(image=>image.complete && image.naturalWidth>0));
      // The application scopes its PDF styles to this host, so recreate the host used by exportReportAsPdf.
      await print.evaluate(()=>{const wrapper=document.createElement('main');wrapper.className='report-export-content';while(document.body.firstChild)wrapper.append(document.body.firstChild);document.body.append(wrapper);});
      const pdf=await print.pdf({path:path.join(output,view+'-edge.pdf'),format:'A4',printBackground:true}); assert.ok(pdf.length>10000);
      assert.ok((await dependency('pdf-lib').PDFDocument.load(pdf)).getPageCount()>=2);
      await print.screenshot({path:path.join(output,view+'.png'),fullPage:true});
    } await print.close();
  });
  await check('Exports PDF via les vrais boutons et html2pdf 0.10.1 : rapports multi-pages téléchargés',async()=>{
    for(const view of ['reunion','reserves']) {
      await page.evaluate(view=>{const a=__m78Test;a.state.currentView=view==='reserves'?'project':'reunion';a.state.activeProjectId='p1';a.state.reportConfig.includePhotos=true;a.render();},view);
      await page.locator('#openReportConfigBtn').click();
      const pending=page.waitForEvent('download');await page.locator('#exportPdfReportBtn').click();const download=await pending;
      const filename=path.join(output,view+'.pdf');await download.saveAs(filename);const pdf=await dependency('pdf-lib').PDFDocument.load(fs.readFileSync(filename));
      assert.ok(pdf.getPageCount()>=2);assert.ok(fs.statSync(filename).size>10000);await page.locator('#reportConfigModal').waitFor({state:'hidden'});
      assert.equal(await page.locator('#exportPdfReportBtn').isDisabled(),false);
    }
  });
  await check('Gestes tactiles : zoom ancré, bornes, deux doigts vers un doigt, annulation, sans réserve parasite',async()=>{
    await page.evaluate(()=>{const a=__m78Test;a.state.currentView='project';a.state.activeProjectId='p1';a.state.zoom=1;a.state.pan={x:0,y:0};a.render();});
    await page.locator('#activeCanvas').scrollIntoViewIfNeeded();
    assert.deepEqual(await page.locator('.pin-marker').allTextContents(),['42','7']);
    const original=await page.evaluate(()=>JSON.stringify(__m78Test.state.projects[0].lots[0].pins));
    const session=await context.newCDPSession(page), box=await page.locator('#activeCanvas').boundingBox(), x=box.x+box.width/2, y=box.y+box.height/2;
    const points=d=>[{x:x-d,y,id:1},{x:x+d,y,id:2}];
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(30)});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(60)});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal(await page.evaluate(()=>__m78Test.state.zoom),2);
    assert.ok(await page.evaluate(()=>Math.abs(__m78Test.state.pan.x)<1 && Math.abs(__m78Test.state.pan.y)<1));
    await session.detach();
    const transform=await page.evaluate(()=>{const a=__m78Test,c=document.getElementById('activeCanvas'),r=c.getBoundingClientRect();
      const send=(target,type,id,x,y)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y}));
      const x=r.left+r.width/2,y=r.top+r.height/2;a.state.pan={x:0,y:0};
      send(c,'pointerdown',11,x-20,y);send(c,'pointerdown',12,x+20,y);send(window,'pointermove',12,x+180,y);
      send(window,'pointerup',12,x+180,y);send(window,'pointermove',11,x+10,y+25);send(window,'pointerup',11,x+10,y+25);
      const value={zoom:a.state.zoom,pan:{...a.state.pan}};c.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:x,clientY:y}));
      send(c,'pointerdown',13,x,y);window.dispatchEvent(new Event('blur'));send(window,'pointermove',13,x+100,y+100);
      return {value,after:{...a.state.pan}};});
    assert.equal(transform.value.zoom,5); assert.deepEqual(transform.value.pan,transform.after);
    assert.equal(await page.evaluate(()=>JSON.stringify(__m78Test.state.projects[0].lots[0].pins)),original);
    assert.equal(await page.locator('#pinInputTitle').isVisible(),false);
    await page.locator('#zoomResetBtn').click(); assert.equal(await page.evaluate(()=>__m78Test.state.zoom),1); assert.deepEqual(await page.evaluate(()=>__m78Test.state.pan),{x:0,y:0});
    const pinMode=await page.evaluate(()=>{const a=__m78Test,c=document.getElementById('activeCanvas'),r=c.getBoundingClientRect();a.state.activeTool='pin';
      const send=(target,type,id,x,y)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y}));
      const x=r.left+r.width/2,y=r.top+r.height/2;
      send(c,'pointerdown',21,x,y);send(window,'pointermove',21,x+70,y+35);send(window,'pointerup',21,x+70,y+35);c.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:x+70,clientY:y+35}));
      const count=a.state.projects[0].lots[0].pins.length,pan={...a.state.pan};
      send(c,'pointerdown',22,x-100,y);send(c,'pointerdown',23,x+100,y);send(window,'pointermove',23,x-99,y);send(window,'pointercancel',22,x-100,y);send(window,'pointerup',23,x-99,y);
      a.state.activeTool='select';return {count,pan,zoom:a.state.zoom};});
    assert.equal(pinMode.count,2);assert.deepEqual(pinMode.pan,{x:0,y:0});assert.equal(pinMode.zoom,0.3);
    await page.locator('#zoomResetBtn').click();
    await page.locator('.pin-marker').first().tap(); assert.equal(await page.locator('#modalPinBadge').textContent(),'42');
  });
  await check('Aucune exception de page',async()=>assert.deepEqual(errors,[]));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors,pdfMethod:'Application buttons with html2pdf 0.10.1; additional Edge print of HTML',wordVersion:'docx 8.5.0'},null,2));
  if(browser)await browser.close();server.close();
});
