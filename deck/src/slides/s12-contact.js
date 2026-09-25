// S12 — Contact (V2, JP's request; S12 since the Libraries teaser was added in V3). "Let's talk." with the closing question, two contact cards (role, email,
// phone; no names on screen by JP's and Carlos's decision, so the role takes the headline slot), the site and the brand mark. Emails and phones are real links
// (mailto:/tel:, the tel: href is the E.164 form of the displayed number). The scanner beam runs faintly across the background.
import { gsap, T, sec } from '@lib/motion/ease.js'
import { Stagger } from '@lib/motion/stagger.js'
import { el, prefersReduced } from '@lib/util/dom.js'
import { heading, brandMark } from '../components/ui.js'
import { Magnetic } from '../components/magnetic.js'

export default {
  id: 's12', title: 'Contact', transition: 'fade',
  get notes() { return this._notes },
  build(root, ctx) {
    const { copy } = ctx
    const C = copy.s12
    this._notes = C.notes
    const title = heading(C.title, { tag: 'h2', cls: 'h-display s12-title', accent: -1 })
    const sub = el('p', { class: 's12-sub', text: C.sub })
    const isPlaceholder = (v) => v.startsWith('[')
    const cards = C.people.map((p) => el('div', { class: 'contact' },
      p.name ? el('b', { class: 'contact-name', text: p.name }) : null,
      el(p.name ? 'span' : 'b', { class: p.name ? 'contact-role label' : 'contact-name', text: p.role }),
      el('a', { class: 'contact-line mono', href: isPlaceholder(p.email) ? '#' : `mailto:${p.email}`, 'data-no-advance': '', text: p.email }),
      p.phone ? el('a', { class: 'contact-line mono', href: isPlaceholder(p.phone) ? '#' : `tel:${p.phone.replace(/[^\d+]/g, '')}`, 'data-no-advance': '', text: p.phone }) : null))
    const site = el('a', { class: 's12-site mono', href: C.siteHref, target: '_blank', rel: 'noopener', 'data-no-advance': '', text: C.site })
    const beam = el('div', { class: 'beam beam--bg', 'aria-hidden': 'true' })
    root.append(beam, el('div', { class: 's12-copy' }, brandMark('s12-brand'), title.el, sub), el('div', { class: 's12-cards' }, ...cards), el('div', { class: 's12-foot' }, site))
    this.els = { title, sub, cards, site, beam }
    gsap.set([sub, ...cards, site], { opacity: 0 })
  },
  enter(ctx) {
    const { title, sub, cards, site, beam } = this.els
    this.tl?.kill(); this.loop?.kill(); this.magnetic?.destroy()
    ctx.deck.root.classList.add('is-close')
    const tl = gsap.timeline()
    tl.add(() => title.restart(), .3)
    tl.add(Stagger([sub], { dur: T[4], y: 8 }), 1)
    tl.add(Stagger(cards, { dur: T[5], y: 16, delay: 160, from: 'start' }), 1.3)
    tl.add(Stagger([site], { dur: T[4], y: 8 }), 2)
    this.tl = tl
    this.magnetic = Magnetic(site)
    if (!prefersReduced()) this.loop = gsap.fromTo(beam, { top: '-4%' }, { top: '104%', duration: 9, ease: 'none', repeat: -1, delay: 1 })
  },
  leave(ctx) { ctx.deck.root.classList.remove('is-close'); this.tl?.kill(); this.loop?.kill(); this.magnetic?.destroy() },
}
