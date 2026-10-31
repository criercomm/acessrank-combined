/* Basic opt-in analytics. No Google script, cookies or pings before consent. */
(() => {
  'use strict';
  const script = document.currentScript;
  const id = script?.dataset.measurementId;
  const allowed = (script?.dataset.pages || '').split('|');
  const path = location.pathname.replace(/\/$/, '') || '/';
  if (!/^G-[A-Z0-9]+$/.test(id || '') || !allowed.includes(path)) return;
  const key = 'accessrank.analytics-consent.v1';
  const disabled = 'ga-disable-' + id;
  const privacyUrl = script.dataset.privacy;
  let state = null, loaded = false;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.expires > Date.now()) state = saved.choice; } catch {}
  window[disabled] = state !== 'accepted';
  function save(choice) {
    state = choice;
    try { localStorage.setItem(key, JSON.stringify({choice, expires: Date.now() + 180 * 86400000})); } catch {}
  }
  function clearCookies() {
    const names = document.cookie.split(';').map(x => x.trim().split('=')[0]).filter(x => /^_ga(?:_|$)/.test(x));
    const host = location.hostname;
    const domains = ['', host, '.' + host];
    for (const name of names) for (const domain of domains) document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax' + (domain ? '; Domain=' + domain : '');
  }
  function start() {
    if (loaded || state !== 'accepted' || document.documentElement.classList.contains('gate-locked')) return;
    loaded = true;
    window[disabled] = false;
    window.dataLayer = window.dataLayer || [];
    const gtag = function () { window.dataLayer.push(arguments); };
    window.gtag = gtag;
    gtag('consent', 'default', {analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
    gtag('set', 'ads_data_redaction', true);
    gtag('set', 'url_passthrough', false);
    gtag('js', new Date());
    // Explicitly replace the raw URL and referrer: no query strings, fragments,
    // submitted form data or private page paths are sent to Analytics.
    const pageLocation = location.origin + path;
    const options = {send_page_view:false, page_location:pageLocation, page_referrer:'', page_title:document.title,
      allow_google_signals:false, allow_ad_personalization_signals:false, cookie_expires:15552000, cookie_update:false};
    gtag('config', id, options);
    gtag('event', 'page_view', {send_to:id, page_location:pageLocation, page_referrer:'', page_title:document.title});
    const tag = document.createElement('script');
    tag.async = true; tag.id = 'accessrank-google-tag';
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(tag);
  }
  function mount() {
    if (document.getElementById('analytics-choice')) return;
    const panel = document.createElement('section');
    panel.id = 'analytics-choice'; panel.className = 'analytics-choice';
    panel.setAttribute('aria-label', 'Analytics privacy choices');
    panel.innerHTML = '<p><strong>Your analytics choice</strong><br>With your permission, Google Analytics helps us understand visits to our public pages. Rejecting will not affect the site. We do not send form entries or private account pages.</p><div class="analytics-actions"><button type="button" data-choice="accepted">Accept analytics</button><button type="button" data-choice="rejected">Reject</button><a class="analytics-privacy">Privacy details</a></div>';
    panel.querySelector('a').href = privacyUrl;
    const settings = document.createElement('button');
    settings.type = 'button'; settings.className = 'analytics-settings'; settings.textContent = 'Analytics settings';
    settings.setAttribute('aria-controls',panel.id);
    settings.addEventListener('click', () => { panel.hidden = false; panel.querySelector('button').focus(); });
    panel.addEventListener('click', e => {
      const choice = e.target.closest('button[data-choice]')?.dataset.choice;
      if (!choice) return;
      if (choice === 'rejected') {
        window[disabled] = true; save(choice); clearCookies(); panel.hidden = true;
        if (loaded) { location.reload(); return; }
      } else { save(choice); panel.hidden = true; start(); }
      settings.focus();
    });
    panel.hidden = state === 'accepted' || state === 'rejected';
    document.body.append(panel, settings);
    if (state === 'rejected') clearCookies();
    start();
  }
  function ready() {
    mount();
    if (document.documentElement.classList.contains('gate-locked')) {
      const observer = new MutationObserver(() => { if (!document.documentElement.classList.contains('gate-locked')) { observer.disconnect(); start(); } });
      observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready();
  window.addEventListener('storage', e => {
    if (e.key !== key) return;
    let choice; try { choice = JSON.parse(e.newValue)?.choice; } catch {}
    if (choice !== 'accepted') { window[disabled] = true; clearCookies(); if (loaded) location.reload(); }
  });
})();
