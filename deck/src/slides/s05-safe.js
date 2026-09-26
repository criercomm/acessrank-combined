// S05 — Safe enough for a live store. Six guardrails as a drawn flow (hairline + nodes, stroke draws in) with a hotspot rail;
// nodes sit exactly above their hotspot (layout measured in pixels, no SVG stretch). Each hotspot lights its node and shows
// the line. Below, the three people of the loop as back-view silhouettes.
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading } from '../components/ui.js'

const NS = 'http://www.w3.org/2000/svg'
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
const PEOPLE = ['operator', 'client', 'shopper']
const H = 72
export default {
  id: 's05', title: 'Safe', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, assets } = ctx
    const C = copy.s05
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s05-title' })
    const flow = svg('svg', { viewBox: `0 0 1000 ${H}`, class: 'flow', 'aria-hidden': 'true' })
    const line = svg('path', { d: `M 20 ${H / 2} H 980`, class: 'flow-line' })
    flow.append(line)
    const nodes = C.steps.map((s, i) => {
      const g = svg('g', { class: 'flow-node', 'data-id': s.id })
      g.append(svg('circle', { r: 14, class: 'flow-dot' }), svg('circle', { r: 26, class: 'flow-halo' }), svg('text', { y: 4, class: 'flow-num', 'text-anchor': 'middle' }))
      g.querySelector('text').textContent = String(i + 1)
      flow.append(g)
      return g
    })
    const hotspots = C.steps.map((s, i) => el('button', { class: 'hotspot', type: 'button', 'data-hotspot': '', 'data-id': s.id, text: s.label, onclick: (e) => { e.stopPropagation(); this.select(i, true) }, onpointerenter: () => this.select(i) }))
    const lines = C.steps.map((s) => el('p', { class: 's05-line', text: s.line }))
    const steps = hotspots.map((h, i) => el('div', { class: 's05-step' }, h, lines[i]))
    const rail = el('div', { class: 'hotspots s05-rail' }, ...steps)
    const railwrap = el('div', { class: 's05-railwrap' }, rail)
    const people = C.people.map((p) => el('figure', { class: 's05-person', 'data-id': p.id }, assets.img(`dR-s05-silhouette-${p.id}`, { w: 800, sizes: '12vw', alt: `${p.label}, seen from behind` }), el('figcaption', {}, el('b', { class: 'label', text: p.label }), el('span', { text: p.line }))))
    root.append(el('div', { class: 's05-copy' }, title.el), el('div', { class: 's05-flow' }, flow, railwrap), el('div', { class: 's05-people' }, ...people))
    this.els = { title, flow, line, nodes, hotspots, rail, lines, people }
    this.C = C
    gsap.set([...hotspots, ...lines, ...people], { opacity: 0 })
    this.i = -1
    // pixel layout: viewBox = real width; each node centred over its hotspot
    this.layout = () => {
      const w = Math.max(1, flow.clientWidth)
      flow.setAttribute('viewBox', `0 0 ${w} ${H}`)
      const rr = rail.getBoundingClientRect()
      const xs = hotspots.map((h) => { const r = h.getBoundingClientRect(); return r.left - rr.left + r.width / 2 })
      nodes.forEach((g, i) => g.setAttribute('transform', `translate(${xs[i].toFixed(1)} ${H / 2})`))
      line.setAttribute('d', `M ${xs[0].toFixed(1)} ${H / 2} H ${xs[xs.length - 1].toFixed(1)}`)
      const len = line.getTotalLength()
      line.style.strokeDasharray = len
      if (!this._drawn) line.style.strokeDashoffset = len
      return len
    }
    addEventListener('resize', this.layout)
  },
  preload(ctx) { return ctx.assets.preload(PEOPLE.map((p) => `dR-s05-silhouette-${p}`), 800) },
  select(i, click = false) {
    const { nodes, hotspots, lines } = this.els
    if (i === this.i) return
    this.i = i
    nodes.forEach((g, k) => g.classList.toggle('is-on', k === i))
    hotspots.forEach((h, k) => h.classList.toggle('is-active', k === i))
    lines.forEach((l, k) => l.classList.toggle('is-active', k === i))
    if (click) this.ctxSound?.play('blip', { gain: .4 })
  },
  enter(ctx) {
    const { title, line, nodes, hotspots, lines, people } = this.els
    this.ctxSound = ctx.sound
    this.tl?.kill(); this.i = -1; this._drawn = false
    hotspots.forEach((h) => h.classList.remove('is-active'))
    nodes.forEach((g) => g.classList.remove('is-on', 'is-in'))
    // hotspots must be measurable before the nodes can sit above them: they are opacity 0, not hidden
    const len = this.layout()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    if (prefersReduced()) tl.set(line, { strokeDashoffset: 0 }, .5)
    else tl.fromTo(line, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: sec(T[6]), ease: ease('out-expo') }, .6)
    tl.add(() => { this._drawn = true }, .6)
    nodes.forEach((g, i) => tl.add(() => { g.classList.add('is-in'); ctx.sound.play('tick', { gain: .7, rate: 1 + i * .04 }) }, .7 + i * .16))
    tl.add(Stagger(hotspots, { dur: T[4], y: 8, delay: 60, from: 'start' }), 1.2)
    tl.add(Stagger(lines, { dur: T[4], y: 8, delay: 60, from: 'start' }), 1.35)
    tl.add(Stagger(people, { dur: T[5], y: 24, scale: .96, delay: 120 }), 1.6)
    tl.add(() => this.select(0), 1.2)
    this.tl = tl
  },
  next() { if (this.i < this.els.hotspots.length - 1) { this.select(this.i + 1, true); return true } return false },
  prev() { if (this.i > 0) { this.select(this.i - 1, true); return true } return false },
  leave() { this.tl?.kill() },
}
