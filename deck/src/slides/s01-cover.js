// S01 — Cover (V2). THE WEB'S BIGGEST BLIND SPOT. Left: title + JP's copy + source. Right: a floating 3D mockup of an
// ecommerce home page (Magnific, transparent) with parallax and a faint scanner beam crossing it in a loop.
import { gsap, T, sec } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { Parallax } from '@lib/motion/parallax.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, label, brandMark } from '../components/ui.js'

const MOCK = 'dR-s01-mockup-single'
export default {
  id: 's01', title: 'Blind spot', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, assets } = ctx
    this._notes = copy.s01.notes
    const brand = brandMark('s01-brand')
    const title = heading(copy.s01.title, { tag: 'h1', cls: 'h-display s01-title', accent: 1, accentClass: 'is-accent' })
    const sub = el('p', { class: 's01-sub', text: copy.s01.sub })
    const source = label(copy.s01.source, 's01-source')
    const beam = el('div', { class: 'beam beam--bg', 'aria-hidden': 'true' })
    const anim = el('div', { class: 's01-mock-anim' }, assets.img(MOCK, { w: 1600, sizes: '58vw', alt: 'A floating ecommerce home page' }), beam)
    const inner = el('div', { class: 's01-mock-inner' }, anim)
    const mock = el('figure', { class: 's01-mock' }, inner)
    root.append(el('div', { class: 's01-copy' }, brand, title.el, sub, source), mock)
    this.els = { brand, title, sub, source, mock, inner, anim, beam }
    this.parallax = Parallax([{ el: inner, depth: .35 }], { pointer: 18, scroll: 0 })
    gsap.set([brand, sub, source], { opacity: 0 })
    gsap.set(anim, { opacity: 0 })
  },
  preload(ctx) { return ctx.assets.preload([MOCK], 1600) },
  enter(ctx) {
    const { brand, title, sub, source, anim, inner, beam } = this.els
    this.tl?.kill(); this.loop?.kill(); this.drift?.kill()
    const tl = gsap.timeline()
    tl.add(Stagger([brand], { dur: T[4], y: 8 }), .1)
    tl.fromTo(anim, { opacity: 0, y: 40, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: sec(T[6]), ease: 'out-expo' }, .3)
    tl.add(() => title.restart(), .5)
    tl.add(Stagger([sub, source], { dur: T[4], y: 10, delay: 140 }), 1.5)
    this.tl = tl
    if (!prefersReduced()) {
      this.drift = gsap.to(inner.querySelector('img'), { y: -8, duration: 5, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      this.loop = gsap.fromTo(beam, { top: '-4%', opacity: .35 }, { top: '104%', duration: 7, ease: 'none', repeat: -1, repeatDelay: 2, delay: 1.5 })
    }
    this.parallax.start()
  },
  leave() { this.tl?.kill(); this.loop?.kill(); this.drift?.kill(); this.parallax.stop() },
}
