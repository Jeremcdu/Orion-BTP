const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const clone = value => structuredClone(value);
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function disk() {
  const databases = new Map(), values = new Map();
  return {
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    indexedDB: { open(name) {
      const request = {};
      queueMicrotask(() => {
        const fresh = !databases.has(name); if (fresh) databases.set(name, new Map());
        const tables = databases.get(name);
        request.result = {
          createObjectStore: table => tables.set(table, new Map()),
          transaction(table) {
            const tx = { objectStore: () => {
              const rows = tables.get(table);
              const run = (action, key, value) => {
                const req = {};
                queueMicrotask(() => {
                  if (action === 'put') rows.set(key, clone(value));
                  if (action === 'delete') rows.delete(key);
                  req.result = action === 'get' ? clone(rows.get(key)) : key;
                  req.onsuccess?.();
                });
                return req;
              };
              return { get: key => run('get', key), put: (value, key) => run('put', key, value), delete: key => run('delete', key) };
            }, abort: () => { tx.aborted = true; tx.onabort?.(); } };
            setImmediate(() => { if (!tx.aborted) tx.oncomplete?.(); }); return tx;
          }
        };
        if (fresh) request.onupgradeneeded?.(); request.onsuccess?.();
      }); return request;
    } }
  };
}
function backend() {
  return { accounts: new Map(), files: new Map(), fail: false, collisions: 0, saves: 0 };
}
async function device(server, id = 'user-a', storage = disk(), local = []) {
  if (local.length) storage.localStorage.setItem('orion_btp_projects:' + id, JSON.stringify(local));
  const notices = [], principal = { id };
  const context = vm.createContext({ console, setTimeout, clearTimeout, queueMicrotask, Blob, URL, Map, Set, Promise,
    localStorage: storage.localStorage, indexedDB: storage.indexedDB,
    document: { body: null, documentElement: { dataset: { orionModule: 'm78' } }, addEventListener() {} },
    navigator: {}, OrionDomReady() {}, addEventListener() {},
    OrionAccountId: id, OrionSession: { modules: { m78: true } },
    OrionAuth: {
      guard: async () => { if (principal.id !== id) throw Error('La session a changé'); },
      client: {
        auth: { getUser: async () => ({ data: { user: { id: principal.id } }, error: null }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: clone(server.accounts.get(id)), error: null }) }) }) }),
        storage: { from: () => ({
          upload: async (key, blob) => {
            if (server.files.has(key)) return { error: { statusCode: '409' } };
            server.files.set(key, blob); return { error: null };
          },
          download: async key => server.files.has(key) ? { data: server.files.get(key), error: null } : { data: null, error: { message: 'Missing' } }
        }) }
      },
      rpc: async (name, args) => {
        if (server.fail) throw Error('Network interrupted');
        const row = server.accounts.get(id) || { projects: [], revision: 0 }; server.saves++;
        if (server.collisions > 0) { server.collisions--; row.revision++; server.accounts.set(id, row); return { saved: false }; }
        if (row.revision !== args.p_expected_revision) return { saved: false };
        server.accounts.set(id, { projects: clone(args.p_projects), revision: row.revision + 1 });
        return { saved: true, revision: row.revision + 1 };
      }
    }
  });
  context.window = context;
  vm.runInContext(read('assets/orion-cloud.js'), context);
  const html = read('m78/index.html'), start = html.indexOf('(() => {', html.indexOf('foundation v2'));
  vm.runInContext(html.slice(start, html.indexOf('})();', start) + 5), context);
  context.OrionUI.notify = (message, error) => notices.push({ message, error });
  await context.OrionCloud.initialize(context.OrionStore);
  const state = { projects: context.OrionStore.load() }; context.OrionStore.bind(() => state.projects);
  return { context, store: context.OrionStore, cloud: context.OrionCloud, state, storage, principal, notices };
}
const initial = () => [{ id: 'p1', name: 'Chantier A', client: 'Client', location: 'Paris', companies: [], lots: [] }];
async function change(d, changes) { Object.assign(d.state.projects[0], changes); await d.store.save(d.state.projects); await d.store.flush(); }

