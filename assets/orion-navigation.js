(() => {
  'use strict';
  const root = OrionAuth.root;
  const paths = new Set(['index.html', 'm42/index.html', 'm43/index.html', 'm78/index.html', 'compte.html'].map(p => new URL(p, root).pathname));
  const prefetched = new Set();
  let leaving = false;
  const target = node => {
    const a = node?.closest?.('a[href]');
    if (!a || a.download || a.target && a.target !== '_self') return null;
    const url = new URL(a.href, location.href);
    return url.origin === location.origin && paths.has(url.pathname) && url.pathname !== location.pathname ? a : null;
  };
  const prefetch = event => {
    const a = target(event.target);
    if (!a || prefetched.has(a.href) || navigator.connection?.saveData) return;
    prefetched.add(a.href);
    const hint = document.createElement('link');
    hint.rel = 'prefetch'; hint.href = a.href; document.head.append(hint);
  };
  document.addEventListener('pointerover', prefetch, { passive: true });
  document.addEventListener('focusin', prefetch);
  document.addEventListener('click', async event => {
    const a = target(event.target);
    if (!a || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (leaving) return;
    leaving = true; a.setAttribute('aria-busy', 'true');
    try {
      if (window.OrionStore) await OrionStore.flush();
      if (window.OrionBeforeNavigate) await OrionBeforeNavigate();
      location.assign(a.href);
    } catch (error) {
      leaving = false; a.removeAttribute('aria-busy');
      OrionUI.notify('Retour interrompu : ' + error.message + ' Exportez votre brouillon avant de quitter.', true);
    }
  }, true);
})();
