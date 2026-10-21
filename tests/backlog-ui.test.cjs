/* Local backlog regression checks. All account, project and file requests use
 * this in-memory backend. No real Supabase account or data is accessed.
 * ORION_QA_ONLY=m42|layout|perf; ORION_BROWSER_EXECUTABLE overrides system Edge.
 * PDF/Word checks capture the document passed to their rendering library;
 * optional ORION_QA_VENDOR also runs real exports with html2pdf.bundle.min.js
 * and docx-8.5.0.umd.js from that folder. Visual document QA remains separate.
 * ORION_PERF_VARIANTS=baseline,current selects the performance comparison. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const baselineRoot = path.resolve(root, '../archive-2026-10-08/Orion-BTP');
const performanceMode = process.env.ORION_QA_ONLY === 'perf';
const output = path.resolve(root, '../qa-output/backlog-ui');
fs.mkdirSync(output, { recursive: true });
const user = '11111111-1111-4111-8111-111111111111';
const clone = value => JSON.parse(JSON.stringify(value));
const originalItems = Array.from({ length: 6 }, (_, i) => ({ id: 'item-' + i, lot: 'Lot ' + (i + 1), designation: 'Prestation ' + (i + 1), unit: 'm²', qty: i + 1, unitPrice: 11.11 * (i + 1) }));
const originalPlanning = [{ id: 'phase-manual', phase: 'Planning ajusté', startWeek: 7, durationWeeks: 3 }];
const project = () => ({ id: 'qa-project', name: 'Chantier de recette', client: 'Client fictif', location: 'Paris', surfaceTotal: 120, status: 'En cours', companies: [], lots: [], estimatif: { tvaRate: '20', workType: 'Rénovation globale', qualityLevel: 'Standard', documents: [], items: clone(originalItems) }, planning: clone(originalPlanning) });
let account = { projects: [project()], revision: 0 }, delaySaves = 0, failSaves = false;
const files = new Map(), results = [], errors = [], layout = [];
const sdk = `window.supabase={createClient(){
 const call=async(name,options={})=>{const r=await fetch('/__qa/'+name,{...options,headers:{...options.headers,'X-Test-User':${JSON.stringify(user)}}});const data=await r.json();return r.ok?{data,error:null}:{data:null,error:data};};
 return {auth:{getSession:async()=>({data:{session:{user:{id:${JSON.stringify(user)}}}},error:null}),getUser:async()=>({data:{user:{id:${JSON.stringify(user)}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
 rpc:(name,args={})=>call('rpc/'+name,{method:'POST',body:JSON.stringify(args)}),from:()=>({select:()=>({eq:()=>({maybeSingle:()=>call('projects')})})}),
 storage:{from:()=>({upload:async(id,blob)=>{const r=await fetch('/__qa/files/'+id,{method:'POST',headers:{'X-Test-User':${JSON.stringify(user)},'X-Blob-Type':blob.type},body:blob});return r.ok?{error:null}:{error:await r.json()};},download:async id=>{const r=await fetch('/__qa/files/'+id,{headers:{'X-Test-User':${JSON.stringify(user)}}});return r.ok?{data:await r.blob(),error:null}:{data:null,error:await r.json()};}})}};
}};`;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (url.pathname.startsWith('/__qa/')) {
      if (request.headers['x-test-user'] !== user) return json({ message: 'Connexion requise' }, 401);
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (url.pathname.startsWith('/__qa/files/')) {
        const id = url.pathname.slice('/__qa/files/'.length);
        if (!id.startsWith(user + '/')) return json({ message: 'Interdit' }, 403);
        if (request.method === 'POST') { if (files.has(id)) return json({ statusCode: '409' }, 409); files.set(id, { bytes, type: request.headers['x-blob-type'] }); return json({}); }
        const file = files.get(id); if (!file) return json({ message: 'Fichier absent' }, 404);
        response.writeHead(200, { 'Content-Type': file.type || 'application/octet-stream' }); return response.end(file.bytes);
      }
      if (url.pathname === '/__qa/projects') return json(account);
      if (url.pathname === '/__qa/rpc/orion_my_access') return json({ user: { id: user, email: 'recette@example.invalid', full_name: 'Compte de recette', enabled: true }, is_admin: false, modules: { m42: true, m43: true, m78: true } });
      if (url.pathname === '/__qa/rpc/orion_require_module') return json({ user_id: user, allowed: true });
      if (url.pathname === '/__qa/rpc/orion_save_projects') {
        if (delaySaves) await new Promise(resolve => setTimeout(resolve, delaySaves));
        if (failSaves) return json({ message: 'Network test failure' }, 503);
        const data = JSON.parse(bytes.toString());
        if (data.p_expected_revision !== account.revision) return json({ saved: false });
        account = { projects: clone(data.p_projects), revision: account.revision + 1 };
        return json({ saved: true, revision: account.revision });
      }
      return json({ message: 'API de recette inconnue' }, 404);
    }
    if (url.pathname.endsWith('/assets/supabase.js')) { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(sdk); }
    const baseline = url.pathname.startsWith('/baseline/'), folder = baseline ? baselineRoot : root;
    let relative = decodeURIComponent(url.pathname.slice(baseline ? '/baseline/'.length : 1)); if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(folder, relative);
    if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    if (performanceMode) {
      const stat = fs.statSync(file), etag = '"' + stat.size + '-' + stat.mtimeMs + '"';
      const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600', Vary: 'Accept-Encoding' };
      if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); return response.end(); }
      let body = fs.readFileSync(file);
      if (/gzip/.test(request.headers['accept-encoding'] || '') && /text|javascript/.test(type)) { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
      headers['Content-Length'] = body.length; response.writeHead(200, headers); return response.end(body);
    }
    response.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(response);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
let browser, base;
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { process.exitCode = 1; results.push({ name, passed: false, error: error.stack }); console.error('FAIL', name, error.message); throw error; }
}
async function device(width = 1280, theme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });
  // Playwright routing disables the HTTP cache, so performance uses CDP to
  // block external HTTPS instead; all actual app requests use local HTTP.
  if (!performanceMode) await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(theme => { localStorage.setItem('theme', theme); }, theme);
  const page = await context.newPage(); page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.dismiss() : dialog.accept());
  page.setDefaultTimeout(10000);
  return { context, page };
}
async function visit(page, module = 'm42') {
  await page.goto(base + '/' + module + '/index.html');
  await page.waitForFunction(() => window.OrionStore && !document.documentElement.classList.contains('orion-booting') && !document.documentElement.classList.contains('orion-locked'));
  await page.locator('#projectsGrid > div.cursor-pointer').first().click();
}
async function estimate(page) { await visit(page); await page.locator('#selectModuleM42').click(); await page.locator('#m42TableBody tr').first().waitFor(); }
async function flush(page) { await page.evaluate(() => OrionStore.flush()); }
async function order(page) { return page.locator('#m42TableBody tr').evaluateAll(rows => rows.map(row => row.children[2].textContent.trim())); }
async function archived(page, kind) { return page.evaluate(async kind => { const f = OrionStore.latest()[0].documents.files.find(f => f.autoArchiveKind === kind); return { metadata: f, text: await (await OrionStore.fileGet(f.storageId || f.id)).text() }; }, kind); }
async function downloadText(page, trigger) { const download = page.waitForEvent('download'); await trigger(); const d = await download; return fs.readFileSync(await d.path(), 'utf8'); }
function assertOrder(text, expected) { let previous = -1; for (const value of expected) { const index = text.indexOf(value); assert.ok(index > previous, 'Ordre incorrect pour ' + value); previous = index; } }
async function m42() {
  const { page, context } = await device();
  const vendor = process.env.ORION_QA_VENDOR;
  if (vendor) {
    await context.route('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js', route => route.fulfill({ path: path.join(vendor, 'html2pdf.bundle.min.js'), contentType: 'text/javascript' }));
    await context.route('https://unpkg.com/docx@8.5.0/build/index.umd.js', route => route.fulfill({ path: path.join(vendor, 'docx-8.5.0.umd.js'), contentType: 'text/javascript' }));
  }
  try {
    await estimate(page);
    const originalTotals = await page.locator('#kpiTotalHt').textContent();
    await check('M42 : six lignes, boutons limites et déplacement au clavier', async () => {
      assert.equal(await page.locator('#m42TableBody tr').count(), 6);
      assert.equal(await page.locator('tr[data-item-index="0"] [data-move="-1"]').isDisabled(), true);
      assert.equal(await page.locator('tr[data-item-index="5"] [data-move="1"]').isDisabled(), true);
      await page.locator('tr[data-item-index="0"] [data-move="1"]').focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await order(page), ['Prestation 2', 'Prestation 1', 'Prestation 3', 'Prestation 4', 'Prestation 5', 'Prestation 6']);
      assert.equal(await page.locator('#kpiTotalHt').textContent(), originalTotals);
      await flush(page);
      assert.deepEqual(account.projects[0].estimatif.items.map(i => i.id), ['item-1', 'item-0', 'item-2', 'item-3', 'item-4', 'item-5']);
      assert.deepEqual(account.projects[0].planning, originalPlanning);
    });
    await check('M42 : glisser-déposer conserve lignes, montants et bon éditeur', async () => {
      const target = page.locator('tr[data-item-index="3"]');
      await page.locator('tr[data-item-index="0"] .reorder-handle').dragTo(target, { targetPosition: { x: 20, y: (await target.boundingBox()).height - 2 } });
      assert.deepEqual(await order(page), ['Prestation 1', 'Prestation 3', 'Prestation 4', 'Prestation 2', 'Prestation 5', 'Prestation 6']);
      await page.locator('tr[data-item-index="3"] [aria-label="Modifier la prestation"]').click();
      assert.equal(await page.locator('#itemInputDesignation').inputValue(), 'Prestation 2');
      await page.locator('#itemInputDesignation').fill('Prestation 2 modifiée');
      await page.locator('#estimatifItemForm button[type="submit"]').click();
      await flush(page);
      assert.equal(account.projects[0].estimatif.items[3].id, 'item-1');
      assert.equal(account.projects[0].estimatif.items[3].designation, 'Prestation 2 modifiée');
      assert.equal(new Set(account.projects[0].estimatif.items.map(i => i.id)).size, 6);
      assert.equal(await page.locator('#kpiTotalHt').textContent(), originalTotals);
    });
    const expected = ['Prestation 1', 'Prestation 3', 'Prestation 4', 'Prestation 2 modifiée', 'Prestation 5', 'Prestation 6'];
    await check('M42 : rechargement et archives estimation/planning fidèles', async () => {
      await estimate(page); assert.deepEqual(await order(page), expected);
      const estimateArchive = await archived(page, 'estimate');
      assertOrder(estimateArchive.text, expected); assert.match(estimateArchive.text, /Total TTC/);
      const planning = await archived(page, 'planning'); assert.match(planning.text, /Planning ajusté/); assert.match(planning.text, /Semaine 7/);
      assert.equal(account.projects[0].documents.files.filter(f => f.autoArchiveKind === 'estimate').length, 1);
      assert.equal(account.projects[0].documents.files.filter(f => f.autoArchiveKind === 'planning').length, 1);
    });
    await check('M42 : export CSV respecte le nouvel ordre', async () => {
      await page.locator('#openReportConfigBtn').click();
      const csv = await downloadText(page, () => page.locator('#exportExcelReportBtn').click()); assertOrder(csv, expected);
      fs.writeFileSync(path.join(output, 'm42-estimate.csv'), csv);
      await page.locator('#closeReportConfigBtn').click();
    });
    await check('M42 : données PDF/Word et archive suivent le même ordre', async () => {
      await page.evaluate(() => {
        window.__reportCapture = {};
        OrionResources.load = async () => {};
        window.html2pdf = () => { const worker = { set() { return worker; }, from(sheet) { window.__reportCapture.pdf = sheet.textContent; return worker; }, async save() {} }; return worker; };
        class Record { constructor(data) { Object.assign(this, data); } }
        window.docx = { Document: Record, Paragraph: Record, Table: Record, TableRow: Record, TableCell: Record, WidthType: { PERCENTAGE: 'percent' }, Packer: { async toBlob(doc) { window.__reportCapture.word = JSON.stringify(doc); return new Blob(['capture']); } } };
      });
      await page.locator('#openReportConfigBtn').click();
      await page.locator('#exportPdfReportBtn').click(); await page.waitForFunction(() => window.__reportCapture.pdf);
      assertOrder(await page.evaluate(() => window.__reportCapture.pdf), expected);
      await downloadText(page, () => page.locator('#exportWordReportBtn').click());
      assertOrder(await page.evaluate(() => window.__reportCapture.word), expected);
      await page.locator('#closeReportConfigBtn').click();
    });
    await check('M42 : sauvegarde JSON complète et réimport conservent ordre et fichiers', async () => {
      // Reload clears the library captures; the actual portable JSON implementation is exercised.
      await estimate(page);
      await page.locator('#backToPreviousBtn').click(); await page.locator('#backToPreviousBtn').click();
      const json = await downloadText(page, () => page.locator('#exportProjectsBtn').click());
      const backup = JSON.parse(json); assert.deepEqual(backup.projects[0].estimatif.items.map(i => i.designation), expected);
      assert.equal(backup.projects[0].documents.files.filter(f => f.backupData?.startsWith('data:text/html')).length, 2);
      await page.locator('#importProjectsInput').setInputFiles({ name: 'recette.json', mimeType: 'application/json', buffer: Buffer.from(json) });
      await page.waitForFunction(() => OrionStore.latest().length === 2); await flush(page);
      assert.equal(account.projects.length, 2); assert.deepEqual(account.projects[1].estimatif.items.map(i => i.designation), expected);
      const latest = await page.evaluate(() => OrionStore.latest()); assert.notEqual(latest[1].id, latest[0].id);
      fs.writeFileSync(path.join(output, 'm42-portable-backup.json'), json);
    });
    if (vendor) await check('M42 : vrais fichiers PDF et Word générés avec les bibliothèques livrées', async () => {
      await estimate(page); await page.locator('#openReportConfigBtn').click();
      for (const [button, extension, signature] of [['#exportPdfReportBtn', 'pdf', '%PDF'], ['#exportWordReportBtn', 'docx', 'PK']]) {
        const pending = page.waitForEvent('download', { timeout: 30000 }); await page.locator(button).click(); const download = await pending;
        const filename = path.join(output, 'm42-estimate.' + extension); await download.saveAs(filename);
        assert.ok(fs.readFileSync(filename).subarray(0, 4).toString().startsWith(signature));
      }
      await page.locator('#closeReportConfigBtn').click();
    });
    await check('M42 : modifications rapides, archives uniques et navigation attendent les écritures', async () => {
      await estimate(page); delaySaves = 80;
      await page.locator('tr[data-item-index="0"] [data-move="1"]').click();
      await page.locator('tr[data-item-index="1"] [data-move="1"]').click();
      const expected = await order(page);
      await page.locator('#navLogoBtn').click(); await page.waitForURL(base + '/index.html'); delaySaves = 0;
      assert.deepEqual(account.projects[0].estimatif.items.map(i => i.designation), expected);
      const file = account.projects[0].documents.files.find(f => f.autoArchiveKind === 'estimate');
      assertOrder(files.get(user + '/' + file.storageId).bytes.toString(), expected);
      assert.equal(account.projects[0].documents.files.filter(f => f.autoArchiveKind === 'estimate').length, 1);
    });
    await check('M42 : boutons tactiles à 390 px, ordre et focus conservés', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await estimate(page);
      const before = await order(page);
      await page.locator('tr[data-item-index="0"] [data-move="1"]').tap();
      assert.deepEqual(await order(page), [before[1], before[0], ...before.slice(2)]);
      assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.itemIndex), '1');
      await page.locator('tr[data-item-index="1"] [data-move="-1"]').tap(); await flush(page);
      assert.deepEqual(await order(page), before);
    });
    await check('M42 : échec de sauvegarde bloque la navigation et conserve le brouillon', async () => {
      await estimate(page); failSaves = true;
      const savedOrder = account.projects[0].estimatif.items.map(i => i.designation);
      const archiveId = account.projects[0].documents.files.find(f => f.autoArchiveKind === 'estimate').storageId;
      await page.locator('tr[data-item-index="0"] [data-move="1"]').click();
      await page.waitForFunction(() => !!OrionStore.fault);
      const pendingOrder = await order(page), before = page.url();
      await page.locator('#navLogoBtn').click(); assert.equal(page.url(), before);
      assert.deepEqual(await page.evaluate(() => OrionStore.draft()[0].estimatif.items.map(i => i.designation)), pendingOrder);
      assert.deepEqual(account.projects[0].estimatif.items.map(i => i.designation), savedOrder);
      assert.equal(account.projects[0].documents.files.find(f => f.autoArchiveKind === 'estimate').storageId, archiveId);
      failSaves = false;
    });
  } finally { delaySaves = 0; failSaves = false; await context.close(); }
}
async function layouts() {
  const cases = [ ['m42', '#selectModuleM42', 'estimatif'], ['m42', '#selectModulePlanning', 'planning'], ['m43', '#selectModuleReunion', 'cctp'], ['m43', '#selectModuleReserves', 'documents'], ['m78', '#selectModuleReunion', 'reunion'], ['m78', '#selectModuleReserves', 'reserves'] ];
  const themes = (process.env.ORION_QA_THEMES || 'light,dark').split(',');
  const widths = (process.env.ORION_QA_WIDTHS || '320,375,390,768,1280').split(',').map(Number);
  for (const theme of themes) for (const width of widths) {
    const { context, page } = await device(width, theme);
    try {
      for (const [module, selector, view] of cases) await check(`Bandeau ${module}/${view} ${width}px ${theme}`, async () => {
        await visit(page, module); await page.locator(selector).click();
        const geometry = await page.locator('.orion-module-header').evaluate(header => {
          const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          const controls = [...header.querySelectorAll('a,button')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => ({ id: n.id, text: n.textContent.trim(), label: n.getAttribute('aria-label'), ...rect(n) }));
          const name = header.querySelector('#navLogoBtn > div:last-child > span:first-child');
          const logo = header.querySelector('#navLogoBtn svg'), drawing = logo?.getBBox();
          const unresolvedIcons = [...document.querySelectorAll('i[data-lucide]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => n.getAttribute('data-lucide'));
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, header: rect(header), controls, unresolvedIcons, brandDrawing: drawing && { width: drawing.width, height: drawing.height }, brand: name && { text: name.textContent, fontSize: getComputedStyle(name).fontSize, lineHeight: getComputedStyle(name).lineHeight, ...rect(name) } };
        });
        layout.push({ module, view, width, theme, ...geometry });
        await page.screenshot({ path: path.join(output, `${module}-${view}-${width}-${theme}.png`), fullPage: true });
        assert.deepEqual(geometry.unresolvedIcons, [], 'Icônes Lucide non remplacées');
        assert.ok(geometry.brandDrawing?.width > 0 && geometry.brandDrawing?.height > 0, 'Dessin du logo absent');
        assert.ok(geometry.scrollWidth <= width + 1, 'Débordement horizontal de la page');
        for (const c of geometry.controls) {
          assert.ok(c.x >= -1 && c.right <= width + 1, 'Bouton hors écran : ' + c.id); assert.ok(c.label || c.text, 'Nom accessible absent : ' + c.id);
          if (width <= 1023) assert.ok(c.width >= 44 && c.height >= 44, 'Cible tactile inférieure à 44 px : ' + c.id);
        }
        for (let i = 0; i < geometry.controls.length; i++) for (let j = i + 1; j < geometry.controls.length; j++) {
          const a = geometry.controls[i], b = geometry.controls[j];
          assert.ok(Math.min(a.right,b.right) - Math.max(a.x,b.x) < 1 || Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y) < 1, 'Chevauchement : ' + a.id + ' / ' + b.id);
        }
        if (geometry.brand) assert.ok(geometry.brand.height <= parseFloat(geometry.brand.lineHeight) + 1, 'Nom Orion BTP sur plusieurs lignes');
      }).catch(() => {});
    } finally { await context.close(); }
  }
}
async function performanceChecks() {
  const samples = [], variants = (process.env.ORION_PERF_VARIANTS || 'baseline,current').split(',');
  for (const variant of variants) for (const filename of ['index.html', 'm42/index.html', 'm43/index.html', 'm78/index.html']) {
    for (let run = 1; run <= 3; run++) {
      const { context, page } = await device(390, 'light');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
      await cdp.send('Performance.enable');
      await context.addInitScript(() => {
        window.__qaReadyAt = null; window.__qaLongTasks = [];
        let booting = false;
        new MutationObserver(() => {
          if (document.documentElement.classList.contains('orion-booting')) booting = true;
          else if (booting && window.__qaReadyAt === null) window.__qaReadyAt = performance.now();
        }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
        new PerformanceObserver(list => window.__qaLongTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
      });
      try {
        for (const cache of ['cold', 'warm']) {
          const url = base + '/' + (variant === 'baseline' ? 'baseline/' : '') + filename;
          if (cache === 'cold') await page.goto(url); else await page.reload();
          await page.waitForFunction(() => window.__qaReadyAt !== null && window.OrionStore && !document.documentElement.classList.contains('orion-locked'));
          const data = await page.evaluate(() => {
            const n = performance.getEntriesByType('navigation')[0], resources = performance.getEntriesByType('resource');
            const entries = [n, ...resources];
            return { readyMs: window.__qaReadyAt, domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd, transferredBytes: entries.reduce((s,e)=>s+e.transferSize,0), encodedBytes: entries.reduce((s,e)=>s+e.encodedBodySize,0), decodedBytes: entries.reduce((s,e)=>s+e.decodedBodySize,0), longTaskMs: window.__qaLongTasks.reduce((s,n)=>s+n,0), resources: entries.map(e=>({path:new URL(e.name).pathname,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize})) };
          });
          const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
          // CDP resets TaskDuration on each navigation, including reload.
          data.mainThreadTaskMs = (after.TaskDuration || 0) * 1000;
          samples.push({ variant, filename, run, cache, ...data });
          console.log(`PERF ${variant} ${filename} ${cache} ${run}: ${Math.round(data.readyMs)}ms ready, ${data.transferredBytes} transferred bytes`);
        }
      } finally { await context.close(); }
    }
  }
  const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary = [];
  for (const variant of variants) for (const filename of ['index.html', 'm42/index.html', 'm43/index.html', 'm78/index.html']) for (const cache of ['cold', 'warm']) {
    const rows = samples.filter(s => s.variant === variant && s.filename === filename && s.cache === cache);
    const row = { variant, filename, cache, samples: rows.length };
    for (const metric of ['readyMs','domContentLoadedMs','loadMs','transferredBytes','encodedBytes','decodedBytes','longTaskMs','mainThreadTaskMs']) row[metric] = median(rows.map(s=>s[metric]));
    summary.push(row);
  }
  const report = { measuredAt: new Date().toISOString(), conditions: { browser: 'System Edge ' + await browser.version() + ' via Playwright', viewport: '390x900', network: 'localhost, no throttling', staticCompression: 'gzip', cache: 'new isolated context for each cold run; immediate reload for warm; HTML revalidated via ETag, assets max-age=3600', dataset: 'one fictitious project, six estimate rows, one adjusted planning phase, no attachments', samples: '3 cold and 3 warm per page/variant', authentication: 'local in-memory Supabase mock', mainThreadMetric: 'CDP Performance.TaskDuration for the current navigation through page ready check', caveat: 'local synthetic results; not deployed-site/mobile-network latency or physical device measurements' }, samples, summary, errors };
  fs.writeFileSync(path.join(output, 'performance-' + variants.join('-') + '.json'), JSON.stringify(report, null, 2));
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = process.env.ORION_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath, headless: true });
  if (performanceMode) await performanceChecks();
  else {
    if (process.env.ORION_QA_ONLY !== 'layout') await m42();
    if (process.env.ORION_QA_ONLY !== 'm42') await layouts();
  }
  await check('Aucune exception JavaScript inattendue', async () => assert.deepEqual(errors, []));
})().catch(error => { process.exitCode = 1; console.error(error.stack); }).finally(async () => {
  const report = JSON.stringify({ results, errors, layout }, null, 2);
  fs.writeFileSync(path.join(output, 'results.json'), report);
  fs.writeFileSync(path.join(output, 'results-' + (process.env.ORION_QA_ONLY || 'all') + '.json'), report);
  if (browser) await browser.close(); server.close();
  console.log(results.filter(r => r.passed).length + '/' + results.length + ' tests passed');
});
