// Parallax(layers[{el, depth 0–1}]) — pointer/gyro ±(depth×24px); scroll ±(depth×80px); lerp .08
// Escribe --px/--py en cada capa; el CSS .parallax-layer las aplica (no pisa otros transforms).
import { clamp, prefersReduced } from '../util/dom.js'
export function Parallax(layers, { pointer = 24, scroll = 80, lerp: k = .08, root = null, gyro = true } = {}) {
  const L = layers.map(({ el, depth = .5 }) => { el.classList.add('parallax-layer'); return { el, depth } })
  let tx = 0, ty = 0, sy = 0, cx = 0, cy = 0, cs = 0, raf = 0, on = false
  const reduced = prefersReduced()
  const rect = () => (root ? root.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight })
  const onMove = (e) => { const r = rect(); tx = clamp(((e.clientX - r.left) / r.width - .5) * 2, -1, 1); ty = clamp(((e.clientY - r.top) / r.height - .5) * 2, -1, 1) }
  const onOrient = (e) => { if (e.gamma == null) return; tx = clamp(e.gamma / 30, -1, 1); ty = clamp((e.beta - 45) / 30, -1, 1) }
  function frame() {
    cx += (tx - cx) * k; cy += (ty - cy) * k; cs += (sy - cs) * k
    for (const { el, depth } of L) {
      el.style.setProperty('--px', (cx * depth * pointer).toFixed(2) + 'px')
      el.style.setProperty('--py', (cy * depth * pointer + cs * depth * scroll).toFixed(2) + 'px')
    }
    if (on) raf = requestAnimationFrame(frame)
  }
  function start() {
    if (on || reduced) return
    on = true
    addEventListener('pointermove', onMove, { passive: true })
    if (gyro) addEventListener('deviceorientation', onOrient, { passive: true })
    raf = requestAnimationFrame(frame)
  }
  function stop() { on = false; cancelAnimationFrame(raf); removeEventListener('pointermove', onMove); removeEventListener('deviceorientation', onOrient) }
  function setScroll(p) { sy = clamp(p, -1, 1) }
  function destroy() { stop(); for (const { el } of L) { el.style.removeProperty('--px'); el.style.removeProperty('--py') } }
  return { start, stop, setScroll, destroy, layers: L }
}
