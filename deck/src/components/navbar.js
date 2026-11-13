// Navbar — the deck stepper, at the bottom on every viewport (labeled dots: the current chapter is a named pill).
// Earlier it served compact screens only; the desktop top-left dots are gone, see style.css (.chapters is hidden).
// Original note, still true on compact screens (phones, landscape phones, short or portrait windows):
// The desktop chrome keeps the chapter dots at the top left and the legal line in the footer; neither survives a 310 px
// tall viewport, so below the compact breakpoint (see the compact block in src/style.css) both move down here:
// previous · chapter dots · next, with the legal line above them. The dots are real buttons — one per scene, the current
// one carries aria-current — and every target is at least 24 px wide and 40 px tall, which is the point of a deck about
// accessibility. Hidden on desktop, where the top chrome does this job.
import { el } from '@lib/util/dom.js'

const arrow = (d) => `<svg viewBox="0 0 24 12" width="24" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// go(i) salta a la escena i · step(±1) delega en next()/prev() del deck (respeta las escenas con pasos internos, como S05).
// Autoplay: the deck advances itself every `interval` ms and stops on the last scene. WCAG 2.2.2 (pause, stop, hide):
// a real play/pause button sits beside the arrows; autoplay also holds while the pointer or keyboard focus is inside the
// stepper, pauses for good as soon as the visitor navigates themselves (arrows, dots, keys, wheel, swipe), pauses while the
// tab is hidden, and never starts for visitors who ask for reduced motion, on ?autoplay=0, or under automation.
export function Navbar({ chapters, legal, go, step, sound = null, autoplay = true, interval = 8000 }) {
  // Labeled dots: every chapter is a dot; the current one grows into a pill carrying its name only (no numbering);
  // aria-label keeps the "3. Name" form for screen readers.
  const dots = chapters.map((name, i) => el('button', {
    class: 'nav-dot', type: 'button', 'aria-label': `${i + 1}. ${name}`,
    onclick: (e) => { e.stopPropagation(); sound?.start(); takeover(); go(i) },
  }, el('i', { 'aria-hidden': 'true' }),
  el('span', { class: 'nav-dot-label', 'aria-hidden': 'true' }, el('em', { text: name }))))
  const mkArrow = (dir, label, path) => el('button', {
    class: 'nav-arrow', type: 'button', 'aria-label': label, html: arrow(path),
    onclick: (e) => { e.stopPropagation(); sound?.start(); takeover(); step(dir) },
  })
  const prev = mkArrow(-1, 'Previous scene', 'M22 6H2M7 1 2 6l5 5')
  const next = mkArrow(1, 'Next scene', 'M2 6h20M17 1l5 5-5 5')
  prev.classList.add('nav-prev'); next.classList.add('nav-next')
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  const allowed = autoplay && !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.webdriver && new URLSearchParams(location.search).get('autoplay') !== '0'
  let seen = false, playing = allowed, held = false, current = 0, timer = 0, autoUntil = 0
  const playBtn = el('button', { class: 'nav-arrow nav-play', type: 'button', onclick: (e) => { e.stopPropagation(); sound?.start(); toggle() } })
  const root = el('nav', { class: 'navbar', 'aria-label': 'Scenes' },
    el('p', { class: 'nav-legal mono', html: legal }),
    el('div', { class: 'nav-row' }, ...(allowed ? [playBtn] : []), prev, el('ol', { class: 'nav-dots' }, ...dots.map((d) => el('li', {}, d))), next))

  const last = chapters.length - 1
  function paint() {
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY
    playBtn.setAttribute('aria-label', playing ? 'Pause autoplay' : 'Play autoplay')
  }
  function schedule() {
    clearTimeout(timer)
    if (!playing || held || document.hidden) return
    timer = setTimeout(() => {
      if (current >= last) { playing = false; paint(); return } // the end: stop, offer Play
      autoUntil = performance.now() + 1500 // scene changes that follow count as ours, not the visitor's
      step(1)
      schedule() // scenes with inner steps (S05) answer step() without changing scene
    }, interval)
  }
  function toggle() {
    if (!playing && current >= last) go(0) // Play on the last scene starts over
    playing = !playing; paint(); schedule()
  }
  // a visitor who takes the wheel keeps it: any navigation we did not start ends autoplay
  const userTook = () => { if (playing && performance.now() > autoUntil) { playing = false; paint() } }
  function takeover() { if (playing) { playing = false; paint(); clearTimeout(timer) } }
  const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
  document.addEventListener('keydown', (e) => { if (NAV_KEYS.has(e.key) && !e.target.closest?.('.nav-play')) takeover() })
  document.addEventListener('wheel', takeover, { passive: true })
  document.addEventListener('touchstart', takeover, { passive: true })
  root.addEventListener('pointerenter', () => { held = true; schedule() })
  root.addEventListener('pointerleave', () => { held = root.matches(':focus-within'); schedule() })
  root.addEventListener('focusin', () => { held = true; schedule() })
  root.addEventListener('focusout', () => { held = root.matches(':hover'); schedule() })
  document.addEventListener('visibilitychange', schedule)
  paint()

  function update(i) {
    if (seen && i !== current) userTook() // the first call only reports the starting scene (it may be ?slide=N)
    seen = true; current = i
    dots.forEach((d, k) => {
      d.classList.toggle('is-on', k === i); d.classList.toggle('is-past', k < i)
      if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current')
    })
    const first = i <= 0, atEnd = i >= last
    prev.classList.toggle('is-quiet', first); prev.setAttribute('aria-disabled', String(first))
    next.classList.toggle('is-quiet', atEnd); next.setAttribute('aria-disabled', String(atEnd))
    schedule()
  }
  return { el: root, update }
}
