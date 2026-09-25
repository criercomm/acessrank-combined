// Presenter(copy, {total}) — presenter panel (?presenter=1) on JP's screen only: current scene, next, talking point,
// clock, elapsed time and the short-path hint. Never shown on the audience screen (open that window without the parameter).
import { el, pad2 } from '@lib/util/dom.js'
export function Presenter(copy, { total = 10, short = [] } = {}) {
  const chapters = copy.chapters || []
  const noteOf = (i) => copy[`s${pad2(i + 1)}`]?.notes || ''
  const now = el('div', { class: 'pr-now' }, el('span', { class: 'label' }, 'Now'), el('b', { class: 'pr-num' }), el('span', { class: 'pr-name' }))
  const next = el('div', { class: 'pr-next' }, el('span', { class: 'label' }, 'Next'), el('b', { class: 'pr-num' }), el('span', { class: 'pr-name' }))
  const note = el('p', { class: 'pr-note' })
  const clock = el('span', { class: 'pr-clock mono' })
  const elapsed = el('span', { class: 'pr-elapsed mono' })
  const shortHint = el('span', { class: 'pr-short label' })
  const root = el('aside', { class: 'presenter', 'aria-label': 'Presenter view' }, el('div', { class: 'pr-head' }, now, next), note, el('div', { class: 'pr-time' }, clock, shortHint, elapsed))
  document.body.append(root)
  let t0 = null
  function tick() {
    const d = new Date()
    clock.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    if (t0 != null) { const s = Math.floor((Date.now() - t0) / 1000); elapsed.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)} elapsed` } else elapsed.textContent = 'Timer starts on first advance'
  }
  tick(); setInterval(tick, 1000)
  function update(i) {
    if (i > 0 && t0 == null) t0 = Date.now()
    now.querySelector('.pr-num').textContent = `${pad2(i + 1)} / ${pad2(total)}`
    now.querySelector('.pr-name').textContent = chapters[i] || ''
    const n = i + 1 < total
    next.hidden = !n
    if (n) { next.querySelector('.pr-num').textContent = pad2(i + 2); next.querySelector('.pr-name').textContent = chapters[i + 1] || '' }
    note.textContent = noteOf(i)
    shortHint.textContent = short.length ? (short.includes(i + 1) ? 'On the 3-minute path' : 'Skip on the 3-minute path') : ''
    tick()
  }
  return { el: root, update }
}
