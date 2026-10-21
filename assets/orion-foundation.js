window.OrionReady = window.OrionReady.then(async()=>{

/* Orion front-end foundation v2. Embedded identically in all four pages.
 * Authenticated projects use OrionCloud with atomic server revision checks.
 * The existing merge, validation, local cache and JSON backup format are preserved.
 * Guest pages retain their local adapter. Never put server secrets here.
 */
(() => {
  'use strict';
  const KEY = 'orion_btp_projects:'+(window.OrionAccountId||'public'), LOCK = 'orion-btp-projects-v2:'+(window.OrionAccountId||'public');
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  let baseline = [], queue = Promise.resolve(), pending = 0, fault = null, getDraft = () => baseline;
  let sequence = 0, status = 'Mode local · Sauvegardez régulièrement un export JSON.';
  let database;
  function tell(message, error = false) {
    status = message;
    if (error) showNotice(message, true);
  }
  // Transient notices replace the permanent footer; saving remains unchanged.
  function showNotice(message, error = false) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => showNotice(message, error), { once: true });
      return;
    }
    let notice = document.getElementById('orionNotice');
    if (!notice) {
      notice = document.createElement('aside'); notice.id = 'orionNotice';
      notice.style.cssText = 'position:fixed;top:80px;right:16px;z-index:180;max-width:min(420px,calc(100vw - 32px));padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px #0002;font:14px system-ui;display:flex;gap:12px;align-items:center';
      document.body.appendChild(notice);
    }
    clearTimeout(showNotice.timer);
    notice.replaceChildren(); notice.dataset.error = String(error);
    notice.style.background = error ? '#fff1f2' : '#eff6ff';
    notice.style.color = error ? '#9f1239' : '#1e3a8a';
    const text = document.createElement('span'); text.setAttribute('role', error ? 'alert' : 'status'); text.textContent = message;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Fermer la notification');
    close.style.cssText = 'font:22px system-ui;border:0;background:transparent;color:inherit;cursor:pointer';
    close.onclick = () => notice.remove(); notice.append(text, close);
    if (error && window.OrionCloud?.enabled) {
      const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Exporter le brouillon';
      backup.style.cssText = 'font:12px system-ui;white-space:nowrap;text-decoration:underline;cursor:pointer';
      backup.onclick = () => OrionCloud.exportDraft(); notice.append(backup);
    }
    if (!error) showNotice.timer = setTimeout(() => notice.remove(), 6000);
  }
  function merge(base, draft, remote, path = 'projets') {
    if (same(draft, base)) return copy(remote);
    if (same(remote, base) || same(remote, draft)) return copy(draft);
    if ((object(base) || base === undefined) && object(draft) && object(remote)) {
      const result = {};
      for (const key of new Set([...Object.keys(base || {}), ...Object.keys(draft), ...Object.keys(remote)])) {
        if (['__proto__','prototype','constructor'].includes(key)) throw Error('Champ interdit.');
        const value = merge(base?.[key], draft[key], remote[key], path + '.' + key);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    const keyed = list => Array.isArray(list) && list.every(x => object(x) && typeof x.id === 'string');
    if ((base === undefined || keyed(base)) && keyed(draft) && keyed(remote)) {
      const old = base || [], a = new Map(old.map(x=>[x.id,x])), b = new Map(draft.map(x=>[x.id,x])), c = new Map(remote.map(x=>[x.id,x]));
      const items = new Map();
      for (const id of new Set([...a.keys(), ...b.keys(), ...c.keys()])) {
        const value = merge(a.get(id), b.get(id), c.get(id), path + '[' + id + ']');
        if (value !== undefined) items.set(id,value);
      }
      const shared = old.filter(x=>b.has(x.id) && c.has(x.id)).map(x=>x.id);
      const localOrder = draft.filter(x=>shared.includes(x.id)).map(x=>x.id);
      const remoteOrder = remote.filter(x=>shared.includes(x.id)).map(x=>x.id);
      if (!same(shared,localOrder) && !same(shared,remoteOrder) && !same(localOrder,remoteOrder)) throw Error('Conflit d’ordre dans ' + path);
      const preferred = !same(shared,localOrder) ? draft : remote;
      const order = [...new Set([...preferred.map(x=>x.id), ...draft.map(x=>x.id), ...remote.map(x=>x.id)])];
      return order.filter(id=>items.has(id)).map(id=>items.get(id));
    }
    throw Error('Conflit dans ' + path + '. Une autre page a modifié la même donnée.');
  }
  // Historical backups used empty strings and localized numeric strings.
  // Normalize only known numeric fields; keep unknown values invalid instead of guessing.
  function normalizeLegacy(projects) {
    if (!Array.isArray(projects)) return projects;
    const number = (value, empty = null) => {
      if (value == null || (typeof value === 'string' && !value.trim())) return empty;
      if (typeof value !== 'string') return value;
      const text = value.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : value;
    };
    for (const p of projects) {
      if (!object(p)) continue;
      if (Object.hasOwn(p, 'surfaceTotal')) p.surfaceTotal = number(p.surfaceTotal);
      for (const item of Array.isArray(p.estimatif?.items) ? p.estimatif.items : []) {
        if (!object(item)) continue;
        item.qty = number(item.qty); item.unitPrice = number(item.unitPrice);
      }
      for (const phase of Array.isArray(p.planning) ? p.planning : []) {
        if (!object(phase)) continue;
        phase.startWeek = number(phase.startWeek); phase.durationWeeks = number(phase.durationWeeks);
      }
      for (const lot of Array.isArray(p.lots) ? p.lots : []) {
        for (const pin of Array.isArray(lot?.pins) ? lot.pins : []) {
          if (!object(pin)) continue;
          pin.x = number(pin.x); pin.y = number(pin.y);
          if (Object.hasOwn(pin,'progress')) pin.progress = number(pin.progress,0);
        }
      }
    }
    return projects;
  }
  function validate(projects) {
    if (!Array.isArray(projects) || projects.length > 2000) throw Error('La sauvegarde doit contenir une liste de projets (maximum 2 000).');
    const seen = new Set();
    for (const p of projects) {
      if (!object(p) || typeof p.id !== 'string' || !p.id || seen.has(p.id) || typeof p.name !== 'string' || !p.name.trim()) throw Error('Projet invalide ou identifiant dupliqué.');
      seen.add(p.id);
      if (p.surfaceTotal != null && (!Number.isFinite(p.surfaceTotal) || p.surfaceTotal < 0)) throw Error('Surface de projet invalide.');
      for (const field of ['companies','lots','planning']) if (p[field] !== undefined && !Array.isArray(p[field])) throw Error('Liste invalide : ' + field);
      for (const [field, arrays] of [['estimatif',['items','documents']],['documents',['files','folders']],['cctp',['sections','templates']]]) {
        if (p[field] !== undefined && !object(p[field])) throw Error('Module invalide : ' + field);
        for (const array of arrays) if (p[field]?.[array] !== undefined && !Array.isArray(p[field][array])) throw Error('Liste invalide : ' + field + '.' + array);
      }
      for (const lot of p.lots || []) {
        if (!object(lot) || typeof lot.name !== 'string' || (lot.pins !== undefined && !Array.isArray(lot.pins))) throw Error('Zone invalide.');
        for (const pin of lot.pins || []) {
          if (!object(pin) || !Number.isFinite(pin.x) || pin.x < 0 || pin.x > 100 || !Number.isFinite(pin.y) || pin.y < 0 || pin.y > 100) throw Error('Coordonnées de réserve invalides.');
          if (pin.progress !== undefined && (!Number.isFinite(Number(pin.progress)) || Number(pin.progress)<0 || Number(pin.progress)>100)) throw Error('Avancement invalide.');
          if (pin.photos !== undefined && !Array.isArray(pin.photos)) throw Error('Photos de réserve invalides.');
        }
      }
      for (const field of ['name','client','location','status']) if (p[field] !== undefined && typeof p[field] !== 'string') throw Error('Texte de projet invalide : '+field);
      for (const section of p.cctp?.sections || []) if (!object(section) || ['title','text','lot','chapter','subpart'].some(k=>section[k]!==undefined && typeof section[k]!=='string')) throw Error('Prescription invalide.');
      for (const phase of p.planning || []) if (!object(phase) || !Number.isInteger(phase.startWeek) || phase.startWeek < 1 || !Number.isInteger(phase.durationWeeks) || phase.durationWeeks < 1) throw Error('Planning invalide.');
      for (const item of p.estimatif?.items || []) if (!object(item) || !Number.isFinite(item.qty) || item.qty < 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw Error('Quantité ou prix invalide dans l’estimatif.');
    }
    function visit(value, depth = 0, key = '') {
      if (depth > 35) throw Error('Structure de sauvegarde trop profonde.');
      if (Array.isArray(value)) {
        const ids = new Set();
        for (const item of value) {
          if (item === null) throw Error('Élément vide dans une liste.');
          if (object(item) && item.id !== undefined) {
            if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw Error('Identifiant invalide ou dupliqué.');
            ids.add(item.id);
          }
          visit(item,depth+1,key);
        }
      } else if (object(value)) {
        for (const [name,child] of Object.entries(value)) {
          if (['__proto__','prototype','constructor'].includes(name)) throw Error('Champ interdit dans la sauvegarde.');
          visit(child,depth+1,name);
        }
      } else if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Nombre invalide.');
      else if (typeof value === 'string') {
        if (/^data:image\//i.test(value) && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) throw Error('Image incorporée invalide.');
        if (/^(photo|planImage|logo|logoUrl|logoData|imageData|src)$/i.test(key) && value && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) throw Error('Image non prise en charge : utilisez PNG, JPEG ou WebP.');
      }
    }
    visit(projects); return projects;
  }
  function read() { return validate(normalizeLegacy(window.OrionCloud?.ready ? OrionCloud.projects : JSON.parse(localStorage.getItem(KEY) || '[]'))); }
  // On file:// or environments without Web Locks, a readwrite IDB transaction
  // serializes the synchronous localStorage update without disabling concurrency checks.
  let localLockDb;
  async function localTransaction(work) {
    if (!window.indexedDB) throw Error('Ce navigateur bloque le stockage local. Ouvrez le site via localhost ou GitHub Pages.');
    if (!localLockDb) localLockDb = new Promise((resolve,reject) => {
      const request=indexedDB.open('orion_write_coordination',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('locks');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{localLockDb=null;reject(request.error);};
      request.onblocked=()=>reject(Error('Fermez les autres onglets Orion puis réessayez.'));
    });
    const db=await localLockDb;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('locks','readwrite');let result,error;
      const request=tx.objectStore('locks').get(LOCK);
      request.onsuccess=()=>{try{result=work();}catch(e){error=e;tx.abort();}};
      tx.oncomplete=()=>resolve(result);
      tx.onabort=tx.onerror=()=>reject(error || tx.error || Error('Écriture locale annulée.'));
    });
  }
  const adapter = {
    async commit(base, draft) {
      if (window.OrionCloud?.enabled) return OrionCloud.commit(base, draft, merge, validate);
      if(document.documentElement.dataset.orionModule) await OrionAuth.guard();
      const commit = () => {
        const result = validate(merge(base, draft, read()));
        try { localStorage.setItem(KEY,JSON.stringify(result)); }
        catch(error) {
          if(error.name==='QuotaExceededError') throw Error('Stockage du navigateur plein. Le projet contient des plans volumineux : conservez votre sauvegarde JSON et exportez le brouillon.');
          throw error;
        }
        return result;
      };
      return navigator.locks?.request ? navigator.locks.request(LOCK,commit) : localTransaction(commit);
    }
  };
  function save(projects) {
    if (fault) return Promise.reject(fault);
    let next;
    try { next = validate(normalizeLegacy(copy(projects))); } catch(e) { fault=e; tell(e.message,true); return Promise.reject(e); }
    const before = baseline; baseline = next; pending++; sequence++;
    tell(OrionCloud.enabled ? 'Enregistrement sur votre compte…' : 'Enregistrement local…');
    const job = queue.then(async () => {
      if (fault) throw fault;
      try { await adapter.commit(before,next); }
      catch (error) { try { await OrionCloud.keepDraft(getDraft()); } catch {} throw error; }
    });
    queue = job.catch(error => { fault=error; });
    job.then(() => { pending--; if (!pending && !fault) tell(OrionCloud.enabled ? 'Enregistré sur votre compte.' : 'Enregistré sur cet appareil.'); }, error => {
      pending--; tell('Non enregistré : ' + error.message + ' Exportez le brouillon avant de recharger.',true);
    });
    return job;
  }
  async function flush() { await queue; if(fault) throw fault; }
  function load() {
    try { baseline=copy(read()); } catch(error) { fault=error; baseline=[]; tell('Données locales illisibles : aucune écriture autorisée. Exportez la sauvegarde brute.',true); }
    return copy(baseline);
  }
  function download(blob,name) {
    const a=document.createElement('a'), url=URL.createObjectURL(blob);
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  async function db() {
    if (!database) database = new Promise((resolve,reject)=>{
      const request=indexedDB.open('orion_project_drive_'+(window.OrionAccountId||'public'),1);
      request.onupgradeneeded=()=>request.result.createObjectStore('files');
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>{database=null;reject(request.error);};
    });
    return database;
  }
  async function localFileGet(id) {const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function localFilePut(id,blob) {const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('files','readwrite');tx.objectStore('files').put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Écriture annulée.'));});}
  async function fileGet(id) {
    const local = await localFileGet(id);
    if (local) return local;
    const remote = await OrionCloud.download(id);
    if (remote) { try { await localFilePut(id,remote); } catch {} }
    return remote;
  }
  async function filePut(id,blob) {
    await localFilePut(id,blob);
    await OrionCloud.upload(id,blob);
  }
  const dataUrl = blob => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  function fromDataUrl(value) {
    if (typeof value !== 'string' || !/^data:[^,]*;base64,/.test(value)) throw Error('Pièce jointe invalide.');
    const [head, body]=value.split(',');return new Blob([Uint8Array.from(atob(body),x=>x.charCodeAt(0))],{type:head.slice(5).split(';')[0]});
  }
  const attachments = p => [...(p.documents?.files || []), ...(p.estimatif?.documents || []), ...(p.lots || []).map(l=>l.planSource).filter(Boolean)];
  async function backup(projects, name='orion_projets') {
    const snapshot=copy(projects);
    for (const p of snapshot) for (const f of attachments(p)) {
      if (!f.id) continue;
      const blob=await fileGet(f.storageId || f.id);
      if (!blob) throw Error('Pièce jointe manquante : ' + f.name + '. Export complet interrompu.');
      f.backupData=await dataUrl(blob);
    }
    download(new Blob([JSON.stringify({schemaVersion:2,exportedAt:new Date().toISOString(),projects:snapshot},null,2)],{type:'application/json'}),name+'.json');
  }
  async function importFile(file, current) {
    if(file.size>50*1024*1024) throw Error('Sauvegarde limitée à 50 Mo.');
    const parsed=JSON.parse(await file.text());
    if (!Array.isArray(parsed) && parsed.schemaVersion !== 2) throw Error('Version de sauvegarde non prise en charge.');
    const projects=validate(normalizeLegacy(copy(Array.isArray(parsed)?parsed:parsed.projects)));
    if(!confirm('Importer '+projects.length+' projet(s) comme copies ? Les projets actuels seront conservés.')) return null;
    for(const p of projects) {
      p.id=crypto.randomUUID(); p.name += ' (import)';
      for(const f of attachments(p)) {
        if(f.backupData) {f.id=crypto.randomUUID();delete f.storageId;await filePut(f.id,fromDataUrl(f.backupData));delete f.backupData;}
        else if(f.id && !await fileGet(f.storageId || f.id)) throw Error('Sauvegarde incomplète : pièce jointe absente ('+f.name+').');
      }
    }
    await flush();
    const result=[...current,...projects];await save(result);return result;
  }
  window.OrionStore={adapter,load,latest:read,save,flush,merge,validate,normalizeLegacy,attachments,draft:()=>copy(getDraft()),bind:fn=>{getDraft=fn;},fileGet,filePut,dataUrl,download,backup,importFile,
    get pending(){return pending;},get fault(){return fault;},get sequence(){return sequence;}};
  window.OrionUI={notify:(message,error=false)=>{status=message;showNotice(message,error);},unavailable:()=>showNotice('Fonction disponible après connexion au backend. Aucun compte créé ni message envoyé.')};
  // Only cosmetic preferences are persisted here. Authentication requires a server.
  try {if(!localStorage.getItem('theme'))localStorage.setItem('theme',localStorage.getItem('themeOrionBTP') || 'light');}catch{}
  window.addEventListener('beforeunload',e=>{if(pending || fault){e.preventDefault();e.returnValue='';}});
  window.addEventListener('storage',e=>{
    if(e.key===KEY && !fault && !pending)tell('Projet modifié dans un autre onglet · Rechargez pour afficher les nouveautés.');
    if(e.key==='theme') {document.documentElement.classList.toggle('dark',e.newValue==='dark');window.dispatchEvent(new CustomEvent('orion-theme',{detail:e.newValue}));}
  });
  OrionDomReady(()=>{
    if (fault) showNotice(status, true);
    const privacy=document.getElementById('privacyModal');
    if(privacy){const p=privacy.querySelector('.space-y-4');if(p)p.textContent='Les projets et pièces jointes sont enregistrés sur votre compte Orion BTP et accessibles depuis vos appareils après connexion. Les accès aux modules et aux données sont contrôlés sur le serveur. Ce navigateur conserve un cache et les brouillons en attente ; une révocation ne supprime pas les copies déjà téléchargées. Exportez régulièrement une sauvegarde JSON complète.';}
    // Label legacy controls and give clickable cards a keyboard equivalent.
    const decorate=()=>{
      document.querySelectorAll('[id^="selectModule"],#projectsGrid > div.cursor-pointer').forEach(el=>{if(el.dataset.orionKeyboard)return;el.dataset.orionKeyboard='true';el.tabIndex=0;el.setAttribute('role','button');el.addEventListener('keydown',e=>{if(e.target===el && ['Enter',' '].includes(e.key)){e.preventDefault();el.click();}});});
      document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim() || b.getAttribute('aria-label'))return;const icon=b.querySelector('[data-lucide]');const name=icon?.getAttribute('data-lucide') || '';const label=b.title || (/trash/.test(name)?'Supprimer':/edit|pencil/.test(name)?'Modifier':/^x$/.test(name)||/close/i.test(b.id)?'Fermer':/chevron/.test(name)?'Déplier':null);if(label)b.setAttribute('aria-label',label);});
      document.querySelectorAll('label:not([for])').forEach(l=>{const control=l.nextElementSibling;if(control?.matches('input[id],select[id],textarea[id]'))l.htmlFor=control.id;});
    };decorate();let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;decorate();});}}).observe(document.body,{childList:true,subtree:true});
    // Focus management for legacy modals (new M43 dialogs already manage focus).
    let active=null,previous=null;
    const modals=[...document.querySelectorAll('[id$="Modal"]')];
    const sync=()=>{const next=modals.filter(m=>!m.classList.contains('hidden')).at(-1);if(next===active)return;if(next){previous=document.activeElement;active=next;next.setAttribute('role','dialog');next.setAttribute('aria-modal','true');const title=next.querySelector('h2,h3');if(title){title.id ||= next.id+'Title';next.setAttribute('aria-labelledby',title.id);}queueMicrotask(()=>next.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus());}else{active=null;if(previous?.isConnected)previous.focus();}};
    modals.forEach(m=>new MutationObserver(sync).observe(m,{attributes:true,attributeFilter:['class']}));
    document.addEventListener('keydown',e=>{if(!active)return;if(e.key==='Escape'){e.preventDefault();active.classList.add('hidden');active.classList.remove('flex');sync();}if(e.key==='Tab'){const targets=[...active.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(x=>x.getClientRects().length);const first=targets[0],last=targets.at(-1);if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}}});
  });
})();


  await OrionCloud.initialize(OrionStore);
}).catch(error => { OrionAuth.blocked(error); return new Promise(() => {}); });