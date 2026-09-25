// S10 — The ask. Statement, the raise line ($600K), five use-of-funds buckets that fill (share and dollars, with what each
// covers underneath — grouped from Carlos's 8-line plan of 2026-09-16), the milestone rail and the closing line.
// The scanner beam from S04 runs faintly across the background.
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, label, brandMark } from '../components/ui.js'

export default {
  id: 's10', title: 'The ask', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s10
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s10-title' })
    const ask = el('p', { class: 's10-ask', text: C.ask })
    // one list item per bucket: label, share and dollars as text (the bar itself is decoration, aria-hidden), detail below
    const bars = C.uses.map((u) => {
      const pct = el('span', { class: 'bar-pct mono' })
      const amt = u.amount ? el('span', { class: 'bar-amt mono' }) : null
      // no digits padding: "7%" padded to 3 drew an empty tile before the 7; the column is right-aligned by CSS
      const flap = FlapDigits(pct, { value: u.pct + '%', clack: true, dur: T[4], sound })
      const flapAmt = amt ? FlapDigits(amt, { value: u.amount, clack: false, dur: T[4] }) : null
      const item = el('li', { class: 'bar' },
        el('div', { class: 'bar-head' }, el('span', { class: 'bar-label', text: u.label }), el('span', { class: 'bar-vals' }, pct, amt)),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, el('i', { class: 'bar-fill', style: { '--p': u.pct / 100 } })),
        u.detail ? el('p', { class: 'bar-detail', text: u.detail }) : null)
      return { el: item, flap, flapAmt }
    })
    const miles = C.milestones.map((m) => el('div', { class: 'mile' }, el('b', { class: 'mono', text: m.when }), el('span', { text: m.what })))
    const close = heading(C.close, { tag: 'p', cls: 'h-display s10-close', accent: 1, accentClass: 'is-accent' })
    const beam = el('div', { class: 'beam beam--bg', 'aria-hidden': 'true' })
    root.append(beam,
      el('div', { class: 's10-copy' }, title.el, ask),
      el('div', { class: 's10-uses' }, label(C.usesLabel), el('ul', { class: 's10-bars', role: 'list' }, ...bars.map((b) => b.el))),
      el('div', { class: 's10-miles' }, label(C.milestonesLabel), ...miles),
      el('div', { class: 's10-end' }, close.el, brandMark('s10-brand')))
    this.els = { title, ask, bars, miles, close, beam }
    gsap.set([ask, ...bars.map((b) => b.el), ...miles], { opacity: 0 })
    gsap.set(close.el, { opacity: 0 })
  },
  enter(ctx) {
    const { title, ask, bars, miles, close, beam } = this.els
    this.tl?.kill(); this.loop?.kill()
    ctx.deck.root.classList.add('is-close')
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    tl.add(Stagger([ask], { dur: T[4], y: 8 }), .9)
    tl.add(Stagger(bars.map((b) => b.el), { dur: T[4], y: 10, delay: 100, from: 'start' }), 1.2)
    bars.forEach((b, i) => {
      tl.add(() => { b.flap.play(); b.flapAmt?.play() }, 1.4 + i * .16)
      const fill = b.el.querySelector('.bar-fill')
      if (prefersReduced()) tl.set(fill, { scaleX: 'var(--p)' }, 1.4)
      else tl.fromTo(fill, { scaleX: 0 }, { scaleX: Number(fill.style.getPropertyValue('--p')), duration: sec(T[5]), ease: ease('out-expo') }, 1.4 + i * .16)
    })
    tl.add(Stagger(miles, { dur: T[4], y: 10, delay: 120, from: 'start' }), 2.2)
    tl.set(close.el, { opacity: 1 }, 3)
    tl.add(() => close.restart(), 3)
    this.tl = tl
    if (!prefersReduced()) this.loop = gsap.fromTo(beam, { top: '-4%' }, { top: '104%', duration: 9, ease: 'none', repeat: -1, delay: 1 })
  },
  leave(ctx) { ctx.deck.root.classList.remove('is-close'); this.tl?.kill(); this.loop?.kill() },
}
