/* Accessrank — home page headline animation ("The lawsuit hidden in your website.").
 *
 * The words "lawsuit" and "hidden" start redacted. Every word rolls up into place,
 * black bars cover the two hidden words, and as the bars lift the words fade back
 * in. The fade is an opacity tween, not a colour tween: colour changes repaint the
 * glyphs every frame at headline size and read as a stutter, while opacity and
 * transform run on the compositor.
 *
 * Loaded only on pages marked `heroMotion` in site.json, bundled after GSAP
 * (vendor/gsap.min.js) into one file by build.mjs.
 *
 * - No colours are read or set here, so the dark and light themes both work unchanged.
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

  function init() {
    var gsap = window.gsap;
    var lines = title ? Array.prototype.slice.call(title.querySelectorAll('.h-line')) : [];
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!gsap || !title || !sub || !lines.length || reduced) { show(); return; }

    var words = [], bars = [], letters = [];
    var label = lines.map(function (l) { return l.textContent.trim(); }).join(' ');
    title.setAttribute('aria-label', label);

    lines.forEach(function (line) {
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
    // force3D puts each moving piece on its own compositor layer for the whole run.
    gsap.set(words, { yPercent: 118, force3D: true });
    gsap.set(bars, { scaleX: 0, transformOrigin: '0% 50%', force3D: true });
    gsap.set(sub, { opacity: 0, y: 14, force3D: true });
    show();

    // Paused until the browser has painted the first frame, so the first tween
    // frame does not land on the same frame as the layout from the split above.
    timeline = gsap.timeline({ paused: true, onComplete: restore });
    timeline.to(words, { yPercent: 0, duration: 0.85, ease: 'power4.out', stagger: 0.07 });
    timeline.to(sub, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, 0.55);

    // The bars cover the hidden words, then lift off to the right.
    var at = timeline.duration() + 0.3;
    timeline.to(bars, { scaleX: 1, duration: 0.5, ease: 'power3.inOut', stagger: 0.14 }, at);
    at = timeline.duration() + 0.75;
    timeline.set(bars, { transformOrigin: '100% 50%' }, at);
    timeline.to(bars, { scaleX: 0, duration: 0.6, ease: 'power3.inOut', stagger: 0.14 }, at);

    // The hidden words come back from barely-there to full strength (opacity only).
    timeline.set(letters, { opacity: 0.12 }, at);
    timeline.to(letters, {
      opacity: 1,
      duration: SETTLE,
      ease: 'power1.out',
      stagger: SETTLE * 0.05
    }, at + HOLD);

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
