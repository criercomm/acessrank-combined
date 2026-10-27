/*
 * beta-prompt.js: a small, dismissible "apply for the beta" prompt on the home page only.
 * Shown once per visitor, after they have spent a while on the page or scrolled well down it,
 * never on arrival. Not modal: it takes no focus, covers no content, and Escape closes it.
 */
(function () {
  'use strict';
  if (location.pathname !== '/') return;
  var KEY = 'accessrank-beta-prompt';
  try { if (window.localStorage.getItem(KEY)) return; } catch (e) { /* storage blocked: still show once per page view */ }

  var shown = false;
  function remember() { try { window.localStorage.setItem(KEY, '1'); } catch (e) {} }

  function show() {
    if (shown || document.getElementById('scan-modal') && !document.getElementById('scan-modal').hidden) return;
    shown = true;
    var box = document.createElement('div');
    box.className = 'beta-prompt';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Beta applications');

    var title = document.createElement('p');
    title.className = 'beta-prompt-title';
    title.textContent = 'Accessrank is in private beta';
    var text = document.createElement('p');
    text.className = 'beta-prompt-text';
    text.textContent = 'We are taking on a small group of stores before our Q1 2027 launch. Apply to be a beta client.';
    var cta = document.createElement('a');
    cta.className = 'beta-prompt-cta';
    cta.href = '/beta';
    cta.textContent = 'Apply for the beta';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'beta-prompt-close';
    close.setAttribute('aria-label', 'Dismiss beta prompt');
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19"/></svg>';

    function dismiss() {
      remember();
      document.removeEventListener('keydown', onKey);
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    close.addEventListener('click', dismiss);
    cta.addEventListener('click', remember);
    document.addEventListener('keydown', onKey);

    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(cta);
    document.body.appendChild(box);
  }

  window.setTimeout(show, 20000);
  window.addEventListener('scroll', function onScroll() {
    var h = document.documentElement;
    if (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) > 0.5) {
      window.removeEventListener('scroll', onScroll);
      show();
    }
  }, { passive: true });
})();
