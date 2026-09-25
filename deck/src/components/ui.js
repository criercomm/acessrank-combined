// UI helpers shared by the scenes: kinetic headings (per character, variable weight), labels, stat tiles with flap digits, brand mark.
import { gsap, T, sec } from '@lib/motion/ease.js'
import { KineticType } from '@lib/motion/kinetic-type.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el } from '@lib/util/dom.js'

// heading(lines) → { el, tl } · each line is its own KineticType; line `accent` takes the signal/accent color (site pattern:
// white first line, blue second). Weight animates 300→800 per character; line n starts when line n-1 is ~55 % through.
export function heading(lines, { tag = 'h2', cls = 'h-statement', accent = 1, accentClass = 'is-signal', per = 'char', dur = T[4], delay = 18 } = {}) {
  const h = el(tag, { class: cls })
  const tl = gsap.timeline({ paused: true })
  let at = 0
  lines.forEach((line, i) => {
    const span = el('span', { class: 'h-line' + (i === accent ? ' ' + accentClass : ''), text: line })
    h.append(span)
    const k = KineticType(span, { per, from: 300, to: 800, dur, delay, y: 10, paused: true })
    tl.add(k.play(), at)
    at += (line.replace(/\s/g, '').length * delay * .55) / 1000
  })
  const restart = () => { tl.pause(0); tl.play(0); return tl }
  return { el: h, tl, restart }
}

export const label = (text, cls = '') => el('span', { class: 'label ' + cls, text })
export const para = (text, cls = 'lede') => el('p', { class: cls, text })

// Stat tile in the language of accessrank.ai cards: big number in flap digits, label, source line.
export function tile({ value, label: lab, source }, { cls = '', digits = 0, sound = null, size = 'l' } = {}) {
  const num = el('div', { class: 'tile-num mono' })
  const flap = FlapDigits(num, { value, digits, clack: true, dur: T[4], sound })
  const root = el('div', { class: `tile tile--${size} ${cls}` }, num, el('p', { class: 'tile-label', text: lab }), source ? el('p', { class: 'tile-source label', text: source }) : null)
  return { el: root, flap, play: () => flap.play(), set: (v) => flap.set(v) }
}

export const brandMark = (cls = '') => el('span', { class: 'brand ' + cls }, el('i', { class: 'brand-check', 'aria-hidden': 'true' }), el('span', { text: 'Accessrank' }))

// visible "TBD" chip for inputs that still have to be filled in
export const tbd = (text = 'TBD') => el('span', { class: 'tbd', text })

export { sec }
