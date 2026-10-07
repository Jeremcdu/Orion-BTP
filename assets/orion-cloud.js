(() => {
  'use strict';
  const BUCKET = 'orion-project-files';
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let store, userId, key, enabled = false, ready = false, projects = [], initialLocal = [];
  let journalDb, queue = Promise.resolve();
  const uploaded = new Set();

  async function journal(action, value) {
    if (!journalDb) journalDb = new Promise((resolve, reject) => {
      const request = indexedDB.open('orion_cloud_recovery', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { journalDb = null; reject(request.error); };
    });
    const db = await journalDb;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite');
      const table = tx.objectStore('drafts');
      const request = action === 'get' ? table.get(userId) : action === 'put' ? table.put(value, userId) : table.delete(userId);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error('La sauvegarde de secours est indisponible.'));
    });
  }

  async function identity() {
    const { data, error } = await OrionAuth.client.auth.getUser();
    if (error || data.user?.id !== userId) throw Error('La session a changé. Rechargez la page.');
    if (document.documentElement.dataset.orionModule) await OrionAuth.guard();
  }

  async function readRemote() {
    await identity();
    const { data, error } = await OrionAuth.client.from('orion_project_state')
      .select('projects,revision').eq('user_id', userId).maybeSingle();
    if (error) throw Error('Chargement des projets impossible. Vérifiez votre connexion puis réessayez.');
    return data || { projects: [], revision: 0 };
  }

  function cache(value) {
    projects = clone(value);
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { OrionUI.notify('Projets enregistrés sur votre compte. Le cache de cet appareil est plein.', true); }
  }

  const filePath = id => {
    if (typeof id !== 'string' || !/^[a-z\d_.-]{1,160}$/i.test(id) || id === '.' || id === '..') throw Error('Identifiant de fichier invalide.');
    return userId + '/' + id;
  };
  async function upload(id, blob) {
    if (!enabled || uploaded.has(id)) return;
    await identity();
    if (blob.size > 50 * 1024 * 1024) throw Error('Une pièce jointe dépasse la limite de 50 Mo.');
    const { error } = await OrionAuth.client.storage.from(BUCKET).upload(filePath(id), blob, {
      upsert: false, contentType: blob.type || 'application/octet-stream'
    });
    // File identifiers are immutable. A previous interrupted upload may already exist.
    if (error && !['409', 'Duplicate'].includes(String(error.statusCode || error.code))) {
      throw Error('Envoi de la pièce jointe impossible. Vérifiez votre connexion puis réessayez.');
    }
    uploaded.add(id);
  }
  async function download(id) {
    if (!enabled) return undefined;
    await identity();
    const { data, error } = await OrionAuth.client.storage.from(BUCKET).download(filePath(id));
    if (error) throw Error('Pièce jointe indisponible sur votre compte. Vérifiez votre connexion.');
    uploaded.add(id);
    return data;
  }
  async function syncFiles(value) {
    const ids = new Set(value.flatMap(p => store.attachments(p).map(f => f.storageId || f.id)).filter(Boolean));
    for (const id of ids) {
      if (uploaded.has(id)) continue;
      const blob = await store.fileGet(id);
      if (!blob) throw Error('Pièce jointe manquante : exportez votre brouillon avant de recharger.');
      await upload(id, blob);
    }
  }

  async function commitNow(base, draft, merge, validate) {
    // Keep the existing local data format and a durable pending draft before any request.
    await journal('put', { base: clone(base), draft: clone(draft) });
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch {}
    await identity();
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await readRemote();
      const merged = validate(merge(base, draft, validate(store.normalizeLegacy(clone(remote.projects)))));
      await syncFiles(merged);
      const result = await OrionAuth.rpc('orion_save_projects', {
        p_expected_revision: remote.revision, p_projects: merged
      });
      if (!result.saved) continue;
      cache(merged);
      await journal('put', { base: clone(merged), draft: null, revision: result.revision });
      return clone(merged);
    }
    throw Error('Les projets ont changé pendant l’enregistrement. Exportez votre brouillon puis rechargez.');
  }
  function commit(base, draft, merge, validate) {
    const job = queue.then(() => commitNow(base, draft, merge, validate));
    queue = job.catch(() => {});
    return job;
  }
  async function keepDraft(draft) {
    if (!enabled) return;
    const pending = await journal('get');
    if (!pending?.draft) return;
    // Preserve later edits queued behind a failed save, without discarding pending attachments.
    try { pending.draft = store.validate(store.merge(pending.base, clone(draft), pending.draft)); }
    catch { return; }
    await journal('put', pending);
    try { localStorage.setItem(key, JSON.stringify(pending.draft)); } catch {}
  }
  async function exportDraft() {
    const pending = await journal('get');
    const value = pending?.draft || (ready ? store.draft() : initialLocal);
    // Project data can be exported during a network failure; complete exports use OrionStore.backup.
    store.download(new Blob([JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), projects: value }, null, 2)], { type: 'application/json' }), 'Orion-BTP-brouillon.json');
  }
  async function initialize(projectStore) {
    store = projectStore;
    userId = window.OrionAccountId;
    enabled = !!(userId && OrionAuth.client && Object.values(window.OrionSession?.modules || {}).some(Boolean));
    if (!enabled) return;
    key = 'orion_btp_projects:' + userId;
    const local = store.latest();
    initialLocal = clone(local);
    const pending = await journal('get');
    const remote = await readRemote();
    const serverProjects = store.validate(store.normalizeLegacy(clone(remote.projects)));
    const desired = pending?.draft
      ? store.validate(store.merge(pending.base, store.validate(store.normalizeLegacy(pending.draft)), serverProjects))
      : pending ? serverProjects : local.length ? store.validate(store.merge([], local, serverProjects)) : serverProjects;
    cache(serverProjects);
    ready = true;
    if (!same(desired, serverProjects)) await commit(serverProjects, desired, store.merge, store.validate);
    else await journal('put', { base: clone(serverProjects), draft: null, revision: remote.revision });
  }
  window.OrionCloud = {
    initialize, commit, keepDraft, exportDraft, upload, download,
    get enabled() { return enabled; }, get ready() { return ready; },
    get projects() { return clone(projects); }
  };
})();
