// TypedDiff(el, {file, lines}) — a code diff typed character by character in mono: [kind, text] with kind ctx | del | add.
// Returns a GSAP timeline (paused) so the scene decides when it runs; reduced-motion renders the final state at once.
import { gsap, sec } from '@lib/motion/ease.js'
import { el, prefersReduced } from '@lib/util/dom.js'
export function TypedDiff(root, { file = '', lines = [], cps = 55, sound = null } = {}) {
  root.classList.add('diff', 'mono')
  root.textContent = ''
  if (file) root.append(el('div', { class: 'diff-file label', text: file }))
  const rows = lines.map(([kind, text]) => {
    const row = el('div', { class: 'diff-row is-' + kind }, el('span', { class: 'diff-sign', text: kind === 'add' ? '+' : kind === 'del' ? '−' : ' ' }), el('span', { class: 'diff-text' }))
    root.append(row)
    return { row, text, kind, span: row.lastChild }
  })
  const tl = gsap.timeline({ paused: true })
  if (prefersReduced()) { rows.forEach((r) => { r.span.textContent = r.text; r.row.classList.add('is-on') }); return tl }
  let t = 0
  for (const r of rows) {
    tl.add(() => r.row.classList.add('is-on'), t)
    if (r.kind === 'ctx' || r.kind === 'del') { tl.add(() => { r.span.textContent = r.text }, t); t += .12; continue }
    // added lines are the ones that get typed
    const n = r.text.length
    const o = { i: 0 }
    tl.to(o, { i: n, duration: n / cps, ease: 'none', onUpdate: () => { const k = Math.round(o.i); if (k !== r.span.textContent.length) { r.span.textContent = r.text.slice(0, k); sound?.play('tick', { gain: .5, rate: 1.4, throttle: 30 }) } } }, t)
    t += n / cps + .14
  }
  tl.finish = () => { tl.progress(1); rows.forEach((r) => { r.span.textContent = r.text; r.row.classList.add('is-on') }) }
  tl.reset = () => { tl.pause(0); rows.forEach((r) => { r.span.textContent = ''; r.row.classList.remove('is-on') }) }
  return tl
}