test('Migration locale conservant les identifiants et champs existants', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial());
  assert.deepEqual(clone(server.accounts.get('user-a').projects), initial()); assert.equal(d.cloud.ready, true);
});
test('Autre appareil sans cache et autre compte sans accès aux projets', async () => {
  const server = backend(); await device(server, 'user-a', disk(), initial());
  const otherDevice = await device(server), otherAccount = await device(server, 'user-b');
  assert.equal(otherDevice.state.projects[0].name, 'Chantier A'); assert.equal(otherAccount.state.projects.length, 0);
});
test('Deux appareils fusionnent les champs modifiés distincts', async () => {
  const server = backend(), a = await device(server, 'user-a', disk(), initial()), b = await device(server);
  await change(a, { name: 'Nom A' }); await change(b, { client: 'Client B' });
  assert.equal(server.accounts.get('user-a').projects[0].name, 'Nom A'); assert.equal(server.accounts.get('user-a').projects[0].client, 'Client B');
});
test('Deux changements sur le même champ sont refusés sans écrasement', async () => {
  const server = backend(), a = await device(server, 'user-a', disk(), initial()), b = await device(server);
  await change(a, { name: 'Nom A' }); await assert.rejects(() => change(b, { name: 'Nom B' }), /Conflit/);
  assert.equal(server.accounts.get('user-a').projects[0].name, 'Nom A'); assert.ok(b.store.fault);
});
test('Collision de révision : relecture puis sauvegarde atomique', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial()); server.collisions = 1;
  await change(d, { location: 'Lyon' }); assert.equal(server.accounts.get('user-a').projects[0].location, 'Lyon'); assert.equal(server.saves, 3);
});
test('Panne réseau : cache et journal du brouillon, reprise après rechargement', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial()); server.fail = true;
  await assert.rejects(() => change(d, { client: 'Brouillon conservé' }), /Network/);
  assert.equal(JSON.parse(d.storage.localStorage.getItem('orion_btp_projects:user-a'))[0].client, 'Brouillon conservé');
  server.fail = false; const recovered = await device(server, 'user-a', d.storage);
  assert.equal(recovered.state.projects[0].client, 'Brouillon conservé');
  assert.equal(server.accounts.get('user-a').projects[0].client, 'Brouillon conservé');
});
test('Éditions supplémentaires en file conservées derrière une sauvegarde échouée', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial()); server.fail = true;
  d.state.projects[0].name = 'Premier brouillon'; const first = d.store.save(d.state.projects); first.catch(() => {});
  d.state.projects[0].client = 'Édition suivante'; const second = d.store.save(d.state.projects); second.catch(() => {});
  await Promise.allSettled([first, second]); server.fail = false;
  const recovered = await device(server, 'user-a', d.storage);
  assert.equal(recovered.state.projects[0].name, 'Premier brouillon'); assert.equal(recovered.state.projects[0].client, 'Édition suivante');
});
test('Cache propre ancien remplacé par la dernière version serveur', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial());
  server.accounts.get('user-a').projects[0].location = 'Bordeaux'; server.accounts.get('user-a').revision++;
  const reloaded = await device(server, 'user-a', d.storage); assert.equal(reloaded.state.projects[0].location, 'Bordeaux');
});
test('Fichier original récupéré sur un autre appareil et cache local rempli', async () => {
  const server = backend(), a = await device(server, 'user-a', disk(), initial());
  await a.store.filePut('file1', new Blob(['Document de recette'], { type: 'text/plain' }));
  a.state.projects[0].documents = { files: [{ id: 'file1', name: 'Recette.txt' }], folders: [] }; await a.store.save(a.state.projects);
  const b = await device(server); assert.equal(await (await b.store.fileGet('file1')).text(), 'Document de recette');
  server.files.clear(); assert.equal(await (await b.store.fileGet('file1')).text(), 'Document de recette');
});
test('Fichier manquant : sauvegarde refusée, références serveur préservées', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial());
  d.state.projects[0].documents = { files: [{ id: 'missing', name: 'Manquant.txt' }], folders: [] };
  await assert.rejects(() => d.store.save(d.state.projects), /Pièce jointe/);
  assert.equal(server.accounts.get('user-a').projects[0].documents, undefined);
});
test('Changement de compte : sauvegarde bloquée et brouillon gardé pour son propriétaire', async () => {
  const server = backend(), d = await device(server, 'user-a', disk(), initial()); d.principal.id = 'user-b';
  await assert.rejects(() => change(d, { name: 'Brouillon du compte A' }), /session/);
  d.principal.id = 'user-a'; const recovered = await device(server, 'user-a', d.storage);
  assert.equal(recovered.state.projects[0].name, 'Brouillon du compte A'); assert.equal(server.accounts.has('user-b'), false);
});

