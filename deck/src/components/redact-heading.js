// redactHeading(lines, opts) — the accessrank.ai home-page headline effect, for slide 1.
// A port of src/assets/js/hero-motion.js so the deck's cover and the site's hero move the
// same way: every word rolls up into place, black bars sweep over the two hidden words
// ("lawsuit", "hidden"), then lift off to the right as the words fade back in. The fade
// is opacity, not colour, so it runs on the compositor at headline size.
// Returns { el, tl, restart } like heading() in ui.js, so s01-cover.js drives it the same way.
import { gsap } from '@lib/motion/ease.js'
import { el, prefersReduced } from '@lib/util/dom.js'

const HIDDEN_WORDS = ['lawsuit', 'hidden']
const SETTLE = 2.6   // seconds the hidden words take to come back to full strength (same as the site)

export function redactHeading(lines, { tag = 'h2', cls = '', accent = [], accentClass = 'is-accent' } = {}) {
  const h = el(tag, { class: cls, 'aria-label': lines.join(' ') })
  const words = [], bars = [], letters = []
  lines.forEach((line, i) => {
    if (i) h.append(' ')
    const span = el('span', { class: 'h-line' + (accent.includes(i) ? ' ' + accentClass : ''), 'aria-hidden': 'true' })
    line.split(/(\s+)/).forEach((token) => {
      if (!token) return
      if (/^\s+$/.test(token)) { span.append(' '); return }
      const wrap = el('span', { class: 'hw' })
      const inner = el('span', { class: 'hw-i' })
      if (HIDDEN_WORDS.includes(token.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        for (const ch of token) { const l = el('span', { text: ch }); inner.append(l); letters.push(l) }
        const bar = el('i', { class: 'hw-bar' })
        inner.append(bar); bars.push(bar)
      } else inner.textContent = token
      wrap.append(inner); span.append(wrap); words.push(inner)
    })
    h.append(span)
  })

  const build = () => {
    const tl = gsap.timeline({ paused: true })
    if (prefersReduced()) { tl.set(words, { yPercent: 0 }); tl.set(bars, { scaleX: 0 }); tl.set(letters, { opacity: 1 }); return tl }
    // First frame: every word below its line, the bars retracted, the letters at full strength.
    tl.set(words, { yPercent: 118, force3D: true })
    tl.set(bars, { scaleX: 0, transformOrigin: '0% 50%', force3D: true })
    tl.set(letters, { opacity: 1 })
    tl.to(words, { yPercent: 0, duration: .85, ease: 'power4.out', stagger: .07 })
    // The bars cover the hidden words, then lift off to the right.
    let at = tl.duration() + .3
    tl.to(bars, { scaleX: 1, duration: .5, ease: 'power3.inOut', stagger: .14 }, at)
    at = tl.duration() + .75
    tl.set(bars, { transformOrigin: '100% 50%' }, at)
    tl.to(bars, { scaleX: 0, duration: .6, ease: 'power3.inOut', stagger: .14 }, at)
    // The hidden words come back from barely-there to full strength (opacity only).
    tl.set(letters, { opacity: .12 }, at)
    tl.to(letters, { opacity: 1, duration: SETTLE, ease: 'power1.out', stagger: SETTLE * .05 }, at)
    return tl
  }
  let tl = build()
  const restart = () => { tl.kill(); tl = build(); tl.play(0); return tl }
  return { el: h, get tl() { return tl }, restart }
}
