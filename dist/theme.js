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
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  // The colour mobile browsers paint their own toolbar with.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && theme === 'light') meta.setAttribute('content', '#FFFFFF');
}());
