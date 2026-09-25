// ScoreRing(el, {size}) — the accessrank.ai score ring drawn in SVG: a track, an arc that fills to the value and flap digits inside.
// Tones follow the site: bad (red) under 50, warn (orange) under 80, ok (brand yellow) from 80. set(value) animates arc + digits.
import { gsap, ease, sec, T } from '@lib/motion/ease.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el, prefersReduced } from '@lib/util/dom.js'
const NS = 'http://www.w3.org/2000/svg'
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
export function ScoreRing(root, { size = 160, stroke = 8, sound = null, caption = 'score' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ring', 'aria-hidden': 'true' })
  const track = svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-track', 'stroke-width': stroke })
  const arc = svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-arc', 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: `rotate(-90 ${size / 2} ${size / 2})` })
  s.append(track, arc)
  const num = el('div', { class: 'ring-num mono' })
  const flap = FlapDigits(num, { value: '', digits: 2, clack: true, dur: T[4], sound })
  const cap = el('span', { class: 'ring-cap label', text: caption })
  root.classList.add('score-ring')
  root.setAttribute('data-tone', 'neutral')
  root.append(s, el('div', { class: 'ring-inner' }, num, cap))
  const state = { v: 0 }
  function tone(v) { return v < 50 ? 'bad' : v < 80 ? 'warn' : 'ok' }
  function set(v, { dur = T[5] } = {}) {
    root.setAttribute('data-tone', tone(v))
    flap.set(String(v).padStart(2, ' '))
    if (prefersReduced()) { state.v = v; arc.setAttribute('stroke-dashoffset', c * (1 - v / 100)); return gsap.timeline() }
    return gsap.to(state, { v, duration: sec(dur), ease: ease('out-expo'), onUpdate: () => arc.setAttribute('stroke-dashoffset', c * (1 - state.v / 100)) })
  }
  function reset() { state.v = 0; arc.setAttribute('stroke-dashoffset', c); root.setAttribute('data-tone', 'neutral'); flap.set('  ') }
  return { el: root, set, reset, get value() { return state.v } }
}
