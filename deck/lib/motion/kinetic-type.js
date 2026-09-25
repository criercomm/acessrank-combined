// KineticType(el, {per:'char'|'word', axis:'wght'|'wdth', dur:t-4}) — peso variable 300→(to) + opacity, por letra/palabra.
import { gsap, ease, sec, T } from './ease.js'
import { prefersReduced } from '../util/dom.js'
export function KineticType(el, { per = 'char', axis = 'wght', from = 300, to = 600, dur = T[4], delay = 40, ease: e = 'out-expo', y = 8, paused = true, onComplete } = {}) {
  if (!el.dataset.ktText) el.dataset.ktText = el.textContent.replace(/\s+/g, ' ').trim()
  const text = el.dataset.ktText
  el.setAttribute('aria-label', text)
  el.classList.add('kt')
  el.textContent = ''
  const units = []
  const words = text.split(' ')
  words.forEach((w, wi) => {
    const wEl = document.createElement('span')
    wEl.className = 'kt-word'
    wEl.setAttribute('aria-hidden', 'true')
    if (per === 'word') { wEl.textContent = w; units.push(wEl) }
    else for (const ch of w) { const c = document.createElement('span'); c.className = 'kt-char'; c.textContent = ch; wEl.append(c); units.push(c) }
    // separación entre palabras por margen (.kt-word), no por nodos de texto: los inline-block + transforms
    // dejaban espacios desplazados en el DOM ("front door" → "frontdoor")
    el.append(wEl)
  })
  const prop = axis === 'wdth' ? '--wdth' : '--wght'
  const tl = gsap.timeline({ paused, onComplete })
  if (prefersReduced()) tl.set(units, { opacity: 1, y: 0, [prop]: to })
  else tl.fromTo(units, { opacity: 0, y, [prop]: from }, { opacity: 1, y: 0, [prop]: to, duration: sec(dur), ease: ease(e), stagger: sec(delay) })
  tl.units = units
  return tl
}