class Target {
  constructor() { this.handlers = new Map(); this.style = {}; }
  addEventListener(type, fn) { const list = this.handlers.get(type) || []; list.push(fn); this.handlers.set(type, list); }
  emit(type, properties = {}) { const e = { type, detail: 1, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...properties }; for (const fn of this.handlers.get(type) || []) { fn(e); if (e.stopped) break; } return e; }
}
function gestures(original = false) {
  const html = original ? read('tests/fixtures/m78-canvas-before.js') : read('m78/index.html');
  const start = html.indexOf(original ? '    let isPanning = false;' : "    const activeCanvas = document.getElementById('activeCanvas');", original ? 0 : html.indexOf('// CANVAS TOOLBAR & ZOOM / PAN'));
  const end = html.indexOf('    // PLACER UN REPERE', start);
  const canvas = new Target(), win = new Target(), group = new Target(); canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 });
  const state = { zoom: 1, pan: { x: 0, y: 0 }, activeTool: 'select' };
  const c = vm.createContext({ window: win, document: { getElementById: id => id === 'activeCanvas' ? canvas : group }, state, updateCanvasTransform() {} });
  vm.runInContext(html.slice(start, end), c); return { canvas, win, state };
}
function down(d, id, x, y = 200) { d.canvas.emit('pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y }); }
function move(d, id, x, y = 200) { d.win.emit('pointermove', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y }); }
test('Défaut initial reproduit avec les événements tactiles Pointer Events', () => {
  const d = gestures(true); down(d, 1, 250); down(d, 2, 350); move(d, 1, 200); move(d, 2, 400); assert.equal(d.state.zoom, 1);
});
test('Pincement corrigé, ancrage au milieu des doigts et clic parasite supprimé', () => {
  const d = gestures(); down(d, 1, 250); down(d, 2, 350); move(d, 1, 200); move(d, 2, 400);
  assert.equal(d.state.zoom, 2); assert.equal(d.state.pan.x, 0); assert.equal(d.state.pan.y, 0);
  d.win.emit('pointerup', { pointerId: 1 }); d.win.emit('pointerup', { pointerId: 2 }); assert.equal(d.canvas.emit('click').stopped, true);
  down(d, 3, 300); d.win.emit('pointerup', { pointerId: 3 }); assert.equal(d.canvas.emit('click').stopped, undefined);
});
test('Déplacement à un doigt, bornes de zoom et reprise après annulation', () => {
  const d = gestures(); down(d, 1, 100, 100); move(d, 1, 160, 130); assert.equal(d.state.pan.x, 60); assert.equal(d.state.pan.y, 30);
  d.win.emit('pointercancel', { pointerId: 1 }); down(d, 2, 295); down(d, 3, 305); move(d, 2, 200); move(d, 3, 400); assert.equal(d.state.zoom, 5);
  const beforePan = d.state.pan.x; d.win.emit('blur'); down(d, 4, 100); move(d, 4, 130); assert.equal(d.state.pan.x, beforePan + 30);
});
test('Mode repère : pincement actif, déplacement sans ajout involontaire', () => {
  const d = gestures(); d.state.activeTool = 'pin'; down(d, 1, 250); move(d, 1, 200); assert.equal(d.state.pan.x, 0);
  d.win.emit('pointerup', { pointerId: 1 }); assert.equal(d.canvas.emit('click').stopped, true);
  down(d, 2, 250); down(d, 3, 350); move(d, 2, 200); move(d, 3, 400); assert.equal(d.state.zoom, 2);
});
function navigation(flush = async () => {}) {
  const doc = new Target(), hints = [], assigned = [], notices = [], connection = { saveData: false };
  doc.head = { append: node => hints.push(node) }; doc.createElement = () => ({});
  const context = { URL, document: doc, navigator: { connection }, location: { href: 'https://example.invalid/Orion-BTP/m78/index.html', origin: 'https://example.invalid', pathname: '/Orion-BTP/m78/index.html', assign: href => assigned.push(href) }, OrionAuth: { root: 'https://example.invalid/Orion-BTP/' }, OrionStore: { flush }, OrionUI: { notify: (...args) => notices.push(args) } };
  context.window = context; vm.runInNewContext(read('assets/orion-navigation.js'), context);
  const link = { href: 'https://example.invalid/Orion-BTP/index.html', closest() { return this; }, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } };
  const click = properties => { const e = { target: link, button: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...properties }; return { event: e, done: doc.handlers.get('click')[0](e) }; };
  return { doc, hints, assigned, notices, connection, context, link, click };
}
test('Retour accueil : sauvegarde et opérations en attente terminées avant navigation', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }); const calls = [];
  const d = navigation(async () => { calls.push('save'); await pending; }); d.context.OrionBeforeNavigate = async () => { calls.push('before'); };
  const c = d.click(); assert.equal(c.event.prevented, true); assert.equal(d.assigned.length, 0); assert.equal(d.link['aria-busy'], 'true');
  release(); await c.done; assert.deepEqual(calls, ['save', 'before']); assert.deepEqual(d.assigned, [d.link.href]);
});
test('Échec de sauvegarde : maintien dans le module et nouvel essai possible', async () => {
  let fail = true; const d = navigation(async () => { if (fail) throw new Error('Réseau indisponible'); });
  await d.click().done; assert.equal(d.assigned.length, 0); assert.equal(d.link['aria-busy'], undefined); assert.match(d.notices[0][0], /brouillon/);
  fail = false; await d.click().done; assert.equal(d.assigned.length, 1);
});
test('Préchargement dédupliqué et respect de l’économie de données et des clics modifiés', async () => {
  const d = navigation(); d.connection.saveData = true; d.doc.emit('pointerover', { target: d.link }); assert.equal(d.hints.length, 0);
  d.connection.saveData = false; d.doc.emit('focusin', { target: d.link }); d.doc.emit('pointerover', { target: d.link }); assert.equal(d.hints.length, 1);
  const c = d.click({ ctrlKey: true }); await c.done; assert.equal(c.event.prevented, undefined); assert.equal(d.assigned.length, 0);
  d.link.href = 'https://external.invalid/'; const external = d.click(); await external.done; assert.equal(external.event.prevented, undefined);
});
test('404 : liens accueil et compte corrects depuis une URL inconnue imbriquée', () => {
  const html = read('404.html'), scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const pathname of ['/Orion-BTP/m78/page-inconnue', '/page-inconnue']) {
    const homes = [{}, {}], account = {}, base = pathname.startsWith('/Orion-BTP/') ? '/Orion-BTP/' : '/';
    vm.runInNewContext(scripts.at(-1)[1], { location: { pathname }, document: { querySelectorAll: () => homes, getElementById: () => account } });
    assert.equal(homes[0].href, base); assert.equal(homes[1].href, base); assert.equal(account.href, base + 'compte.html');
  }
});
test('Quatre fondations identiques, scripts syntaxiquement valides, liens et 404 présents', () => {
  const snippets = ['index.html', 'm42/index.html', 'm43/index.html', 'm78/index.html'].map(filename => {
    const html = read(filename), start = html.indexOf('(() => {', html.indexOf('foundation v2')); const text = html.slice(start, html.indexOf('})();', start) + 5);
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) new vm.Script(match[1]);
    return text;
  }); assert.equal(new Set(snippets).size, 1);
  assert.match(read('404.html'), /Page introuvable/); assert.doesNotMatch(read('assets/orion-auth.js'), /position:fixed;bottom:80px/);
});

(async () => {
  const results = [];
  for (const { name, fn } of tests) {
    try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
    catch (e) { results.push({ name, passed: false, error: e.stack }); console.error('FAIL', name, e.stack); process.exitCode = 1; }
  }
  const folder = path.resolve(root, '../qa-output'); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'core-results.json'), JSON.stringify({ results }, null, 2));
  console.log(results.filter(r => r.passed).length + '/' + results.length + ' tests passed');
})();
