/* Reveal the page after the actual initial render, including its icons. */
(() => {
  'use strict';
  const html = document.documentElement;
  html.classList.add('orion-booting'); html.setAttribute('aria-busy', 'true');
  let complete = false;
  const timer = setTimeout(() => {
    const message = document.getElementById('orionLoadingMessage');
    if (message) message.textContent = 'Le chargement prend plus de temps que prévu. Vérifiez votre connexion.';
    document.getElementById('orionLoadingRetry')?.removeAttribute('hidden');
  }, 12000);
  async function finish() {
    if (complete) return;
    complete = true; clearTimeout(timer);
    if (window.lucide) window.lucide.createIcons();
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1000))]);
    // Two frames leave layout and paint time for the final icon replacement.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      html.classList.remove('orion-booting'); html.removeAttribute('aria-busy');
      document.getElementById('orionLoading')?.remove();
    }));
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('orionLoadingRetry')?.addEventListener('click', () => location.reload());
  }, { once: true });
  window.OrionLoading = { finish };
})();
