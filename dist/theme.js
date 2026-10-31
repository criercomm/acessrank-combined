/* Accessrank — applies the saved theme before the page paints.
 *
 * Loaded from <head> WITHOUT defer, on purpose: site.js is deferred, so a
 * visitor who chose the light theme would otherwise see every page flash dark
 * first. This file is tiny and does one thing. Dark is the default; "light" is
 * only ever applied because someone picked it with the button in the nav.
 *
 * It lives in src/assets/static so it is served from /theme.js as a plain
 * same-origin file — the site's CSP allows no inline script. */
(function () {
  var theme = 'dark';
  try { if (window.localStorage.getItem('ar-theme') === 'light') theme = 'light'; } catch (e) { /* storage blocked: stay dark */ }
  var root = document.documentElement;
  // Hides the home page headline until hero-motion.js has set up its first frame. Not set under reduced motion,
  // and not on phone-width screens, where the headline simply shows (no waiting on a script on a slow connection).
  try {
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(max-width: 767px)').matches;
    if (!calm) root.classList.add('hero-fx');
  } catch (e) { /* no matchMedia: no animation */ }
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  // The colour mobile browsers paint their own toolbar with.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && theme === 'light') meta.setAttribute('content', '#FFFFFF');
}());
