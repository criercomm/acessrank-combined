// Grain(root, {amount:.06}) — grano fílmico animado global (canvas a media resolución, patrón de ruido a 12 fps)
import { el, prefersReduced } from '../util/dom.js'
export function Grain(root = document.body, { amount = .06, fps = 12, size = 160 } = {}) {
  const cv = el('canvas', { class: 'grain', 'aria-hidden': 'true' })
  cv.style.opacity = String(amount)
  root.append(cv)
  const c = cv.getContext('2d')
  const off = document.createElement('canvas')
  off.width = off.height = size
  const oc = off.getContext('2d')
  const img = oc.createImageData(size, size), d = img.data
  function noise() {
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() * 2 - 1) * 110; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 }
    oc.putImageData(img, 0, 0)
  }
  function resize() { cv.width = Math.ceil(innerWidth / 1.5); cv.height = Math.ceil(innerHeight / 1.5) }
  function paint() {
    noise()
    const p = c.createPattern(off, 'repeat')
    c.save()
    c.translate((Math.random() * size) | 0, (Math.random() * size) | 0)
    c.fillStyle = p
    c.fillRect(-size, -size, cv.width + size * 2, cv.height + size * 2)
    c.restore()
  }
  let last = 0, raf = 0, on = true
  function frame(t) { if (!on) return; if (t - last > 1000 / fps) { last = t; paint() } raf = requestAnimationFrame(frame) }
  resize()
  addEventListener('resize', resize)
  if (prefersReduced()) paint()
  else raf = requestAnimationFrame(frame)
  return { el: cv, destroy() { on = false; cancelAnimationFrame(raf); removeEventListener('resize', resize); cv.remove() } }
}
