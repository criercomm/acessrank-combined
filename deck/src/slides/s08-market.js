// S08 — Start where the lawsuits are (V2, national). Two ranked lists with bars from the same 2025 report: lawsuits by state
// and by market (industry), counts in flap digits; then the two expansion rails (platforms, standards) draw in.
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, label } from '../components/ui.js'

function ranked(items, { sound, cls }) {
  const max = Math.max(...items.map((i) => i.n))
  const rows = items.map((it, i) => {
    const num = el('span', { class: 'rk-num mono' })
    const flap = FlapDigits(num, { value: it.n.toLocaleString('en-US'), digits: 5, clack: false, dur: T[3], sound })
    const row = el('div', { class: 'rk-row' + (it.name.startsWith('All other') ? ' is-rest' : '') },
      el('b', { class: 'rk-rank mono', text: String(i + 1).padStart(2, '0') }),
      el('span', { class: 'rk-name', text: it.name }),
      el('span', { class: 'rk-track' }, el('i', { class: 'rk-fill', style: { '--p': (it.n / max).toFixed(3) } })),
      num)
    return { row, flap, fill: row.querySelector('.rk-fill') }
  })
  return { el: el('div', { class: 'rk ' + cls }, ...rows.map((r) => r.row)), rows }
}

export default {
  id: 's08', title: 'Market', transition: 'zoom',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s08
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s08-title' })
    const states = ranked(C.states, { sound, cls: 'rk--states' })
    const industries = ranked(C.industries, { sound, cls: 'rk--industries' })
    const colA = el('div', { class: 's08-col' }, label(C.statesLabel), states.el, label(C.statesSource, 'rk-source'))
    const colB = el('div', { class: 's08-col' }, label(C.industriesLabel), industries.el, label(C.industriesSource, 'rk-source'))
    const rails = C.rails.map((r) => {
      const steps = r.steps.map((s, i) => el('span', { class: 'rail-step' + (i === 0 ? ' is-now' : ''), text: s }))
      return el('div', { class: 'rail' }, label(r.label, 'rail-label'), el('div', { class: 'rail-track' }, el('i', { class: 'rail-line' }), ...steps))
    })
    root.append(el('div', { class: 's08-copy' }, title.el), el('div', { class: 's08-cols' }, colA, colB), el('div', { class: 's08-rails' }, ...rails))
    this.els = { title, states, industries, colA, colB, rails }
    gsap.set([colA, colB, ...rails], { opacity: 0 })
  },
  enter(ctx) {
    const { title, states, industries, colA, colB, rails } = this.els
    this.tl?.kill()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .3)
    tl.add(Stagger([colA, colB], { dur: T[5], y: 16, delay: 160 }), 1)
    ;[states, industries].forEach((list, k) => list.rows.forEach((r, i) => {
      const at = 1.2 + k * .25 + i * .09
      tl.add(() => r.flap.play(), at)
      if (prefersReduced()) tl.set(r.fill, { scaleX: Number(r.fill.style.getPropertyValue('--p')) }, at)
      else tl.fromTo(r.fill, { scaleX: 0 }, { scaleX: Number(r.fill.style.getPropertyValue('--p')), duration: sec(T[5]), ease: ease('out-expo') }, at)
      tl.add(() => ctx.sound.play('tick', { gain: .5, rate: 1 + i * .03, throttle: 40 }), at)
    }))
    tl.add(Stagger(rails, { dur: T[5], y: 16, delay: 200, from: 'start' }), 2.4)
    rails.forEach((r, k) => {
      const line = r.querySelector('.rail-line'), steps = r.querySelectorAll('.rail-step')
      if (prefersReduced()) { tl.set(line, { scaleX: 1 }, 2.6); steps.forEach((s) => s.classList.add('is-in')); return }
      tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: sec(T[6]), ease: ease('out-expo') }, 2.6 + k * .3)
      steps.forEach((s, i) => tl.add(() => { s.classList.add('is-in') }, 2.7 + k * .3 + i * .16))
    })
    this.tl = tl
  },
  leave() { this.tl?.kill() },
}
