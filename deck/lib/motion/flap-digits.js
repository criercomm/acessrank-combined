// FlapDigits(el, {value, digits, clack:true, dur:t-4}) — dígitos split-flap con cascada y clack.
// Empieza vacío: ninguna cifra aparece "de golpe". set(v) anima hacia v; play() anima hacia value.
import { prefersReduced, el } from '../util/dom.js'
import { T } from './ease.js'
const DIGITS = '0123456789'
export function FlapDigits(root, { value = '', digits = 0, clack = true, dur = T[4], flip = T[1], cascade = 60, sound = null, onComplete } = {}) {
  root.classList.add('flap-digits')
  root.textContent = ''
  const reduced = prefersReduced()
  const str = String(value)
  const n = Math.max(digits, str.length)
  const padded = str.padStart(n, ' ')
  const cells = []
  for (let i = 0; i < n; i++) {
    const ch = padded[i]
    const isDigit = DIGITS.includes(ch) || ch === ' '
    const cell = el('div', { class: 'flap' + (isDigit ? '' : ' is-static'), 'aria-hidden': 'true' })
    if (isDigit) {
      const top = el('div', { class: 'half top' }, el('span', { text: ' ' }))
      const bottom = el('div', { class: 'half bottom' }, el('span', { text: ' ' }))
      const leaf = el('div', { class: 'leaf' }, el('div', { class: 'face front' }, el('span', { text: ' ' })), el('div', { class: 'face back' }, el('span', { text: ' ' })))
      cell.append(top, bottom, leaf)
      cells.push({ cell, top, bottom, leaf, cur: ' ', isDigit: true })
    } else { cell.textContent = ch; cell.style.opacity = '0'; cells.push({ cell, isDigit: false }) }
    root.append(cell)
  }
  root.setAttribute('aria-label', str)
  const glyph = (c) => (c === ' ' ? ' ' : c)
  function setFaces(c, curCh, nextCh) {
    c.top.firstChild.textContent = glyph(nextCh)
    c.bottom.firstChild.textContent = glyph(curCh)
    c.leaf.children[0].firstChild.textContent = glyph(curCh)
    c.leaf.children[1].firstChild.textContent = glyph(nextCh)
  }
  function flipOnce(c, nextCh, final) {
    return new Promise((res) => {
      setFaces(c, c.cur, nextCh)
      const a = c.leaf.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }], { duration: flip, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' })
      if (clack && sound) sound.play(final ? 'clack' : 'clack-soft', { gain: final ? 1 : .35, rate: .94 + Math.random() * .12, throttle: 20 })
      a.onfinish = () => { c.cur = nextCh; setFaces(c, nextCh, nextCh); a.cancel(); res() }
    })
  }
  async function runCell(c, target) {
    if (!c.isDigit) {
      const a = c.cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T[2], fill: 'forwards', easing: 'ease-out' })
      a.onfinish = () => { c.cell.style.opacity = '1'; a.cancel() }
      return
    }
    if (c.cur === target) return
    if (reduced) { c.cur = target; setFaces(c, target, target); return }
    const steps = Math.max(3, Math.round(dur / flip))
    const t = target === ' ' ? 0 : DIGITS.indexOf(target)
    const seq = []
    for (let i = 0; i < steps; i++) seq.push(DIGITS[(((t - (steps - 1 - i)) % 10) + 10) % 10])
    seq[seq.length - 1] = target
    for (let i = 0; i < seq.length; i++) await flipOnce(c, seq[i], i === seq.length - 1)
  }
  async function set(v) {
    const s = String(v).padStart(cells.length, ' ')
    root.setAttribute('aria-label', s.trim())
    await Promise.all(cells.map((c, i) => new Promise((r) => setTimeout(() => runCell(c, s[i]).then(r), i * cascade))))
    onComplete?.()
  }
  return { root, set, play: () => set(str), cells }
}
