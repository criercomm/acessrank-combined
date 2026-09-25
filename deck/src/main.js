// Deck R · Accessrank "FIX THE CODE. PROVE IT." — bootstrap. 10 scenes, full chrome (chapter dots + counter), custom cursor,
// aurora glow inherited from accessrank.ai, sound effects only (no gate, no music bed; Carlos 2026-09-18), ?presenter=1 on JP's
// screen, ?short=1 for the 3-minute path.
import '@lib/deck.css'
import './style.css'
import manifest from 'virtual:manifest'
import { createDeck, createAssets, registerPlaceholder, el, SoundBus } from '@lib/index.js'
import { copy } from './copy.js'
import { Presenter } from './components/presenter.js'
import { Navbar } from './components/navbar.js'
import { SiteNav } from './components/site-nav.js'
import s01 from './slides/s01-cover.js'
import s02 from './slides/s02-letter.js'
import s03 from './slides/s03-widget.js'
import s04 from './slides/s04-fix.js'
import s05 from './slides/s05-safe.js'
import s06 from './slides/s06-engine.js'
import s07 from './slides/s07-model.js'
import s08 from './slides/s08-market.js'
import s11 from './slides/s11-libraries.js'
import s12 from './slides/s12-contact.js'

// ---------------------------------------------------------------------------
// Placeholders while a manifest row is still "pending": intentional, in the deck's palette, labelled by lib/placeholder.js.
// ---------------------------------------------------------------------------
const NAVY = '#14142A', YEL = '#FFD23F'
function ground(c, W, H) { c.fillStyle = NAVY; c.fillRect(0, 0, W, H) }
function blob(c, x, y, w, h, r, fill = '#1C2350') { c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill() }
function shadow(c, x, y, w, h) { c.save(); c.filter = `blur(${w * .06}px)`; c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.ellipse(x, y, w / 2, h, 0, 0, Math.PI * 2); c.fill(); c.restore() }
registerPlaceholder('product', (c, W, H, r, a) => { c.clearRect(0, 0, W, H); shadow(c, W / 2, H * .86, W * .7, H * .04); blob(c, W * .2, H * .2, W * .6, H * .64, W * .08); c.fillStyle = 'rgba(255,210,63,.35)'; c.fillRect(W * .3, H * .5, W * .4, H * .02) })
registerPlaceholder('letter', (c, W, H) => { c.clearRect(0, 0, W, H); shadow(c, W / 2, H * .82, W * .9, H * .05); c.save(); c.translate(W / 2, H / 2); c.rotate(-.08); blob(c, -W * .42, -H * .22, W * .84, H * .46, W * .01, '#E8DCC4'); c.fillStyle = '#7A1F2B'; c.beginPath(); c.arc(0, 0, W * .035, 0, Math.PI * 2); c.fill(); c.restore() })
registerPlaceholder('silhouette', (c, W, H) => { c.clearRect(0, 0, W, H); shadow(c, W / 2, H * .97, W * .6, H * .02); c.fillStyle = '#0C1330'; c.beginPath(); c.arc(W / 2, H * .18, W * .12, 0, Math.PI * 2); c.fill(); blob(c, W * .22, H * .3, W * .56, H * .66, W * .1, '#0C1330') })
registerPlaceholder('plate', (c, W, H) => { ground(c, W, H); const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0C1330'); g.addColorStop(.6, NAVY); g.addColorStop(1, '#070A1C'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = '#0A0F2A'; for (let i = 0; i < 14; i++) { const w = W * (.03 + Math.random() * .04), h = H * (.15 + Math.random() * .4); c.fillRect(W * .2 + i * W * .045, H * .62 - h, w, h) } c.fillStyle = 'rgba(255,210,63,.25)'; c.fillRect(0, H * .62, W, 1) })
registerPlaceholder('sheet', (c, W, H) => ground(c, W, H))
// floating browser mockup (cover) and a letter page: drawn so the composition reads while the assets are pending
registerPlaceholder('mockup', (c, W, H) => { c.clearRect(0, 0, W, H); shadow(c, W / 2, H * .92, W * .8, H * .04); c.save(); c.transform(1, -.06, 0, 1, 0, H * .06); blob(c, W * .08, H * .1, W * .84, H * .74, W * .015, '#101838'); c.fillStyle = '#0A0F2A'; c.fillRect(W * .08, H * .1, W * .84, H * .05); c.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < 6; i++) c.fillRect(W * (.12 + (i % 3) * .27), H * (.36 + Math.floor(i / 3) * .22), W * .24, H * .18); c.fillStyle = YEL; c.fillRect(W * .12, H * .27, W * .12, H * .04); c.restore() })
registerPlaceholder('page', (c, W, H) => { c.fillStyle = '#F4F1EA'; c.fillRect(0, 0, W, H); c.fillStyle = '#C9C4BB'; for (let i = 0; i < 28; i++) c.fillRect(W * .12, H * (.08 + i * .03), W * (.5 + ((i * 7) % 5) * .06), H * .012) })
registerPlaceholder('audio', (c, W, H) => ground(c, W, H))

// Las rutas del manifest son relativas, así que necesitan el prefijo del despliegue: '/deck/' en Fly, './' en Vercel, '/'
// en dev. Sin él, abrir https://www.accessrank.ai/deck (sin barra final, que el servidor sirve igual y sin redirigir)
// resolvía cada imagen y cada pista de audio una carpeta más arriba: 404 en todas.
const BASE = import.meta.env.BASE_URL || './'
const withBase = (v) => Array.isArray(v) ? v.map(withBase)
  : typeof v === 'string' && !/^(https?:|data:|\/)/.test(v) ? BASE.replace(/\/+$/, '') + '/' + v.replace(/^\.?\//, '') : v
const assets = createAssets(manifest, { base: BASE })
const params = new URLSearchParams(location.search)
const SHORT = [1, 2, 4, 7, 10] // the 3-minute path: cover → the letter → the fix → model → contact (the ask was removed 2026-09-23)
const all = [s01, s02, s03, s04, s05, s06, s07, s08, s11, s12]
const short = params.get('short') === '1'
const slides = short ? all.filter((_, i) => SHORT.includes(i + 1)) : all
const chapters = short ? copy.chapters.filter((_, i) => SHORT.includes(i + 1)) : copy.chapters
const presenter = params.get('presenter') === '1' ? Presenter({ ...copy, chapters }, { total: slides.length, short: short ? [] : SHORT }) : null
if (presenter && short) presenter.el.classList.add('is-short')

// aurora: the site's radial glow (blue + violet) behind every scene, breathing slowly; one element, GPU cheap
const root = document.getElementById('deck')
root.append(el('div', { class: 'aurora', 'aria-hidden': 'true' }))

// Secondary navigation at the bottom (dots + arrows + the legal line), the only chrome that fits a phone or a landscape
// phone; CSS hides it on desktop, where the chapter dots live at the top left. It is built before the deck so the first
// go() already paints the right dot, and reaches the deck through deckRef once createDeck resolves.
let deckRef = null
const nav = Navbar({
  chapters, legal: copy.legal, sound: SoundBus,
  go: (i) => deckRef?.go(i),
  step: (d) => (d > 0 ? deckRef?.next() : deckRef?.prev()),
})
root.append(nav.el)
const siteNav = SiteNav({ mainSiteHref: '/home' })
root.append(siteNav.el)

// Sound: effects only. No entry gate and no music bed (Carlos, 2026-09-18). Browsers only let audio start after a user gesture,
// so the effects wake up on the first click, key or swipe; the Sound on/off label (or M) still mutes them in the room.
// An old "Enter in silence" choice left a mute cookie behind: clear it once so every viewer starts with the effects on.
try { if (!localStorage.getItem('ar-sfx-only')) { SoundBus.mute(false); localStorage.setItem('ar-sfx-only', '1') } } catch { SoundBus.mute(false) /* storage blocked: effects on */ }
createDeck({
  root, slides, copy, assets, chapters, params,
  audio: { bed: false, ...Object.fromEntries(Object.entries(manifest.audio?.sfx || {}).map(([k, v]) => [k, withBase(v)])) },
  chrome: 'full', cursor: true, muted: false, grain: .05,
  fonts: ['800 1em "Inter"', '500 1em "JetBrains Mono"'],
  onChange: (i) => { presenter?.update(i); nav.update(i) },
}).then((deck) => {
  deckRef = deck
  // Chapter dots move into the site nav bar itself, right after the logo,
  // instead of their own row in the deck's chrome (see lib/deck.css .chapters
  // and src/style.css's .ar-nav .chapters override for the layout side of this).
  const chaptersEl = root.querySelector('.chapters')
  const arNavRight = siteNav.el.querySelector('.ar-nav-right')
  if (chaptersEl && arNavRight) siteNav.el.insertBefore(chaptersEl, arNavRight)
  const s = assets.stats()
  console.info(`[deck R] ${deck.total} scenes${short ? ' (short path)' : ''} · assets ${s.final} final / ${s.placeholder} placeholder`)
})
const wake = () => SoundBus.start()
for (const type of ['pointerdown', 'keydown', 'touchstart']) addEventListener(type, wake, { once: true, capture: true, passive: true })
