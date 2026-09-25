// Wall(root, {count, cols, seed}) — S03 signature: a wall of widget badges that assembles from chaos into a grid
// (Deck A pattern: fixed seed, ring stagger from the centre), then a fraction of them turn red ("sued anyway").
// Badges are pure CSS (no images): a rounded button with a circle, the shape every overlay vendor sells.
import { gsap, ease, sec, T } from '@lib/motion/ease.js'
import { prng } from '@lib/util/prng.js'
import { el, prefersReduced } from '@lib/util/dom.js'
export function Wall(root, { count = 400, cols = 25, seed = 11, sound = null } = {}) {
  root.classList.add('wall')
  root.style.setProperty('--cols', cols)
  const r = prng(seed)
  const rows = Math.ceil(count / cols)
  const cells = []
  for (let i = 0; i < count; i++) {
    const c = el('i', { class: 'badge', 'aria-hidden': 'true' })
    root.append(c)
    const col = i % cols, row = Math.floor(i / cols)
    const ring = Math.max(Math.abs(col - (cols - 1) / 2), Math.abs(row - (rows - 1) / 2))
    cells.push({ el: c, col, row, ring, chaos: { x: (r() - .5) * 120, y: (r() - .5) * 90, rot: (r() - .5) * 50, s: .4 + r() * .5 } })
  }
  const reduced = prefersReduced()
  function scatter() {
    cells.forEach(({ el: c, chaos }) => gsap.set(c, { xPercent: 0, x: chaos.x + 'vw', y: chaos.y + 'vh', rotation: chaos.rot, scale: chaos.s, opacity: .5, filter: 'blur(2px)' }))
    root.classList.remove('is-marked')
    cells.forEach(({ el: c }) => c.classList.remove('is-sued', 'is-dim'))
  }
  function assemble() {
    const tl = gsap.timeline()
    if (reduced) { cells.forEach(({ el: c }) => gsap.set(c, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, filter: 'none' })); return tl }
    const maxRing = Math.max(...cells.map((c) => c.ring))
    cells.forEach(({ el: c, ring }) => tl.to(c, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, filter: 'blur(0px)', duration: sec(T[6]), ease: ease('out-expo') }, ring * .04))
    for (let k = 0; k <= maxRing; k++) tl.add(() => sound?.play('tick', { gain: .6, rate: 1 + k * .02, throttle: 30 }), k * .04)
    return tl
  }
  // mark(fraction): a deterministic subset turns red; the rest dims. Returns timeline.
  function mark(fraction = .385) {
    const rr = prng(seed + 1)
    const n = Math.round(count * fraction)
    const idx = cells.map((_, i) => i).sort(() => rr() - .5).slice(0, n)
    const tl = gsap.timeline()
    root.classList.add('is-marked')
    idx.forEach((i, k) => tl.add(() => { cells[i].el.classList.add('is-sued'); if (k % 6 === 0) sound?.play('blip', { gain: .35, rate: .9 + rr() * .2, throttle: 40 }) }, k * .006))
    cells.forEach(({ el: c }, i) => { if (!idx.includes(i)) tl.add(() => c.classList.add('is-dim'), 0) })
    return tl
  }
  scatter()
  return { el: root, cells, scatter, assemble, mark }
}
