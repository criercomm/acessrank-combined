// S03 — Plug-ins (V2). A wall of 400 widget badges assembles from chaos (ring stagger, ticks); on the next click
// 38.5 % of them turn red — the businesses that were sued anyway — and the number clacks in. JP's copy sits under the title.
import { gsap, T, sec } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { el } from '@lib/util/dom.js'
import { heading, tile, para } from '../components/ui.js'
import { Wall } from '../components/wall.js'

export default {
  id: 's03', title: 'Plug-ins', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound, mobile } = ctx
    this._notes = copy.s03.notes
    const wall = Wall(el('div', { class: 's03-wall bleed' }), { count: mobile ? 100 : 400, cols: mobile ? 10 : 25, sound })
    const title = heading(copy.s03.title, { tag: 'h2', cls: 'h-statement s03-title' })
    const lede = para(copy.s03.lede, 's03-lede')
    const big = tile({ value: copy.s03.pct + copy.s03.pctSuffix, label: copy.s03.pctLabel, source: copy.s03.pctSource }, { sound, size: 'xl', cls: 's03-big' })
    const panel = el('div', { class: 's03-panel' }, big.el)
    root.append(wall.el, el('div', { class: 's03-scrim bleed', 'aria-hidden': 'true' }), el('div', { class: 's03-copy' }, title.el, lede), panel)
    this.els = { wall, title, lede, big, panel }
    gsap.set([panel, lede], { opacity: 0 })
    this.stage = 0
  },
  enter(ctx) {
    const { wall, title, lede, panel } = this.els
    this.stage = 0
    this.tl?.kill()
    wall.scatter()
    gsap.set(panel, { opacity: 0 })
    const tl = gsap.timeline()
    tl.add(wall.assemble(), .2)
    tl.add(() => title.restart(), 1.9)
    tl.add(Stagger([lede], { dur: T[4], y: 10 }), 3)
    this.tl = tl
  },
  next(ctx) {
    const { wall, big, panel } = this.els
    if (this.stage === 0) {
      this.stage = 1
      const tl = gsap.timeline()
      tl.add(wall.mark(.385), 0)
      tl.set(panel, { opacity: 1 }, .3)
      tl.add(Stagger([big.el], { dur: T[4], y: 12 }), .3)
      tl.add(() => big.play(), .5)
      this.tl2 = tl
      return true
    }
    return false
  },
  prev() {
    if (this.stage === 0) return false
    this.stage = 0
    this.tl2?.kill()
    gsap.to(this.els.panel, { opacity: 0, duration: sec(T[3]) })
    this.els.wall.el.classList.remove('is-marked')
    this.els.wall.cells.forEach(({ el: c }) => c.classList.remove('is-sued', 'is-dim'))
    return true
  },
  leave() { this.tl?.kill(); this.tl2?.kill() },
}
