// Transition(kind:'wipe'|'fade'|'zoom', {dur:t-4}) — entre slides, siempre in-out-quart, whoosh corto.
import { gsap, ease, sec, T } from './ease.js'
import { prefersReduced } from '../util/dom.js'
export function Transition(kind = 'fade', { dur = T[4], sound = null } = {}) {
  return {
    run(fromEl, toEl, dir = 1) {
      return new Promise((res) => {
        sound?.play('whoosh')
        if (prefersReduced()) { if (fromEl) gsap.set(fromEl, { opacity: 0 }); gsap.set(toEl, { clearProps: 'all' }); return res() }
        const e = ease('in-out-quart'), d = sec(dur)
        const tl = gsap.timeline({ onComplete: () => { if (fromEl) gsap.set(fromEl, { clearProps: 'all' }); gsap.set(toEl, { clearProps: 'all' }); res() } })
        if (kind === 'wipe') {
          gsap.set(toEl, { opacity: 1, clipPath: dir >= 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' })
          tl.to(toEl, { clipPath: 'inset(0 0 0 0)', duration: d, ease: e }, 0)
          if (fromEl) tl.to(fromEl, { opacity: 0, duration: d * .5, ease: e }, d * .5)
        } else if (kind === 'zoom') {
          gsap.set(toEl, { opacity: 0, scale: 1.04 })
          tl.to(toEl, { opacity: 1, scale: 1, duration: d, ease: e }, 0)
          if (fromEl) tl.to(fromEl, { opacity: 0, scale: .98, duration: d * .6, ease: e }, 0)
        } else if (kind === 'pull') {
          // Deck M 01→02: la escena anterior "se aleja" (scale .94, se apaga) mientras la nueva ya está debajo.
          gsap.set(toEl, { opacity: 1 })
          if (fromEl) { gsap.set(fromEl, { transformOrigin: '50% 50%' }); tl.to(fromEl, { scale: .94, opacity: 0, duration: d, ease: e }, 0) }
        } else {
          gsap.set(toEl, { opacity: 0 })
          if (fromEl) tl.to(fromEl, { opacity: 0, duration: d * .5, ease: e }, 0)
          tl.to(toEl, { opacity: 1, duration: d * .5, ease: e }, fromEl ? d * .5 : 0)
        }
      })
    },
  }
}
