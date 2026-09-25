// S02 — The letter (V2). The first page of a real complaint (names and contact details blurred) rises into view; four stat
// tiles clack in on the left under the statement. The envelope it used to rise out of is hidden since 2026-09-15 (Carlos):
// SHOW_ENVELOPE brings it back (the asset stays in the manifest and the drop choreography is kept below).
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { Parallax } from '@lib/motion/parallax.js'
import { el } from '@lib/util/dom.js'
import { heading, tile, para } from '../components/ui.js'

const ENV = 'dR-s02-letter-envelope', PAGE = 'dR-s02-letter-page'
const SHOW_ENVELOPE = false // hidden on request; set true to bring the envelope (and its drop + thud) back
export default {
  id: 's02', title: 'The letter', transition: 'pull',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, assets, sound } = ctx
    this._notes = copy.s02.notes
    const title = heading(copy.s02.title, { tag: 'h2', cls: 'h-statement s02-title' })
    const tiles = copy.s02.stats.map((s) => tile(s, { sound, size: 'l' }))
    const micro = para(copy.s02.micro, 's02-micro mono')
    const page = el('figure', { class: 's02-page' }, assets.img(PAGE, { w: 1600, sizes: '30vw', alt: copy.s02.letterAlt }))
    const env = el('figure', { class: 's02-env' }, assets.img(ENV, { w: 1600, sizes: '38vw', alt: 'A sealed legal envelope' }))
    const right = el('div', { class: 's02-right' + (SHOW_ENVELOPE ? '' : ' no-env') }, page, ...(SHOW_ENVELOPE ? [env] : []))
    root.append(el('div', { class: 's02-copy' }, title.el), el('div', { class: 's02-tiles' }, ...tiles.map((t) => t.el), micro), right)
    this.els = { title, tiles, micro, env, page }
    this.parallax = Parallax(SHOW_ENVELOPE ? [{ el: page, depth: .25 }, { el: env, depth: .45 }] : [{ el: page, depth: .3 }], { pointer: 14, scroll: 0 })
    gsap.set(tiles.map((t) => t.el), { opacity: 0 })
    gsap.set(micro, { opacity: 0 })
    gsap.set([env, page], { opacity: 0 })
  },
  preload(ctx) { return ctx.assets.preload(SHOW_ENVELOPE ? [ENV, PAGE] : [PAGE], 1600) },
  enter(ctx) {
    const { title, tiles, micro, env, page } = this.els
    const { sound, reduced } = ctx
    this.tl?.kill()
    const tl = gsap.timeline()
    if (reduced) tl.set([env, page], { opacity: 1 })
    else if (!SHOW_ENVELOPE) {
      // no envelope: the complaint rises from below and settles with a slight tilt
      tl.set(page, { opacity: 1 }, .3)
      tl.fromTo(page.firstElementChild, { yPercent: 40, rotation: 1.5 }, { yPercent: 0, rotation: -2.5, duration: sec(T[6]), ease: ease('out-expo') }, .3)
      tl.add(() => sound.play('whoosh', { gain: .5, rate: .8 }), .35)
    } else {
      // the drop: from above the frame, slight tilt, lands with a thud and a 1 % settle
      tl.fromTo(env.firstElementChild, { y: '-70vh', rotation: -7, scale: 1.06 }, { y: 0, rotation: 0, scale: 1, duration: sec(1400), ease: ease('in-out-quart') }, 0)
      tl.set(env, { opacity: 1 }, 0)
      tl.add(() => sound.play('braam', { gain: .45, rate: 1.3 }), 1.25)
      tl.fromTo(env.firstElementChild, { scale: 1 }, { scale: .985, duration: .09, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 1.4)
      // the complaint rises out of the envelope
      tl.set(page, { opacity: 1 }, 1.7)
      tl.fromTo(page.firstElementChild, { yPercent: 70, rotation: 2 }, { yPercent: 0, rotation: -3, duration: sec(T[6]), ease: ease('out-expo') }, 1.7)
      tl.add(() => sound.play('whoosh', { gain: .5, rate: .8 }), 1.75)
    }
    tl.add(() => title.restart(), .4)
    tl.add(Stagger(tiles.map((t) => t.el), { dur: T[4], y: 16, delay: 110 }), 1.9)
    tiles.forEach((t, i) => tl.add(() => t.play(), 2.1 + i * .22))
    tl.add(Stagger([micro], { dur: T[4], y: 8 }), 3.2)
    this.tl = tl
    this.parallax.start()
  },
  leave() { this.tl?.kill(); this.parallax.stop() },
}
