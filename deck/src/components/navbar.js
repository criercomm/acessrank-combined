// Navbar — secondary navigation at the bottom, for compact screens (phones, landscape phones, short or portrait windows).
// The desktop chrome keeps the chapter dots at the top left and the legal line in the footer; neither survives a 310 px
// tall viewport, so below the compact breakpoint (see the compact block in src/style.css) both move down here:
// previous · chapter dots · next, with the legal line above them. The dots are real buttons — one per scene, the current
// one carries aria-current — and every target is at least 24 px wide and 40 px tall, which is the point of a deck about
// accessibility. Hidden on desktop, where the top chrome does this job.
import { el } from '@lib/util/dom.js'

const arrow = (d) => `<svg viewBox="0 0 24 12" width="24" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// go(i) salta a la escena i · step(±1) delega en next()/prev() del deck (respeta las escenas con pasos internos, como S05).
export function Navbar({ chapters, legal, go, step, sound = null }) {
  const dots = chapters.map((name, i) => el('button', {
    class: 'nav-dot', type: 'button', 'aria-label': `${i + 1}. ${name}`,
    onclick: (e) => { e.stopPropagation(); sound?.start(); go(i) },
  }, el('i', { 'aria-hidden': 'true' })))
  const mkArrow = (dir, label, path) => el('button', {
    class: 'nav-arrow', type: 'button', 'aria-label': label, html: arrow(path),
    onclick: (e) => { e.stopPropagation(); sound?.start(); step(dir) },
  })
  const prev = mkArrow(-1, 'Previous scene', 'M22 6H2M7 1 2 6l5 5')
  const next = mkArrow(1, 'Next scene', 'M2 6h20M17 1l5 5-5 5')
  const root = el('nav', { class: 'navbar', 'aria-label': 'Scenes' },
    el('p', { class: 'nav-legal mono', html: legal }),
    el('div', { class: 'nav-row' }, prev, el('ol', { class: 'nav-dots' }, ...dots.map((d) => el('li', {}, d))), next))

  function update(i) {
    dots.forEach((d, k) => {
      d.classList.toggle('is-on', k === i)
      if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current')
    })
    const first = i <= 0, last = i >= chapters.length - 1
    prev.classList.toggle('is-quiet', first); prev.setAttribute('aria-disabled', String(first))
    next.classList.toggle('is-quiet', last); next.setAttribute('aria-disabled', String(last))
  }
  return { el: root, update }
}
