/*
 * overlays.js: behaviour for /overlays only. Builds the kinetic headline (per-letter reveal)
 * and sends the hero store address to the free-check widget further down the page.
 * Every selector is page-specific, so it is a no-op on every other page.
 */
(function () {
  'use strict';

  var heading = document.getElementById('ov-headline');
  if (heading) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lines = Array.prototype.slice.call(heading.querySelectorAll('[data-ov-text]'));
    var STAGGER = 18, OVERLAP = 0.55, START = 300;
    var offset = 0;
    lines.forEach(function (line) {
      var text = line.getAttribute('data-ov-text') || '';
      var n = 0;
      text.split(' ').forEach(function (word) {
        var w = document.createElement('span');
        w.className = 'kw';
        word.split('').forEach(function (ch) {
          var c = document.createElement('span');
          c.className = 'kc';
          c.textContent = ch;
          c.style.animationDelay = Math.round(START + offset + n * STAGGER) + 'ms';
          n += 1;
          w.appendChild(c);
        });
        line.appendChild(w);
      });
      offset += Math.round(text.replace(/ /g, '').length * STAGGER * OVERLAP);
      if (reduce) line.textContent = text;
    });
  }

  var form = document.querySelector('[data-ov-form]');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var mine = form.querySelector('input');
      var theirs = document.getElementById('audit-url');
      var submit = document.getElementById('audit-submit');
      var card = document.getElementById('audit-card');
      if (!theirs || !submit) { window.location.href = '/#audit'; return; }
      theirs.value = mine ? mine.value.trim() : '';
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (theirs.value) submit.click(); else theirs.focus();
    });
  }
})();
