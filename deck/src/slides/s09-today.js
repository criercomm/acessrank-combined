// S09 — Real, today. Engineering numbers (flap tiles), traction tiles that show TBD until JP fills copy.js, and
// "How it is built": the operating model instead of the team (Carlos, 2026-09-15: team members are not revealed).
import { gsap, T } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { el } from '@lib/util/dom.js'
import { heading, tile, label, tbd } from '../components/ui.js'

export default {
  id: 's09', title: 'Today', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, sound } = ctx
    const C = copy.s09
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s09-title' })
    const eng = C.eng.map((t) => tile(t, { sound, size: 'm' }))
    const traction = C.traction.map((t) => t.value ? tile(t, { sound, size: 'm' }) : { el: el('div', { class: 'tile tile--m is-tbd' }, tbd(C.tbd), el('p', { class: 'tile-label', text: t.label })), play() {} })
    const team = C.built.map((m) => el('div', { class: 'member' }, el('b', { class: 'member-name', text: m.name }), el('span', { class: 'member-role label', text: m.role }), el('p', { class: 'member-line', text: m.line })))
    root.append(
      el('div', { class: 's09-copy' }, title.el),
      el('div', { class: 's09-block s09-eng' }, label(C.engLabel), el('div', { class: 's09-tiles' }, ...eng.map((t) => t.el))),
      el('div', { class: 's09-block s09-traction' }, label(C.tractionLabel), el('div', { class: 's09-tiles' }, ...traction.map((t) => t.el))),
      el('div', { class: 's09-block s09-team' }, label(C.builtLabel), el('div', { class: 's09-members' }, ...team)))
    this.els = { title, eng, traction, team }
    gsap.set([...eng.map((t) => t.el), ...traction.map((t) => t.el), ...team], { opacity: 0 })
  },
  enter() {
    const { title, eng, traction, team } = this.els
    this.tl?.kill()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    tl.add(Stagger(eng.map((t) => t.el), { dur: T[4], y: 12, delay: 90, from: 'start' }), .7)
    eng.forEach((t, i) => tl.add(() => t.play(), .9 + i * .18))
    tl.add(Stagger(traction.map((t) => t.el), { dur: T[4], y: 12, delay: 90, from: 'start' }), 1.5)
    traction.forEach((t, i) => tl.add(() => t.play(), 1.7 + i * .18))
    tl.add(Stagger(team, { dur: T[4], y: 12, delay: 120, from: 'start' }), 2.2)
    this.tl = tl
  },
  leave() { this.tl?.kill() },
}
