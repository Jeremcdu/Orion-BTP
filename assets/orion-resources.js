/* Optional tools retain their existing versions and load only when used. */
(() => {
  'use strict';
  const libraries = {
    pdf: { src: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js', global: 'html2pdf' },
    word: { src: 'https://unpkg.com/docx@8.5.0/build/index.umd.js', global: 'docx' },
    plan: { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js', global: 'pdfjsLib' }
  };
  const pending = new Map();
  function configure(name) {
    if (name === 'plan') window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }
  function load(name) {
    const library = libraries[name];
    if (!library) return Promise.reject(new Error('Outil de document inconnu.'));
    if (window[library.global]) { configure(name); return Promise.resolve(window[library.global]); }
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); pending.delete(name); reject(error); }
        else {
          try { configure(name); resolve(window[library.global]); }
          catch (_) { script.remove(); pending.delete(name); reject(new Error('L’outil de document est indisponible. Réessayez.')); }
        }
      };
      const timer = setTimeout(() => finish(new Error('Le chargement de l’outil de document a expiré. Réessayez.')), 20000);
      script.src = library.src; script.async = true;
      script.onload = () => finish(window[library.global] ? null : new Error('L’outil de document est indisponible. Réessayez.'));
      script.onerror = () => finish(new Error('Impossible de charger l’outil de document. Vérifiez votre connexion puis réessayez.'));
      document.head.append(script);
    });
    pending.set(name, promise); return promise;
  }
  window.OrionResources = { load };
})();
