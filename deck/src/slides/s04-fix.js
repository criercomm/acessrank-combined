// S04 — SIGNATURE · "The store that fixes itself". A code-drawn storefront; four internal advances:
//   1 Scan      the beam sweeps, seven markers pop on real failures, the counter flaps to 47, the score ring draws 41 (red)
//   2 Findings  the store slides left; one finding with its evidence (rule, criterion, selector, measured contrast, grade)
//   3 Fix       the evidence turns into the actual Liquid/CSS diff typed live on a draft theme; approved; markers turn yellow
//   4 Validate  the beam sweeps again; markers turn green and dissolve; 47 → 0 remaining; ring 41 → 96; Rollback appears.
//   Hovering Rollback brings everything back (red markers, 47, score 41) and releases on leave: the undo exists, wordlessly.
import { gsap, T, sec, ease } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { FlapDigits } from '@lib/motion/flap-digits.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, label } from '../components/ui.js'
import { Storefront } from '../components/storefront.js'
import { ScoreRing } from '../components/ring.js'
import { TypedDiff } from '../components/typed.js'

const PRODUCTS = ['sneaker', 'headphones', 'skincare', 'candle', 'sweater', 'wallet']
export default {
  id: 's04', title: 'The fix', transition: 'wipe',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy, assets, sound, mobile } = ctx
    const C = copy.s04
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-statement s04-title' })
    const store = Storefront(C.store, assets, { mobile })
    const beam = el('div', { class: 'beam', 'aria-hidden': 'true' })
    store.page.append(beam)
    const markers = C.findings.map((f) => el('div', { class: 'mark', 'data-key': f.key, 'aria-hidden': 'true' }, el('b', { class: 'mono', text: String(f.n) }), el('span', { class: 'mark-label mono' }, `${f.label}`, el('i', { text: ' · ' + f.wcag }))))
    markers.forEach((m) => store.page.append(m))
    // right panel: stage pills, counter, ring
    const pills = C.stages.map((s, i) => el('span', { class: 'pill label', 'data-i': i, text: s }))
    const count = el('div', { class: 'count-num mono' })
    const flap = FlapDigits(count, { value: '', digits: 2, clack: true, dur: T[4], sound })
    const countLabel = el('p', { class: 'count-label', text: C.panel.idle })
    const ring = ScoreRing(el('div'), { size: 168, sound })
    const rollback = el('button', { class: 'rollback mono', type: 'button', 'data-no-advance': '', 'data-hotspot': '', text: C.rollback })
    const panel = el('aside', { class: 's04-panel' }, el('div', { class: 'pills' }, ...pills), el('div', { class: 'count' }, count, countLabel), ring.el, rollback)
    // evidence / diff card (stage 2 and 3)
    const E = C.evidence, D = C.diff
    const evidence = el('div', { class: 'evi' },
      el('div', { class: 'evi-head' }, el('span', { class: 'chip chip--draft label', text: E.chip }), el('span', { class: 'chip chip--grade label', text: E.grade })),
      el('h3', { class: 'evi-title', text: E.title }),
      el('p', { class: 'evi-wcag mono', text: E.wcag }),
      el('dl', { class: 'evi-dl mono' }, el('dt', { text: 'rule' }), el('dd', { text: E.rule }), el('dt', { text: 'selector' }), el('dd', { text: E.selector }), el('dt', { text: 'measured' }), el('dd', { class: 'is-bad', text: E.measured }), el('dt', { text: 'required' }), el('dd', { text: E.required })),
      el('pre', { class: 'evi-html mono', text: E.html }),
      el('ul', { class: 'evi-lines' }, ...E.lines.map((l) => el('li', { text: l }))))
    const diffBox = el('div')
    const diff = TypedDiff(diffBox, { file: D.file, lines: [...D.lines, ['ctx', ''], ...D.css], sound })
    const approve = el('button', { class: 'approve mono', type: 'button', 'data-no-advance': '', text: D.approve })
    const fix = el('div', { class: 'fix' }, diffBox, approve)
    const card = el('div', { class: 'card' }, evidence, fix)
    const storeWrap = el('div', { class: 's04-storewrap' }, store.el)
    const stage = el('div', { class: 's04-stage' }, storeWrap, card)
    root.append(el('div', { class: 's04-copy' }, title.el), stage, panel)
    this.els = { title, store, storeWrap, beam, markers, pills, flap, countLabel, ring, rollback, panel, card, evidence, diff, approve, fix, stage }
    this.C = C
    this.stage = 0
    this.layout = () => {
      markers.forEach((m) => {
        const p = store.positionOf(m.dataset.key)
        m.hidden = !p
        if (!p) return
        m.style.left = p.x + '%'; m.style.top = p.y + '%'; m.dataset.side = p.side
      })
    }
    addEventListener('resize', this.layout)
    // rollback hover: the whole state comes back while the pointer is on it
    rollback.addEventListener('pointerenter', () => this.peek(true))
    rollback.addEventListener('pointerleave', () => this.peek(false))
    rollback.addEventListener('click', () => this.peek(!this._peek))
    approve.addEventListener('click', () => this.approveNow())
    this.reset()
  },
  preload(ctx) { return ctx.assets.preload(PRODUCTS.map((p) => `dR-s01-product-${p}`), 800) },
  reset() {
    const { markers, pills, flap, countLabel, ring, rollback, card, evidence, fix, stage, approve, diff, beam } = this.els
    this.stage = 0; this._peek = false
    this.tl?.kill()
    stage.classList.remove('is-split')
    markers.forEach((m) => { m.className = 'mark' })
    gsap.set(markers, { clearProps: 'all' })
    pills.forEach((p) => p.classList.remove('is-on', 'is-done'))
    flap.set('  '); countLabel.textContent = this.C.panel.idle
    ring.reset()
    gsap.set(rollback, { opacity: 0, pointerEvents: 'none' })
    gsap.set(card, { opacity: 0 })
    evidence.hidden = false; fix.hidden = true
    approve.textContent = this.C.diff.approve; approve.classList.remove('is-done')
    diff.reset()
    gsap.set(beam, { top: '-4%', opacity: 0 })
  },
  enter(ctx) {
    const { title, store, storeWrap, panel } = this.els
    this.reset()
    this.layout()
    this.tl?.kill()
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .2)
    tl.add(Stagger([storeWrap], { dur: T[5], y: 24, scale: .98 }), .3)
    tl.add(Stagger([...store.page.children].filter((c) => !c.classList.contains('mark') && !c.classList.contains('beam')), { dur: T[4], y: 12, delay: 60, from: 'start' }), .5)
    tl.add(Stagger([panel], { dur: T[4], y: 12 }), .9)
    this.tl = tl
  },
  // sweep(kind): moves the beam top→bottom; at each marker's y it fires onPass(marker)
  sweep(onPass, { dur = 2200 } = {}) {
    const { beam, markers } = this.els
    const sound = this.ctxSound
    const tl = gsap.timeline()
    const visible = markers.filter((m) => !m.hidden).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    if (prefersReduced()) { visible.forEach((m) => onPass(m)); return tl }
    tl.set(beam, { top: '-4%', opacity: 1 }, 0)
    tl.to(beam, { top: '104%', duration: sec(dur), ease: 'none' }, 0)
    visible.forEach((m) => tl.add(() => { onPass(m); sound?.play('tick', { gain: .8, rate: 1.1, throttle: 40 }) }, sec(dur) * ((parseFloat(m.style.top) + 4) / 108)))
    tl.to(beam, { opacity: 0, duration: .3 }, sec(dur))
    return tl
  },
  setPill(i) { this.els.pills.forEach((p, k) => { p.classList.toggle('is-on', k === i); p.classList.toggle('is-done', k < i) }) },
  next(ctx) {
    const { markers, flap, countLabel, ring, stage, card, evidence, fix, diff, rollback } = this.els
    const C = this.C, sound = ctx.sound
    this.ctxSound = sound
    this.tl2?.kill()
    if (this.stage === 0) { // SCAN
      this.stage = 1; this.setPill(0)
      countLabel.textContent = C.panel.scanning
      const tl = gsap.timeline()
      tl.add(this.sweep((m) => { m.classList.add('is-red'); gsap.fromTo(m, { scale: 0 }, { scale: 1, duration: sec(T[3]), ease: ease('out-back') }) }), 0)
      tl.add(() => { flap.set(String(C.counts.findings)); countLabel.textContent = C.panel.found }, 2.1)
      tl.add(() => ring.set(C.score.before), 2.4)
      this.tl2 = tl
      return true
    }
    if (this.stage === 1) { // FINDINGS
      this.stage = 2; this.setPill(1)
      stage.classList.add('is-split')
      evidence.hidden = false; fix.hidden = true
      markers.forEach((m) => m.classList.toggle('is-focus', m.dataset.key === 'contrast'))
      this.tl2 = gsap.timeline().add(Stagger([card], { dur: T[5], y: 16, scale: .98 }), .35)
      sound.play('whoosh', { gain: .6 })
      return true
    }
    if (this.stage === 2) { // FIX
      this.stage = 3; this.setPill(2)
      const tl = gsap.timeline()
      tl.to(evidence, { opacity: 0, duration: sec(T[3]) }, 0)
      tl.add(() => { evidence.hidden = true; fix.hidden = false; gsap.set(evidence, { opacity: 1 }) }, sec(T[3]))
      tl.add(Stagger([fix], { dur: T[4], y: 8 }), sec(T[3]))
      tl.add(diff.play(), sec(T[3]) + .2)
      tl.add(() => this.approveNow(), '+=.5')
      this.tl2 = tl
      return true
    }
    if (this.stage === 3) { // VALIDATE
      this.stage = 4; this.setPill(3)
      diff.finish(); this.approveNow(true)
      const tl = gsap.timeline()
      tl.add(this.sweep((m) => { m.classList.remove('is-yellow', 'is-red', 'is-focus'); m.classList.add('is-green'); gsap.to(m, { opacity: 0, scale: .6, duration: sec(T[4]), delay: .5, ease: ease('out-expo') }) }), 0)
      tl.add(() => { flap.set(' 0'); countLabel.textContent = C.panel.done }, 2.1)
      tl.add(() => ring.set(C.score.after), 2.3)
      tl.add(() => sound.play('blip', { gain: .7, rate: .8 }), 2.5)
      tl.add(Stagger([rollback], { dur: T[4], y: 8 }), 2.9)
      tl.set(rollback, { pointerEvents: 'auto' }, 2.9)
      this.tl2 = tl
      return true
    }
    return false
  },
  approveNow(silent = false) {
    const { approve, markers } = this.els
    if (approve.classList.contains('is-done')) return
    approve.classList.add('is-done'); approve.textContent = this.C.diff.approved
    if (!silent) this.ctxSound?.play('blip', { gain: .6 })
    markers.filter((m) => !m.hidden).forEach((m, i) => setTimeout(() => { m.classList.remove('is-red', 'is-focus'); m.classList.add('is-yellow'); if (!silent) this.ctxSound?.play('tick', { gain: .5, rate: 1.3, throttle: 30 }) }, 120 + i * 70))
  },
  // peek(on): the rollback preview — everything returns while the pointer rests on the button
  peek(on) {
    if (this.stage < 4 || this._peek === on) return
    this._peek = on
    const { markers, flap, countLabel, ring, stage, card } = this.els
    const C = this.C
    markers.filter((m) => !m.hidden).forEach((m) => { m.classList.toggle('is-red', on); m.classList.toggle('is-green', !on); gsap.to(m, { opacity: on ? 1 : 0, scale: on ? 1 : .6, duration: sec(T[3]), ease: ease('out-expo') }) })
    flap.set(on ? String(C.counts.findings) : ' 0'); countLabel.textContent = on ? C.panel.found : C.panel.done
    ring.set(on ? C.score.before : C.score.after, { dur: T[4] })
    stage.classList.toggle('is-split', !on)
    gsap.to(card, { opacity: on ? 0 : 1, duration: sec(T[3]) })
    this.ctxSound?.play(on ? 'power-off' : 'power', { gain: .5 })
  },
  prev() { if (this.stage === 0) return false; this.reset(); this.layout(); return true },
  leave() { this.tl?.kill(); this.tl2?.kill() },
}
