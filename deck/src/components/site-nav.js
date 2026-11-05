// site-nav.js — the site's primary navigation, inside the deck.
//
// The deck is accessrank.ai's home page for tablets and desktops (phones get the
// long-form page; see server/app.js), so this is the real site nav, not an exit
// sign. The link set mirrors src/data/site.json `nav` on the main site, with the
// long-form page's in-page anchors pointed at /home where that page always lives.
//
// Layout: logo · chapter dots (moved in by src/main.js) · links · Full site · Free audit.
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

const LINKS = [
  // Same second tier as the main site's nav (src/data/site.json): a dropdown in the bar.
  { label: 'Why Accessrank', href: '/about', children: [
    { label: 'Our approach', href: '/about' },
    { label: 'ADA guide', href: '/guide/ada-eaa' },
    { label: 'How we score', href: '/methodology' },
  ] },
  { label: 'What we fix', href: '/home#product' },
  { label: 'Pricing', href: '/home#pricing' },
  { label: 'Client login', href: '/client-login' },
]
// Only in the menu, where there is room for the second tier.
const MORE = [
  { label: 'How we score', href: '/methodology' },
  { label: 'ADA guide', href: '/guide/ada-eaa' },
  { label: 'Human testing', href: '/human-testing' },
]
// Always in the bar, at every width: the way off the slides and into the full
// site. "Full site" rather than "Main site" — the deck is the site's front door
// now, so the other page is the fuller one, not the main one.
const SITE = { label: 'Full site', href: '/home' }
const CTA = { label: 'Free audit', href: '/home#audit' }

const MARK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

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

export function SiteNav({ homeHref = '/' } = {}) {
  const logo = el('a', { class: 'ar-nav-logo', href: homeHref, target: '_top', 'aria-label': 'Accessrank home' },
    el('span', { class: 'ar-nav-mark', 'aria-hidden': 'true', html: MARK }),
    el('span', { class: 'ar-nav-word', text: 'Accessrank' }))

  // Bar links (hidden below 1280px by CSS).
  const row = el('ul', { class: 'ar-nav-links' }, ...LINKS.map((l) => (l.children ? dropdown(l) : el('li', {}, link(l)))))

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
  const root = el('nav', { class: 'ar-nav', 'aria-label': 'Site' }, logo, right, menu)

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
