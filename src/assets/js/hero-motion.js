/* Accessrank — home page headline animation ("The lawsuit hidden in your website.").
 *
 * The words "lawsuit" and "hidden" start redacted. Every word rolls up into place,
 * black bars cover the two hidden words, and as the bars lift the words fade back
 * in from the page colour to their normal colour.
 *
 * Loaded only on pages marked `heroMotion` in site.json, bundled after GSAP
 * (vendor/gsap.min.js) into one file by build.mjs.
 *
 * - Colours are read from the live theme (--text, --brand, the page background),
 *   so the dark and light themes both work with no values copied here.
 * - Nothing animates under prefers-reduced-motion: the plain headline just shows.
 * - The headline is split into words only while it animates. When the timeline
 *   ends, the original markup is put back, so the finished page is exactly the
 *   static HTML in src/pages/index.html.
 * - If anything fails, the original markup is restored and the headline shows.
 */
(function () {
  'use strict';

  /* Timing, in seconds. These are the values signed off in the preview. */
  var SETTLE = 2.6;  // how long the hidden words take to fade back to their normal colour
  var HOLD = 0;      // pause between the bars starting to lift and that fade beginning
  var HIDDEN_WORDS = ['lawsuit', 'hidden'];

  var root = document.documentElement;
  var title = document.querySelector('.risk-title');
  var sub = document.querySelector('.risk-sub');
  var original = title ? title.innerHTML : '';
  var timeline = null;

  // Dark is the default theme. `hero-fx` (set in theme.js) keeps the headline hidden until
  // this script has set up the first frame, so there is no flash of the finished text.
  function show() { root.classList.remove('hero-fx'); }

  function restore() {
    if (timeline) { timeline.kill(); timeline = null; }
    if (title) {
      title.innerHTML = original;
      title.removeAttribute('aria-label');
    }
    if (sub && window.gsap) { window.gsap.set(sub, { clearProps: 'opacity,transform' }); }
    show();
  }

  function parseRgb(value) {
    var m = String(value).match(/-?\d*\.?\d+/g);
    if (!m || m.length < 3) { return null; }
    var n = m.slice(0, 3).map(Number);
    if (/^color\(/.test(value)) { n = n.map(function (v) { return v * 255; }); }
    return n;
  }

  function pageBackground() {
    var els = [document.body, root];
    for (var i = 0; i < els.length; i++) {
      var c = window.getComputedStyle(els[i]).backgroundColor;
      var alpha = (String(c).match(/-?\d*\.?\d+/g) || [])[3];
      if (c && c !== 'transparent' && alpha !== '0') { return parseRgb(c); }
    }
    return null;
  }

  // A colour 12% of the way from the page background to the word's own colour: barely visible.
  function mix(from, to, amount) {
    return 'rgb(' + from.map(function (f, i) { return Math.round(f + (to[i] - f) * amount); }).join(',') + ')';
  }

  function init() {
    var gsap = window.gsap;
    var lines = title ? Array.prototype.slice.call(title.querySelectorAll('.h-line')) : [];
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bg = pageBackground();
    if (!gsap || !title || !sub || !lines.length || reduced || !bg) { show(); return; }

    var words = [], bars = [], letters = [];
    var label = lines.map(function (l) { return l.textContent.trim(); }).join(' ');
    title.setAttribute('aria-label', label);

    lines.forEach(function (line) {
      var native = window.getComputedStyle(line).color;
      var nativeRgb = parseRgb(native);
      if (!nativeRgb) { throw new Error('unreadable colour'); }
      var start = mix(bg, nativeRgb, 0.12);
      var text = line.textContent;
      line.textContent = '';
      text.split(/(\s+)/).forEach(function (token) {
        if (!token) { return; }
        if (/^\s+$/.test(token)) { line.appendChild(document.createTextNode(' ')); return; }
        var wrap = document.createElement('span');
        wrap.className = 'hw';
        wrap.setAttribute('aria-hidden', 'true');
        var inner = document.createElement('span');
        inner.className = 'hw-i';
        var isHidden = HIDDEN_WORDS.indexOf(token.toLowerCase().replace(/[^a-z0-9]/g, '')) !== -1;
        if (isHidden) {
          Array.prototype.forEach.call(token, function (ch) {
            var l = document.createElement('span');
            l.textContent = ch;
            l.dataset.native = native;
            l.dataset.start = start;
            inner.appendChild(l);
            letters.push(l);
          });
          var bar = document.createElement('i');
          bar.className = 'hw-bar';
          inner.appendChild(bar);
          bars.push(bar);
        } else {
          inner.textContent = token;
        }
        wrap.appendChild(inner);
        line.appendChild(wrap);
        words.push(inner);
      });
    });

    // First frame: every word below its line, the subhead waiting, the bars retracted.
    gsap.set(words, { yPercent: 118 });
    gsap.set(bars, { scaleX: 0, transformOrigin: '0% 50%' });
    gsap.set(sub, { opacity: 0, y: 14 });
    show();

    timeline = gsap.timeline({ onComplete: restore });
    timeline.to(words, { yPercent: 0, duration: 0.85, ease: 'power4.out', stagger: 0.07 });
    timeline.to(sub, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, 0.55);

    // The bars cover the hidden words, then lift off to the right.
    var at = timeline.duration() + 0.3;
    timeline.to(bars, { scaleX: 1, duration: 0.5, ease: 'power3.inOut', stagger: 0.14 }, at);
    at = timeline.duration() + 0.75;
    timeline.set(bars, { transformOrigin: '100% 50%' }, at);
    timeline.to(bars, { scaleX: 0, duration: 0.6, ease: 'power3.inOut', stagger: 0.14 }, at);

    // The words come back from the page colour to their own colour.
    timeline.set(letters, { color: function (i, el) { return el.dataset.start; } }, at);
    timeline.to(letters, {
      color: function (i, el) { return el.dataset.native; },
      duration: SETTLE,
      ease: 'power1.out',
      stagger: SETTLE * 0.05
    }, at + HOLD);
  }

  function boot() {
    try { init(); } catch (e) { restore(); }
  }

  if (document.fonts && document.fonts.ready) {
    // Measure after the heading font is in, with a cap so a slow font never holds the headline back.
    Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1200); })]).then(boot);
  } else {
    boot();
  }
}());
