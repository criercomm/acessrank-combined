/* Accessrank — home page headline animation ("The lawsuit hidden in your website.").
 *
 * The same kinetic type as slide 1 of the overview deck (deck/lib/motion/kinetic-type.js
 * via heading() in deck/src/components/ui.js): every letter rises 10px into place
 * while fading in and its weight swells from 300 to 800, letters staggered 18ms
 * apart, line after line. The subhead follows once the headline is mostly in.
 * Timing and easing mirror the deck's tokens (T[4] = 800ms, out-expo), so the two
 * headlines move the same way.
 *
 * Loaded only on pages marked `heroMotion` in site.json, bundled after GSAP
 * (vendor/gsap.min.js) into one file by build.mjs.
 *
 * - The weight tween drives `--wght`, read by `font-variation-settings` in home.css.
 *   Inter here is the variable 100–900 file, so the swell is real, not faux-bold.
 * - No colours are read or set here, so the dark and light themes both work unchanged.
 * - Nothing animates under prefers-reduced-motion or on phone-width screens (under 768px): the plain headline just shows.
 * - The headline is split into letters only while it animates. When the timeline
 *   ends, the original markup is put back, so the finished page is exactly the
 *   static HTML in src/pages/index.html.
 * - If anything fails, the original markup is restored and the headline shows.
 */
(function () {
  'use strict';

  /* Deck tokens: T[4] in seconds, the per-letter stagger, and how far a letter rises. */
  var DUR = 0.8;
  var STAGGER = 0.018;
  var RISE = 10;
  var WGHT_FROM = 300;
  var WGHT_TO = 800;
  var SUB_AT = 1.5;      // the deck starts its subhead 1.5s in

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

  function init() {
    var gsap = window.gsap;
    var lines = title ? Array.prototype.slice.call(title.querySelectorAll('.h-line')) : [];
    // Same condition as theme.js: no animation under reduced motion or on phone-width screens.
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(max-width: 767px)').matches;
    if (!gsap || !title || !sub || !lines.length || reduced) { show(); return; }

    var label = lines.map(function (l) { return l.textContent.trim(); }).join(' ');
    title.setAttribute('aria-label', label);

    // Split each line into words (kept whole so they never break mid-word) and letters.
    var perLine = lines.map(function (line) {
      var text = line.textContent;
      var letters = [];
      line.textContent = '';
      text.split(/(\s+)/).forEach(function (token) {
        if (!token) { return; }
        if (/^\s+$/.test(token)) { line.appendChild(document.createTextNode(' ')); return; }
        var word = document.createElement('span');
        word.className = 'hw';
        word.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(token, function (ch) {
          var l = document.createElement('span');
          l.className = 'hc';
          l.textContent = ch;
          word.appendChild(l);
          letters.push(l);
        });
        line.appendChild(word);
      });
      return letters;
    });
    var all = [].concat.apply([], perLine);

    // First frame: every letter faded, 10px low and light; the subhead waiting.
    gsap.set(all, { opacity: 0, y: RISE, '--wght': WGHT_FROM, force3D: true });
    gsap.set(sub, { opacity: 0, y: RISE, force3D: true });
    show();

    // Paused until the browser has painted the first frame, so the first tween
    // frame does not land on the same frame as the layout from the split above.
    timeline = gsap.timeline({ paused: true, onComplete: restore });
    var at = 0;
    perLine.forEach(function (letters) {
      timeline.to(letters, { opacity: 1, y: 0, '--wght': WGHT_TO, duration: DUR, ease: 'expo.out', stagger: STAGGER }, at);
      // The deck starts the next line once ~55% of this line's letters are in.
      at += letters.length * STAGGER * 0.55;
    });
    timeline.to(sub, { opacity: 1, y: 0, duration: DUR, ease: 'expo.out' }, SUB_AT);

    requestAnimationFrame(function () { requestAnimationFrame(function () { if (timeline) { timeline.play(); } }); });
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
