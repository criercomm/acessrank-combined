// site-nav.js — the site's primary navigation, inside the deck.
//
// The deck is accessrank.ai's home page for tablets and desktops (phones get the
// long-form page; see server/app.js), so this is the real site nav, not an exit
// sign. The link set is read from src/data/site.json `nav` on the main site (see
// MAIN_NAV below), whose in-page anchors already point at /home. The logo goes to
// /home too: on desktop `/` is this deck again, so it would be a link to itself.
//
// Layout: logo · chapter dots (moved in by src/main.js) · links · Explore the site · Free audit.
// From 1280px up the links sit in the bar. Below that — iPad portrait and
// landscape, small laptops — they fold into a Menu button, because the bar
// cannot hold the logo, nine chapter dots and five links at 1024px without the
// dots losing their centre. The menu is a plain disclosure, not a dialog: a
// button with aria-expanded / aria-controls, focus moved to the first link on
// open, Escape or an outside click closes it and hands focus back.
//
// The deck has its own token system (lib/tokens.css), so the handful of brand
// colours this needs are re-declared in style.css under .ar-nav rather than
// depending on the main site's stylesheet.
import { el } from '@lib/util/dom.js'

// The link set is read from the main site's own nav data (src/data/site.json, the file its header is built from), so a rename or a
// new page there reaches the deck on the next build instead of waiting for someone to copy it over. import.meta.glob (not a plain
// import) so a deck built on its own, without the main site beside it, still builds and falls back to FALLBACK below.
// `import: 'nav'` keeps only that key of the JSON in the bundle.
const MAIN_NAV = Object.values(import.meta.glob('../../../src/data/site.json', { eager: true, import: 'nav' }))[0]
const FALLBACK = [
  { label: 'Why we exist', href: '/about', menu: true, children: [
    { label: 'Why we exist', href: '/about' },
    { label: 'ADA guide', href: '/guide/ada-eaa' },
    { label: 'How we score', href: '/methodology' },
  ] },
  { label: 'Pricing', href: '/home#pricing' },
  { label: 'Free audit', href: '/home#audit', cta: true },
]
const NAV = Array.isArray(MAIN_NAV) && MAIN_NAV.length ? MAIN_NAV : FALLBACK

// Not in site.json: the main site's header template hard-codes "Client login" (src/partials/nav.html), so it is kept here.
const CLIENT_LOGIN = { label: 'Client login', href: '/client-login' }
// The deck's own entry ("Overview", flagged deck: true) is skipped: this nav is already inside it. The CTA is the flagged item.
const BAR = NAV.filter((l) => !l.deck && !l.cta)
const LINKS = [...BAR, CLIENT_LOGIN]
// Only in the menu, where there is room for the second tier: every dropdown child not already listed, then the pages the main
// nav does not carry at all.
const EXTRA = [{ label: 'Human testing', href: '/human-testing' }]
const seen = new Set(LINKS.map((l) => l.href))
const MORE = [...BAR.flatMap((l) => l.children || []), ...EXTRA].filter((l) => !seen.has(l.href) && seen.add(l.href))
// Always in the bar, at every width: the way off the slides and into the full
// site. "Explore the site" rather than "Main site" or "Full site" — the deck is the
// site's front door now, so this invites the visitor on to the fuller page.
const SITE = { label: 'Explore the site', href: '/home' }
const CTA = NAV.find((l) => l.cta) || { label: 'Free audit', href: '/home#audit' }

// The main site's animated mark (src/partials/nav.html): yellow check, red "!" and green check icons cross-fading under
// three colour wipes and diagonal swipes. It is pure CSS (.ar-nav-mark in src/style.css), one 5 s run as soon as the nav
// is inserted — every load and refresh of the deck.
const ICON = (inner) => `<svg viewBox="0 0 14 14" aria-hidden="true">${inner}</svg>`
const CHECK = '<path d="M3 7 L6 10 L11 4" fill="none" stroke="#0E0E10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
const BANG = '<line x1="7" y1="2.6" x2="7" y2="7.8" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="11.6" r="1.1" fill="#FFFFFF"/>'
const MARK = '<span class="layer layer-red"></span><span class="layer layer-green"></span><span class="layer layer-yellow"></span>'
  + `<span class="icon icon-yellow">${ICON(CHECK)}</span><span class="icon icon-red">${ICON(BANG)}</span><span class="icon icon-green">${ICON(CHECK)}</span>`
  + '<span class="swipe swipe-1"></span><span class="swipe swipe-2"></span><span class="swipe swipe-3"></span>'

const link = (l, cls = 'ar-nav-link') => el('a', { class: cls, href: l.href, target: '_top', text: l.label })
const CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

