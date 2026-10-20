/* Lifecycle and real lazy-loader checks with a simulated DOM/network. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tests = [], test = (name, run) => tests.push({name,run});
function resources() {
  const scripts = [], timers = new Map(); let next = 0;
  const c = { document: { createElement: () => ({ remove() { this.removed=true; } }), head: { append: script => scripts.push(script) } }, setTimeout: fn => { const id=++next; timers.set(id,fn); return id; }, clearTimeout: id => timers.delete(id) };
  c.window=c; vm.runInNewContext(read('assets/orion-resources.js'), c);
  return {c,scripts,timers};
}
test('Aucune bibliothèque lourde chargée avant utilisation ; demandes simultanées dédupliquées', async () => {
  const d=resources(); assert.equal(d.scripts.length,0);
  const a=d.c.OrionResources.load('word'), b=d.c.OrionResources.load('word'); assert.equal(a,b); assert.equal(d.scripts.length,1);
  d.c.docx={}; d.scripts[0].onload(); await a;
  await d.c.OrionResources.load('word'); assert.equal(d.scripts.length,1);
});
test('Erreur réseau : échec signalé, ressource retirée, nouvelle tentative possible', async () => {
  const d=resources(), p=d.c.OrionResources.load('pdf');
  const rejected=assert.rejects(p,/Impossible de charger/); d.scripts[0].onerror(); await rejected;
  assert.equal(d.scripts[0].removed,true);
  const retry=d.c.OrionResources.load('pdf'); d.c.html2pdf=()=>{}; d.scripts[1].onload(); await retry;
});
test('Délai dépassé et global absent : aucune attente infinie ni réussite silencieuse', async () => {
  const d=resources(), p=d.c.OrionResources.load('plan');
  const rejected=assert.rejects(p,/expiré/); [...d.timers.values()][0](); await rejected;
  const retry=d.c.OrionResources.load('plan'), rejectedAgain=assert.rejects(retry,/indisponible/);
  d.scripts[1].onload(); await rejectedAgain;
});
test('PDF de plan : version et worker existants configurés après le chargement', async () => {
  const d=resources(), p=d.c.OrionResources.load('plan');
  assert.match(d.scripts[0].src,/3\.4\.120\/pdf.min.js$/);
  d.c.pdfjsLib={GlobalWorkerOptions:{}}; d.scripts[0].onload(); await p;
  assert.match(d.c.pdfjsLib.GlobalWorkerOptions.workerSrc,/3\.4\.120\/pdf.worker.min.js$/);
});
function loading() {
  const classes=new Set(), attrs=new Map(), frames=[], timers=new Map();let next=0, icons=0;
  const retry={hidden:true,removeAttribute(){this.hidden=false;},addEventListener(){}}, message={}, overlay={remove(){this.removed=true;}};
  const c={document:{documentElement:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)},getElementById:id=>({orionLoading:overlay,orionLoadingRetry:retry,orionLoadingMessage:message}[id]),addEventListener(){}},setTimeout:(fn,ms)=>{let id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>frames.push(fn),lucide:{createIcons(){icons++;}}};
  c.window=c;vm.runInNewContext(read('assets/orion-loading.js'),c);return {c,classes,attrs,frames,timers,retry,message,overlay,get icons(){return icons;}};
}
test('Chargement prolongé : page encore protégée et bouton Réessayer disponible', () => {
  const d=loading();assert.equal(d.classes.has('orion-booting'),true);assert.equal(d.attrs.get('aria-busy'),'true');
  [...d.timers.values()].find(t=>t.ms===12000).fn();assert.equal(d.retry.hidden,false);assert.equal(d.classes.has('orion-booting'),true);assert.match(d.message.textContent,/connexion/);
});
test('Fin du rendu : icônes avant révélation, deux frames et suppression du chargement', async () => {
  const d=loading();await d.c.OrionLoading.finish();assert.equal(d.icons,1);assert.equal(d.classes.has('orion-booting'),true);
  d.frames.shift()();assert.equal(d.classes.has('orion-booting'),true);d.frames.shift()();
  assert.equal(d.classes.has('orion-booting'),false);assert.equal(d.overlay.removed,true);assert.equal(d.attrs.has('aria-busy'),false);
  await d.c.OrionLoading.finish();assert.equal(d.frames.length,0);
});
test('Police lente : délai borné avant révélation, même sans réponse', async () => {
  const d=loading();d.c.document.fonts={ready:new Promise(()=>{})};const p=d.c.OrionLoading.finish();
  [...d.timers.values()].find(t=>t.ms===1000).fn();await p;assert.equal(d.frames.length,1);
});
test('Pages livrées : SVG statiques, chargement commun et outils lourds différés', () => {
  for(const f of ['index.html','m42/index.html','m43/index.html','m78/index.html']) {
    const html=read(f), outside=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    assert.doesNotMatch(outside,/<i\b[^>]*data-lucide=/);assert.match(outside,/<svg[^>]*data-lucide="sparkles"/);
    assert.match(html,/OrionLoading.finish\(\)/);assert.match(html,/id="orionLoading"/);
    assert.doesNotMatch(html,/<script src="https:[^"]*(?:lucide|pdf.min.js|html2pdf|docx)/);
  }
});
(async()=>{let passed=0;for(const {name,run} of tests){try{await run();passed++;console.log('PASS',name);}catch(e){process.exitCode=1;console.error('FAIL',name,e);}}console.log(passed+'/'+tests.length+' tests passed');})();
