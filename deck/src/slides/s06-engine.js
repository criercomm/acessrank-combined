// S06 — One engine, four standards. 2×2 flap tiles (35 · 114 · 35 · 55), a rail of four standards, a strip of platforms
// (names in text only), and the Semrush +23 % foot as a fifth flap.
import { gsap, T } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { el } from '@lib/util/dom.js'
import { heading, tile, label } from '../components/ui.js'

export default {
  id: 's06', title: 'Engine', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s06
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s06-title' })
    const lede = el('p', { class: 's06-lede', text: C.lede })
    const tiles = C.tiles.map((t) => tile(t, { sound, size: 'l' }))
    const standards = C.standards.map((s, i) => el('div', { class: 's06-std', 'data-hotspot': '' }, el('b', { class: 'mono', text: String(i + 1).padStart(2, '0') }), el('span', { class: 's06-std-label', text: s.label }), el('span', { class: 's06-std-line', text: s.line })))
    const platforms = el('div', { class: 's06-platforms' }, label('Runs on', 's06-plat-label'), ...C.platforms.map((p) => el('span', { class: 'chip label', text: p })))
    root.append(el('div', { class: 's06-copy' }, title.el, lede), el('div', { class: 's06-grid' }, ...tiles.map((t) => t.el)), el('div', { class: 's06-right' }, ...standards, platforms))
    this.els = { title, lede, tiles, standards, platforms }
    // La rejilla y la columna derecha arrancan al 46 % o bajo el copy, lo que quede más abajo: en ventanas bajas el lede
    // (4 líneas) llegaba más allá del 46 % y las tiles lo pisaban. En modo compacto van en flujo y no se tocan.
    const grid = root.querySelector('.s06-grid'), right = root.querySelector('.s06-right'), copyEl = root.querySelector('.s06-copy')
    this.place = () => {
      if (getComputedStyle(grid).position !== 'absolute') { grid.style.top = right.style.top = ''; return }
      // Si al 46 % se comerían el pie (tiles estrechas a 1024), suben hacia el copy, nunca por encima de él.
      const floor = root.clientHeight - 88 - Math.max(grid.offsetHeight, right.offsetHeight)
      const top = Math.max(Math.min(root.clientHeight * .46, floor), copyEl.offsetTop + copyEl.offsetHeight + 20)
      grid.style.top = right.style.top = top + 'px'
    }
    window.addEventListener('resize', this.place)
    document.fonts?.ready.then(this.place)
    requestAnimationFrame(this.place)
    gsap.set([lede, ...tiles.map((t) => t.el), ...standards, platforms], { opacity: 0 })
  },
  enter(ctx) {
    this.place?.()
    const { title, lede, tiles, standards, platforms } = this.els
    this.tl?.kill()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    tl.add(Stagger([lede], { dur: T[4], y: 8 }), 1)
    tl.add(Stagger(tiles.map((t) => t.el), { dur: T[4], y: 16, delay: 100 }), .8)
    tiles.forEach((t, i) => tl.add(() => t.play(), 1 + i * .2))
    tl.add(Stagger(standards, { dur: T[4], y: 12, delay: 90, from: 'start' }), 1.4)
    tl.add(Stagger([platforms], { dur: T[4], y: 8 }), 2)
    this.tl = tl
  },
  leave() { this.tl?.kill() },
}