// A bar item with a dropdown, built and behaving like the main site's (src/partials/nav.html +
// site.js): the label stays a real link, a chevron button beside it toggles the list for keyboard
// and touch, and CSS also opens it on hover / focus-within. Escape and outside clicks close it.
function dropdown(l) {
  const item = el('li', { class: 'ar-nav-item has-menu' })
  const btn = el('button', { class: 'ar-nav-sub-btn', type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'true', 'aria-label': `Show ${l.label} pages`, html: CHEVRON })
  const list = el('ul', { class: 'ar-nav-sub' }, ...l.children.map((c) => el('li', {}, link(c, 'ar-nav-sub-link'))))
  item.append(link(l), btn, list)
  const setOpen = (open) => { item.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)) }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!item.classList.contains('is-open')) })
  document.addEventListener('pointerdown', (e) => { if (!item.contains(e.target)) setOpen(false) }, true)
  item.addEventListener('keydown', (e) => { if (e.key === 'Escape' && item.classList.contains('is-open')) { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus() } })
  item.addEventListener('focusout', (e) => { if (e.relatedTarget && !item.contains(e.relatedTarget)) setOpen(false) })
  return item
}

export function SiteNav({ homeHref = '/home' } = {}) {
  const logo = el('a', { class: 'ar-nav-logo', href: homeHref, target: '_top', 'aria-label': 'Accessrank main site' },
    el('span', { class: 'ar-nav-mark', 'aria-hidden': 'true', html: MARK }),
    el('span', { class: 'ar-nav-word', text: 'Accessrank' }))

  // The main site's brand block: logo with the Beta badge beside it, "Beta · launching Q1 2027" as in src/partials/nav.html
  // (the launch date is hard-coded there, not in site.json, so it is kept here too; change both together).
  const beta = el('a', { class: 'ar-nav-beta', href: '/beta', target: '_top' }, 'Beta ', el('span', { class: 'ar-nav-beta-when', text: '\u00b7 launching Q1 2027' }))
  const brand = el('div', { class: 'ar-nav-brand' }, logo, beta)

  // Bar links (hidden below 1280px by CSS).
  const row = el('ul', { class: 'ar-nav-links' }, ...LINKS.map((l) => (l.children ? dropdown(l) : el('li', {}, link(l, l.label === 'Client login' ? 'ar-nav-link ar-nav-utility' : 'ar-nav-link')))))

  const site = link(SITE, 'ar-nav-link ar-nav-site')
  const cta = link(CTA, 'ar-nav-link ar-nav-cta')

  // Menu (shown below 1280px by CSS).
  const menuId = 'ar-nav-menu'
  const button = el('button', { class: 'ar-nav-menu-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': menuId },
    el('span', { class: 'ar-nav-menu-bars', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
    el('span', { class: 'ar-nav-menu-label', text: 'Menu' }))
  const menu = el('div', { class: 'ar-nav-menu', id: menuId, hidden: '' },
    el('ul', {}, ...[...LINKS, ...MORE].map((l) => el('li', {}, link(l, 'ar-nav-menu-link')))))

  const right = el('div', { class: 'ar-nav-right' }, row, site, cta, button)
  const root = el('nav', { class: 'ar-nav', 'aria-label': 'Site' }, brand, right, menu)

  // --- disclosure behaviour -------------------------------------------------
  let open = false
  const firstLink = () => menu.querySelector('a')
  function setOpen(next, { focus = true } = {}) {
    if (next === open) return
    open = next
    button.setAttribute('aria-expanded', String(open))
    menu.hidden = !open
    root.classList.toggle('is-menu-open', open)
    if (open && focus) firstLink()?.focus()
  }
  button.addEventListener('click', () => setOpen(!open))
  // Escape closes and returns focus to the button (the deck's own Escape handling
  // does not run for events that start inside the nav — see stop below).
  root.addEventListener('keydown', (e) => {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.focus() }
    // Keep the deck's arrow-key paging from firing while someone tabs around the menu.
    if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'Enter') e.stopPropagation()
  })
  // Click or tap anywhere outside closes it, without moving focus.
  document.addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target)) setOpen(false, { focus: false }) }, true)
  // Focus leaving the nav (Tab past the last link) closes it too.
  root.addEventListener('focusout', (e) => { if (open && e.relatedTarget && !root.contains(e.relatedTarget)) setOpen(false, { focus: false }) })
  // If the bar widens back to the full row, there is no menu to be open.
  const wide = matchMedia('(min-width: 1280px)')
  wide.addEventListener?.('change', () => { if (wide.matches) setOpen(false, { focus: false }) })

  return { el: root, close: () => setOpen(false, { focus: false }) }
}
