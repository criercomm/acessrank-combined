// Stagger(items, {delay:40, dur:t-3, ease:out-expo, from:'center'|'left'|'random'})
// opacity 0→1, translateY 24→0, scale .96→1. Máximo 24 por stagger; más → grupos encadenados.
import { gsap, ease, sec, T } from './ease.js'
import { prefersReduced } from '../util/dom.js'
export function Stagger(items, { delay = 40, dur = T[3], ease: e = 'out-expo', from = 'center', y = 24, scale = .96, opacity = 0, onComplete, paused = false, group = 24 } = {}) {
  const els = Array.from(items && items.nodeType ? [items] : items || [])
  const tl = gsap.timeline({ onComplete, paused })
  if (!els.length) return tl
  if (prefersReduced()) { tl.set(els, { opacity: 1, y: 0, scale: 1 }); return tl }
  const groups = []
  for (let i = 0; i < els.length; i += group) groups.push(els.slice(i, i + group))
  const f = from === 'left' ? 'start' : from === 'right' ? 'end' : from
  groups.forEach((g, gi) => {
    tl.fromTo(g, { opacity, y, scale }, { opacity: 1, y: 0, scale: 1, duration: sec(dur), ease: ease(e), stagger: { each: sec(delay), from: f }, overwrite: 'auto' }, gi * sec(delay) * (group / 2))
  })
  return tl
}
