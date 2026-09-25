// Cursor() — punto + anillo con lag .12; el anillo crece en hover de hotspots. Oculto en pointer: coarse.
import { el, isCoarse } from '../util/dom.js'
export function Cursor({ lag = .12, hover = '[data-hotspot], a, button, [data-cursor]' } = {}) {
  if (isCoarse()) return { el: null, destroy() {} }
  const root = el('div', { class: 'cursor', 'aria-hidden': 'true' }, el('div', { class: 'cursor-dot' }), el('div', { class: 'cursor-ring' }, el('i')))
  document.body.append(root)
  document.documentElement.classList.add('has-cursor')
  const dot = root.children[0], ring = root.children[1]
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, raf = 0, seen = false
  const move = (e) => {
    x = e.clientX; y = e.clientY
    if (!seen) { seen = true; rx = x; ry = y; root.classList.add('is-on') }
    const t = e.target && e.target.closest ? e.target.closest(hover) : null
    root.classList.toggle('is-hover', !!t)
  }
  const down = () => root.classList.add('is-down')
  const up = () => root.classList.remove('is-down')
  const leave = () => root.classList.remove('is-on')
  const enter = () => { if (seen) root.classList.add('is-on') }
  addEventListener('pointermove', move, { passive: true })
  addEventListener('pointerdown', down, { passive: true })
  addEventListener('pointerup', up, { passive: true })
  document.documentElement.addEventListener('mouseleave', leave)
  document.documentElement.addEventListener('mouseenter', enter)
  function frame() {
    rx += (x - rx) * lag; ry += (y - ry) * lag
    dot.style.transform = `translate3d(${x}px,${y}px,0)`
    ring.style.transform = `translate3d(${rx.toFixed(2)}px,${ry.toFixed(2)}px,0)`
    raf = requestAnimationFrame(frame)
  }
  frame()
  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf); root.remove(); document.documentElement.classList.remove('has-cursor')
      removeEventListener('pointermove', move); removeEventListener('pointerdown', down); removeEventListener('pointerup', up)
      document.documentElement.removeEventListener('mouseleave', leave); document.documentElement.removeEventListener('mouseenter', enter)
    },
  }
}
