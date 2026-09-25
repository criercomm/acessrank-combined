// S11 — Libraries (V3 teaser, JP). Second market for the same engine: public libraries under ADA Title II.
// Left: eyebrow, title, lede, three stat tiles. Right: a code-drawn library catalog with three failures marked.
// Bottom: platforms (names in text only) and the three annual plans from accessrankforlibraries. No images, no credits.
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, label, tile } from '../components/ui.js'

export default {
  id: 's11', title: 'Libraries', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s11
    this._notes = C.notes
    const eyebrow = label(C.eyebrow, 's11-eyebrow')
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s11-title' })
    const lede = el('p', { class: 's11-lede', text: C.lede })
    const stats = C.stats.map((s) => tile(s, { sound, size: 'm' }))
    // the catalog mock
    const K = C.catalog
    const rows = K.items.map((it, i) => el('div', { class: 'lib-row' }, el('i', { class: 'lib-cover', 'data-i': i }), el('div', { class: 'lib-meta' }, el('b', { text: it.title }), el('span', { text: it.author })), el('span', { class: 'lib-status' + (it.status === 'Available' ? ' is-ok' : ''), text: it.status }), el('span', { class: 'lib-btn', text: K.cta })))
    const form = el('div', { class: 'lib-form' }, el('b', { text: K.form.title }), ...K.form.fields.map((f) => el('span', { class: 'lib-input', text: f })), el('span', { class: 'lib-btn lib-btn--y', text: K.form.cta }))
    const marks = C.findings.map((f) => el('div', { class: 'mark', style: { left: f.at.x + '%', top: f.at.y + '%' }, 'data-side': f.at.x > 60 ? 'left' : 'right', 'aria-hidden': 'true' }, el('b', { class: 'mono', text: String(f.n) }), el('span', { class: 'mark-label mono', text: f.label })))
    const mock = el('div', { class: 'lib', 'aria-label': 'A fictional library catalog used to show typical failures' },
      el('div', { class: 'lib-head' }, el('span', { class: 'lib-name', text: K.name }), el('span', { class: 'lib-search', text: K.search })),
      el('div', { class: 'lib-list' }, ...rows), form, ...marks)
    const platforms = el('div', { class: 's11-platforms' }, label(C.platformsLabel), ...C.platforms.map((p) => el('span', { class: 'chip label', text: p })))
    const flaps = []
    const plans = C.plans.map((p) => {
      const price = el('span', { class: 'lp-price mono' })
      flaps.push(FlapDigits(price, { value: p.price, clack: true, dur: T[4], sound }))
      return el('div', { class: 'lp' }, label(p.name, 'lp-name'), el('div', { class: 'lp-row' }, price, el('span', { class: 'lp-unit mono', text: p.unit })), el('span', { class: 'lp-who', text: p.who }))
    })
    const site = el('span', { class: 's11-site label', text: C.site })
    root.append(el('div', { class: 's11-copy' }, eyebrow, title.el, lede, el('div', { class: 's11-stats' }, ...stats.map((s) => s.el))), mock, el('div', { class: 's11-bottom' }, platforms, el('div', { class: 's11-plans' }, ...plans), site))
    this.els = { eyebrow, title, lede, stats, mock, marks, platforms, plans, flaps, site }
    gsap.set([eyebrow, lede, ...stats.map((s) => s.el), mock, platforms, ...plans, site], { opacity: 0 })
    marks.forEach((m) => m.classList.remove('is-red'))
  },
  enter(ctx) {
    const { eyebrow, title, lede, stats, mock, marks, platforms, plans, flaps, site } = this.els
    this.tl?.kill()
    marks.forEach((m) => m.classList.remove('is-red'))
    const tl = gsap.timeline()
    tl.add(Stagger([eyebrow], { dur: T[4], y: 8 }), .1)
    tl.add(() => title.restart(), .3)
    tl.add(Stagger([lede], { dur: T[4], y: 8 }), 1.2)
    tl.add(Stagger([mock], { dur: T[5], y: 24, scale: .97 }), .6)
    marks.forEach((m, i) => tl.add(() => { m.classList.add('is-red'); if (!prefersReduced()) gsap.fromTo(m, { scale: 0 }, { scale: 1, duration: sec(T[3]), ease: ease('out-back') }); ctx.sound.play('tick', { gain: .7, rate: 1.1 }) }, 1.6 + i * .3))
    tl.add(Stagger(stats.map((s) => s.el), { dur: T[4], y: 12, delay: 110, from: 'start' }), 1.5)
    stats.forEach((s, i) => tl.add(() => s.play(), 1.7 + i * .2))
    tl.add(Stagger([platforms], { dur: T[4], y: 8 }), 2.4)
    tl.add(Stagger(plans, { dur: T[4], y: 10, delay: 120, from: 'start' }), 2.6)
    flaps.forEach((f, i) => tl.add(() => f.play(), 2.8 + i * .18))
    tl.add(Stagger([site], { dur: T[4], y: 6 }), 3.2)
    this.tl = tl
  },
  leave() { this.tl?.kill() },
}
