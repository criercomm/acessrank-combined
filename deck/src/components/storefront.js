// Storefront(copy.s04.store, assets) — the fictional "Northline Goods" store drawn in code (a generic Shopify-style theme)
// with the seven real accessibility failures the product detects, each one an anchor for a finding marker.
// Nothing here is a screenshot: the store, the modal, the form and the markers are DOM, so the scanner can act on them.
import { el } from '@lib/util/dom.js'
export function Storefront(store, assets, { mobile = false } = {}) {
  const products = mobile ? store.products.slice(0, 4) : store.products
  const cards = products.map((p) => {
    const img = assets.img(`dR-s01-product-${p.id}`, { w: 800, sizes: '14vw', alt: '' })
    const price = el('div', { class: 'st-price' }, p.sale ? [el('s', { text: p.price }), el('b', { class: 'st-sale', text: p.sale })] : el('b', { text: p.price }))
    return el('article', { class: 'st-card', 'data-product': p.id },
      el('div', { class: 'st-media', 'data-anchor': p.id === 'headphones' ? 'alt' : null }, img),
      el('h4', { class: 'st-name', text: p.name }),
      el('div', { class: 'st-row' }, price, el('button', { class: 'st-btn st-btn--add', type: 'button', tabindex: '-1', 'data-anchor': p.id === 'skincare' ? 'cart' : null, text: 'Add to cart' })))
  })
  // anchors for contrast (sneaker sale price) and color-only (candle sale price)
  cards.find((c) => c.dataset.product === 'sneaker')?.querySelector('.st-sale')?.setAttribute('data-anchor', 'contrast')
  cards.find((c) => c.dataset.product === 'candle')?.querySelector('.st-sale')?.setAttribute('data-anchor', 'color')

  const nav = el('header', { class: 'st-nav' },
    el('span', { class: 'st-logo', text: store.name.toUpperCase() }),
    el('nav', { class: 'st-links' }, ...store.nav.map((n) => el('span', { text: n }))),
    el('button', { class: 'st-icon', type: 'button', tabindex: '-1', 'data-anchor': 'target', 'aria-label': 'Cart' }, el('i')))
  const hero = el('section', { class: 'st-hero' }, el('span', { class: 'st-eyebrow', text: store.hero.eyebrow }), el('h3', { class: 'st-h', text: store.hero.title }), el('span', { class: 'st-btn st-btn--hero', text: store.hero.cta }))
  const grid = el('section', { class: 'st-grid' }, ...cards)
  const form = el('section', { class: 'st-form' }, el('span', { class: 'st-form-title', text: store.form.title }), el('span', { class: 'st-input', 'data-anchor': 'label', text: store.form.placeholder }), el('span', { class: 'st-btn st-btn--join', text: store.form.cta }))
  const modal = el('div', { class: 'st-modal', 'data-anchor': 'focus' }, el('b', { text: store.modal.title }), el('div', { class: 'st-sizes' }, ...store.modal.sizes.map((s, i) => el('span', { class: 'st-size' + (i === 2 ? ' is-on' : ''), text: s }))), el('span', { class: 'st-btn st-btn--add', text: store.modal.cta }))
  const page = el('div', { class: 'st-page' }, nav, hero, grid, form, modal)
  const bar = el('div', { class: 'st-bar' }, el('span', { class: 'st-dots' }, el('i'), el('i'), el('i')), el('span', { class: 'st-url mono' }, el('i', { class: 'st-lock' }), store.url))
  const root = el('div', { class: 'store', 'aria-label': 'A fictional storefront used to demonstrate the product' }, bar, page)

  const anchorOf = (key) => page.querySelector(`[data-anchor="${key}"]`)
  // marker position (in % of the page box) for a finding key; null when the anchor is hidden (mobile)
  function positionOf(key) {
    const a = anchorOf(key)
    if (!a || !a.offsetParent) return null
    const pr = page.getBoundingClientRect(), r = a.getBoundingClientRect()
    if (!r.width) return null
    const left = key === 'alt' ? r.left + 10 : key === 'focus' ? r.left + 12 : r.left + r.width / 2
    const top = key === 'alt' ? r.top + 10 : key === 'focus' ? r.top + 12 : r.top + r.height / 2
    return { x: ((left - pr.left) / pr.width) * 100, y: ((top - pr.top) / pr.height) * 100, side: left > pr.left + pr.width * .6 ? 'left' : 'right' }
  }
  return { el: root, page, anchorOf, positionOf, cards }
}
