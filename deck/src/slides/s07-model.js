// S07 — Pay for results, not promises. The three plans from accessrank.ai as cards (prices in flap digits, Growth with the
// yellow keyline), the lawsuit-response lane, and the honest "today / next" line about billing.
import { gsap, T } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el } from '@lib/util/dom.js'
import { heading, label } from '../components/ui.js'

export default {
  id: 's07', title: 'Model', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s07
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s07-title' })
    const flaps = []
    const cards = C.plans.map((p) => {
      const once = el('div', { class: 'plan-price mono' })
      flaps.push(FlapDigits(once, { value: p.once, clack: true, dur: T[4], sound }))
      const monthly = p.monthly ? el('p', { class: 'plan-monthly mono' }, 'then ', el('b', { text: p.monthly }), '/mo') : el('p', { class: 'plan-monthly mono', text: 'onboarding scoped per store' })
      return el('div', { class: 'plan' + (p.tag ? ' is-featured' : ''), 'data-hotspot': '' },
        el('div', { class: 'plan-head' }, label(p.name, 'plan-name'), p.tag ? el('span', { class: 'plan-tag label', text: p.tag }) : null),
        once, el('p', { class: 'plan-once label', text: 'one-time onboarding' }), monthly,
        el('p', { class: 'plan-who', text: p.who }),
        el('ul', { class: 'plan-items' }, ...p.items.map((i) => el('li', { text: i }))),
        el('p', { class: 'plan-time label', text: p.time }))
    })
    const expressPrice = el('span', { class: 'express-price mono' })
    flaps.push(FlapDigits(expressPrice, { value: C.express.price, clack: true, dur: T[4], sound }))
    const express = el('div', { class: 'express' }, el('div', { class: 'express-head' }, label(C.express.name, 'express-name'), expressPrice), el('p', { class: 'express-line', text: C.express.line }))
    const honest = el('div', { class: 's07-honest' }, el('p', { class: 'mono' }, el('b', { text: C.today })), el('p', { class: 'mono', text: C.next }))
    root.append(el('div', { class: 's07-copy' }, title.el, honest), el('div', { class: 's07-right' }, el('div', { class: 's07-plans' }, ...cards), express))
    this.els = { title, cards, express, honest, flaps }
    gsap.set([...cards, express, honest], { opacity: 0 })
  },
  enter() {
    const { title, cards, express, honest, flaps } = this.els
    this.tl?.kill()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    tl.add(Stagger(cards, { dur: T[5], y: 20, delay: 120, from: 'start' }), .7)
    flaps.forEach((f, i) => tl.add(() => f.play(), 1 + i * .18))
    tl.add(Stagger([express], { dur: T[4], y: 12 }), 1.6)
    tl.add(Stagger([honest], { dur: T[4], y: 8 }), 2.1)
    this.tl = tl
  },
  leave() { this.tl?.kill() },
}
