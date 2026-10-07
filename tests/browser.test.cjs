/* Local browser integration tests. Supabase transport is deliberately mocked;
 * database authorization is tested separately against Supabase in a rollback transaction. */
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright' : 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const qa = path.resolve(root, '../qa-output');
fs.mkdirSync(qa, { recursive: true });
const accounts = new Map(), files = new Map(), results = [], errors = [];
let failSaves = false, delaySaves = 0, collision = false;
const clone = value => JSON.parse(JSON.stringify(value));
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const fakeSDK = `window.supabase={createClient(){
 const call=async(path,options={})=>{const response=await fetch('/__qa/'+path,{...options,headers:{...options.headers,'X-Test-User':window.__qaUser||''}});const data=await response.json();return response.ok?{data,error:null}:{data:null,error:data};};
 return {auth:{getUser:async()=>({data:{user:window.__qaUser?{id:window.__qaUser}:null},error:null}),onAuthStateChange:()=>({}),signOut:async()=>({error:null})},
 rpc:(name,args={})=>call('rpc/'+name,{method:'POST',body:JSON.stringify(args)}),
 from:()=>({select:()=>({eq:()=>({maybeSingle:()=>call('projects')})})}),
 storage:{from:()=>({upload:async(id,blob)=>{const r=await fetch('/__qa/files/'+id,{method:'POST',headers:{'X-Test-User':window.__qaUser||'','X-Blob-Type':blob.type},body:blob});return r.ok?{error:null}:{error:await r.json()};},download:async id=>{const r=await fetch('/__qa/files/'+id,{headers:{'X-Test-User':window.__qaUser||''}});return r.ok?{data:await r.blob(),error:null}:{data:null,error:await r.json()};}})}
 };
}};`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), id = req.headers['x-test-user'];
  const json = (value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith('/__qa/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), body = bytes.length && !url.pathname.includes('/files/') ? JSON.parse(bytes) : {};
    const profile = { user: { id, full_name: 'Compte de recette', email: 'qa@example.invalid', enabled: true }, is_admin: true, modules: { m42: true, m43: true, m78: true } };
    if (url.pathname === '/__qa/rpc/orion_my_access') return id ? json(profile) : json({ message: 'Connexion requise' }, 401);
    if (url.pathname === '/__qa/rpc/orion_require_module') return id ? json({ user_id: id, allowed: true }) : json({ message: 'Connexion requise' }, 401);
    if (url.pathname === '/__qa/projects') return json(accounts.get(id) || null);
    if (url.pathname === '/__qa/rpc/orion_save_projects') {
      if (delaySaves) await new Promise(resolve => setTimeout(resolve, delaySaves));
      if (failSaves) return json({ message: 'Network test failure' }, 503);
      const row = accounts.get(id) || { projects: [], revision: 0 };
      if (collision) { collision = false; row.revision++; accounts.set(id, row); return json({ saved: false, revision: null }); }
      if (body.p_expected_revision !== row.revision) return json({ saved: false, revision: null });
      accounts.set(id, { projects: clone(body.p_projects), revision: row.revision + 1 });
      return json({ saved: true, revision: row.revision + 1 });
    }
    if (url.pathname.startsWith('/__qa/files/')) {
      const file = url.pathname.slice('/__qa/files/'.length);
      if (!file.startsWith(id + '/')) return json({ message: 'Forbidden' }, 403);
      if (req.method === 'POST') {
        if (files.has(file)) return json({ statusCode: '409' }, 409);
        files.set(file, { bytes, type: req.headers['x-blob-type'] || 'application/octet-stream' }); return json({});
      }
      if (!files.has(file)) return json({ message: 'Missing' }, 404);
      const value = files.get(file); res.writeHead(200, { 'Content-Type': value.type }); return res.end(value.bytes);
    }
    return json({ message: 'Unknown test API' }, 404);
  }
  if (url.pathname.endsWith('/assets/supabase.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end((process.env.ORION_QA_SERVE ? 'window.__qaUser='+JSON.stringify(user)+';' : '')+fakeSDK); }
  const baseline = url.pathname.startsWith('/baseline/');
  let relative = decodeURIComponent(baseline ? url.pathname.slice('/baseline/'.length) : url.pathname.slice(1));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const folder = baseline ? path.resolve(root, '../qa-baseline') : root;
  const filename = path.resolve(folder, relative);
  if (!filename.startsWith(folder + path.sep)) { res.writeHead(403); return res.end(); }
  let actual = filename, status = 200;
  if (!fs.existsSync(actual)) { actual = path.join(root, '404.html'); status = 404; }
  const type = actual.endsWith('.html') ? 'text/html' : actual.endsWith('.js') ? 'text/javascript' : actual.endsWith('.css') ? 'text/css' : 'application/octet-stream';
  res.writeHead(status, { 'Content-Type': type }); fs.createReadStream(actual).pipe(res);
});

async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.error('FAIL', name, error.message); throw error; }
}
let browser, base;
async function device(id = user, seed = true, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 950 }, hasTouch: true, isMobile: mobile, reducedMotion: 'reduce' });
  await context.addInitScript(({ id, seed }) => {
    window.__qaUser = id;
    if (!seed || localStorage.getItem('qa-seeded')) return;
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef2f6'; ctx.fillRect(0, 0, 900, 600);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3; ctx.strokeRect(90, 80, 720, 440);
    ctx.strokeRect(90, 80, 350, 210); ctx.strokeRect(440, 80, 370, 210);
    const project = { id: 'p1', name: 'Chantier de recette', client: 'Client recette', location: 'Paris', status: 'En cours', activeLotId: 'lot1', companies: [], lots: [{ id: 'lot1', name: 'RDC', planImage: canvas.toDataURL('image/png'), pins: [{ id: 'pin1', title: 'Réserve de recette', x: 50, y: 50, progress: 0, photos: [], companies: [] }] }] };
    localStorage.setItem('orion_btp_projects:' + id, JSON.stringify([project])); localStorage.setItem('qa-seeded', '1');
  }, { id, seed });
  const page = await context.newPage(); page.on('pageerror', e => errors.push({ url: page.url(), message: e.message }));
  page.on('dialog', dialog => dialog.accept());
  return { context, page };
}
async function visit(page, filename) {
  await page.goto(base + '/' + filename);
  await page.waitForFunction(() => !!window.OrionStore && !document.documentElement.classList.contains('orion-locked'));
  await page.evaluate(() => window.OrionReady);
}
async function canvas(page, baseline = false) {
  await visit(page, (baseline ? 'baseline/' : '') + 'm78/index.html');
  await page.locator('#projectsGrid > div').first().click();
  await page.locator('#selectModuleReserves').click();
  await page.locator('#activeCanvas').scrollIntoViewIfNeeded();
  await page.locator('#planImageView').waitFor({ state: 'visible' });
}
async function pinch(page, ratio = 2) {
  const rect = await page.locator('#activeCanvas').boundingBox();
  const x = rect.x + rect.width / 2, y = Math.max(150, rect.y + rect.height / 2);
  const session = await page.context().newCDPSession(page);
  const points = distance => [{ x: x - distance, y, id: 1 }, { x: x + distance, y, id: 2 }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(35) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(35 * ratio) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(50); await session.detach();
  return page.locator('#canvasTransformGroup').evaluate(el => el.style.transform);
}
async function save(page, change) {
  return page.evaluate(async change => {
    const value = OrionStore.load(); Object.assign(value[0], change); await OrionStore.save(value); await OrionStore.flush(); return OrionStore.latest();
  }, change);
}

(async () => {
  await new Promise(resolve => server.listen(Number(process.env.ORION_QA_PORT || 0), '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  if (process.env.ORION_QA_SERVE) { console.log('Local QA preview: ' + base); await new Promise(() => {}); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const old = await device(user, true, true);
  await check('Défaut initial reproduit : le pincement M78 ne modifie pas le zoom', async () => {
    await canvas(old.page, true); const before = await old.page.locator('#canvasTransformGroup').evaluate(el => el.style.transform);
    assert.equal(await pinch(old.page), before);
  }); await old.context.close();
  const a = await device(user, true, true);
  await check('Migration des projets locaux du compte vers le serveur', async () => { await canvas(a.page); assert.equal(accounts.get(user).projects[0].id, 'p1'); });
  await check('Pincement tactile natif : zoom et absence de réserve parasite', async () => {
    const transform = await pinch(a.page); assert.match(transform, /scale\(2\)/);
    assert.equal(await a.page.locator('.pin-marker').count(), 1);
    assert.equal(await a.page.locator('#pinInputTitle').isVisible(), false);
  });
  await check('Sélection tactile des réserves après un pincement', async () => {
    await a.page.locator('.pin-marker').tap(); assert.equal(await a.page.locator('#pinInputTitle').inputValue(), 'Réserve de recette');
    await a.page.keyboard.press('Escape');
  });
  await check('Déplacement tactile et limites de zoom', async () => {
    await a.page.locator('#zoomResetBtn').click();
    await a.page.locator('#activeCanvas').evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.left + 35, y = r.top + 80;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10, pointerType: 'touch', clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 10, pointerType: 'touch', clientX: x + 60, clientY: y + 30 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 10, pointerType: 'touch' }));
    });
    assert.match(await a.page.locator('#canvasTransformGroup').evaluate(el => el.style.transform), /translate\(60px, 30px\)/);
    assert.match(await pinch(a.page, 8), /scale\(5\)/);
  });
  await check('Accès compte/admin dans le menu, bouton flottant supprimé', async () => {
    assert.equal(await a.page.locator('#orionAccountLink').count(), 0);
    await a.page.locator('#userMenuBtn').click();
    assert.equal(await a.page.locator('#orionMenuAccountLink').isVisible(), true);
    assert.equal(await a.page.locator('#orionMenuAdminLink').isVisible(), true);
    await a.page.locator('#userMenuBtn').click();
  });
  await check('Retour à l’accueil après sauvegarde en cours', async () => {
    delaySaves = 120;
    await a.page.evaluate(() => { const value = OrionStore.load(); value[0].name = 'Projet sauvegardé avant retour'; OrionStore.save(value).catch(() => {}); });
    await a.page.locator('#navLogoBtn').click(); await a.page.waitForURL(base + '/index.html');
    assert.equal(accounts.get(user).projects[0].name, 'Projet sauvegardé avant retour'); delaySaves = 0;
    await a.page.evaluate(() => OrionReady);
    await a.page.locator('#launchM78Btn').focus();
    assert.ok(await a.page.locator('link[rel="prefetch"]').count() > 0);
  });
  const b = await device(user, false);
  await check('Autre appareil sans cache : projets récupérés après connexion', async () => { await visit(b.page, 'm43/index.html'); assert.equal(await b.page.locator('#projectsGrid h3').first().textContent(), 'Projet sauvegardé avant retour'); });
  const c = await device(other, false);
  await check('Compte distinct : aucun projet du premier compte', async () => { await visit(c.page, 'm78/index.html'); assert.equal((await c.page.evaluate(() => OrionStore.load())).length, 0); });
  await check('Deux appareils : fusion de modifications distinctes', async () => {
    await visit(a.page, 'm78/index.html'); await visit(b.page, 'm43/index.html');
    const baseline = await b.page.evaluate(() => OrionStore.load());
    await save(a.page, { client: 'Client modifié sur appareil A' });
    await b.page.evaluate(async baseline => { baseline[0].location = 'Lyon'; await OrionStore.save(baseline); }, baseline);
    assert.equal(accounts.get(user).projects[0].client, 'Client modifié sur appareil A'); assert.equal(accounts.get(user).projects[0].location, 'Lyon');
  });
  await check('Concurrence pendant l’écriture : révision relue et sauvegarde rejouée', async () => { collision = true; await save(a.page, { status: 'Recette de concurrence' }); assert.equal(accounts.get(user).projects[0].status, 'Recette de concurrence'); });
  await check('Conflit sur le même champ : aucune donnée serveur écrasée', async () => {
    await visit(a.page, 'm78/index.html'); await visit(b.page, 'm43/index.html');
    const baseline = await b.page.evaluate(() => OrionStore.load()); await save(a.page, { name: 'Nom appareil A' });
    const error = await b.page.evaluate(async baseline => { baseline[0].name = 'Nom appareil B'; try { await OrionStore.save(baseline); } catch (e) { return e.message; } }, baseline);
    assert.match(error, /Conflit/); assert.equal(accounts.get(user).projects[0].name, 'Nom appareil A');
    assert.equal(await b.page.evaluate(() => !!OrionStore.fault), true);
  });
  await check('Panne réseau : brouillon conservé et navigation interrompue', async () => {
    await visit(a.page, 'm78/index.html'); failSaves = true;
    await a.page.evaluate(async () => { const value = OrionStore.load(); value[0].client = 'Brouillon hors réseau'; try { await OrionStore.save(value); } catch {} });
    const original = a.page.url(); await a.page.locator('#navLogoBtn').click(); assert.equal(a.page.url(), original);
    const cached = await a.page.evaluate(user => JSON.parse(localStorage.getItem('orion_btp_projects:' + user))[0].client, user); assert.equal(cached, 'Brouillon hors réseau');
    failSaves = false;
  });
  await check('Reconnexion : reprise automatique du brouillon sans perte', async () => { await visit(a.page, 'm78/index.html'); assert.equal(accounts.get(user).projects[0].client, 'Brouillon hors réseau'); });
  await check('Fichiers privés : original retrouvé sur un autre appareil', async () => {
    await a.page.evaluate(async () => { await OrionStore.filePut('qa-document', new Blob(['Pièce jointe de recette'], { type: 'text/plain' })); const value = OrionStore.load(); value[0].documents = { folders: [], files: [{ id: 'qa-document', name: 'Recette.txt', size: 25, type: 'text/plain' }] }; await OrionStore.save(value); });
    const fresh = await device(user, false); await visit(fresh.page, 'm43/index.html');
    assert.equal(await fresh.page.evaluate(async () => (await OrionStore.fileGet('qa-document')).text()), 'Pièce jointe de recette');
    await fresh.context.close();
  });
  await check('Cache propre ancien : la version serveur est rechargée', async () => {
    const row = accounts.get(user); row.projects[0].location = 'Bordeaux'; row.revision++;
    await visit(a.page, 'm78/index.html'); assert.equal(await a.page.evaluate(() => OrionStore.load()[0].location), 'Bordeaux');
  });
  await check('M42 : sauvegarde et archivage conservés', async () => {
    const d = await device(user, false); await visit(d.page, 'm42/index.html');
    assert.equal((await d.page.evaluate(() => OrionStore.load())).length, 1); await d.page.evaluate(() => OrionStore.flush()); await d.context.close();
  });
  await check('404 : statut HTTP, liens valides, mobile et thème sombre', async () => {
    const response = await c.page.goto(base + '/lien-inexistant/profond'); assert.equal(response.status(), 404);
    assert.equal(await c.page.locator('h1').textContent(), 'Cette page est introuvable.');
    assert.equal(await c.page.locator('[data-home]').last().getAttribute('href'), '/');
    await c.page.evaluate(() => localStorage.setItem('theme', 'dark')); await c.page.reload(); assert.equal(await c.page.locator('html').getAttribute('class'), 'dark');
    await c.page.screenshot({ path: path.join(qa, '404-dark.png'), fullPage: true });
  });
  await check('Mobile 390 px : absence de débordement horizontal', async () => {
    await visit(a.page, 'm78/index.html');
    assert.ok(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await a.page.screenshot({ path: path.join(qa, 'm78-mobile.png'), fullPage: true });
  });
  await check('Aucune exception JavaScript inattendue', async () => assert.deepEqual(errors, []));
  await a.context.close(); await b.context.close(); await c.context.close();
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(qa, 'browser-results.json'), JSON.stringify({ results, errors }, null, 2));
  if (browser) await browser.close(); server.close();
});
