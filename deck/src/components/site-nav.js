// site-nav.js — the main site's primary nav, brought into the deck so a viewer always has a way back.
// Structurally and visually it mirrors accessrank-main's src/partials/nav.html (logo · links · CTA), but it's a
// self-contained copy: the deck has its own token system (lib/tokens.css) with different variable names, so this
// re-declares the handful of Accessrank brand colors it needs rather than depending on the main site's stylesheet
// being present. Every link (including "Main website") carries target="_top" so it breaks out of the iframe when the
// deck is shown inside the main site's overlay, and still just works if the deck is opened on its own.
import { el } from '@lib/util/dom.js'

const LINKS = [
  { label: 'How it works', href: '/#product', active: true },
  { label: 'WCAG explained', href: '/#wcag' },
  { label: 'Pricing', href: '/#pricing' },
]

export function SiteNav({ mainSiteHref = '/' } = {}) {
  const logo = el('a', { class: 'ar-nav-logo', href: mainSiteHref, target: '_top', 'aria-label': 'Accessrank home' },
    el('span', { class: 'ar-nav-mark', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6.5"></polyline></svg>' }),
    el('span', { class: 'ar-nav-word', text: 'Accessrank' }))

  const links = LINKS.map((l) => el('a', { class: 'ar-nav-link' + (l.active ? ' is-active' : ''), href: mainSiteHref.replace(/\/$/, '') + l.href, target: '_top', text: l.label }))

  const mainSite = el('a', { class: 'ar-nav-link ar-nav-cta', href: mainSiteHref, target: '_top', text: 'Main website' })

  const root = el('nav', { class: 'ar-nav', 'aria-label': 'Accessrank' },
    logo,
    el('div', { class: 'ar-nav-right' }, ...links, mainSite))

  return { el: root }
}
