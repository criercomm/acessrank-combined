// Magnetic(el, {radius, strength}) — CTA con deriva magnética muy sutil en desktop (spec §16: "CTA magnetic drift under 6px").
// Sin brillo neón: el hover mueve el borde fino (CSS). Nada en pointer: coarse.
import { gsap } from '@lib/motion/ease.js'
import { isCoarse, prefersReduced } from '@lib/util/dom.js'
export function Magnetic(el, { radius = 120, max = 6 } = {}) {
  if (isCoarse() || prefersReduced()) return { destroy() {} }
  const onMove = (e) => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy)
    if (d > radius) { gsap.to(el, { x: 0, y: 0, duration: .6, ease: 'expo.out', overwrite: 'auto' }); return }
    const k = (1 - d / radius) * max
    gsap.to(el, { x: (dx / d) * k || 0, y: (dy / d) * k || 0, duration: .4, ease: 'expo.out', overwrite: 'auto' })
  }
  addEventListener('pointermove', onMove, { passive: true })
  return { destroy() { removeEventListener('pointermove', onMove); gsap.set(el, { x: 0, y: 0 }) } }
}
