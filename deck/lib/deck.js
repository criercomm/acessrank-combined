// createDeck({root, slides, copy, assets, chapters, audio}) — runtime de 6 slides:
// flechas / click / swipe / rueda · ?slide=n · contador NN / 06 (flap) · ?for=slug · ?presenter=1 ·
// lazy build + precarga del siguiente · transición con whoosh · click-soft al avanzar · reduced-motion.
import { gsap, T } from './motion/ease.js'
import { Stagger } from './motion/stagger.js'
import { FlapDigits } from './motion/flap-digits.js'
import { Transition } from './motion/transition.js'
import { Cursor } from './motion/cursor.js'
import { Grain } from './motion/grain.js'
import { SoundBus } from './motion/sound-bus.js'
import { el, clamp, pad2, prefersReduced, isCoarse } from './util/dom.js'

// Opciones añadidas por el Deck M (retrocompatibles): chrome 'full' (default) | 'minimal' (sin nav de capítulos,
// clase .is-minimal en el root para que el deck reposicione contador/footer por CSS) · cursor:false apaga el
// Cursor custom · muted:true arranca en silencio salvo cookie previa (spec "audio muted by default").
// labels (Deck S, retrocompatible): textos del chrome en el idioma del deck — hint, botón de sonido, flecha, "ir a" y el total
// del contador (un deck con apéndice puede mostrar "/ 12" aunque tenga 15 escenas). Sin la opción, los textos en inglés de siempre.
export async function createDeck({ root, slides, copy, assets, chapters, audio = {}, params = new URLSearchParams(location.search), grain = .06, fonts = ['600 1em "Clash Display"', '500 1em "JetBrains Mono"'], chrome: chromeMode = 'full', cursor = true, muted = false, onChange = null, labels = {} }) {
  const total = slides.length
  const L = { soundOn: 'Sound on', soundOff: 'Sound off', next: 'Next', nextTitle: 'Next (→ or space)', hint: 'Click, → or space to continue', hintTouch: 'Swipe to continue', chapterGoTo: 'Go to', counterTotal: pad2(total), ...labels }
  const reduced = prefersReduced()
  const forSlug = params.get('for')
  const presenter = params.get('presenter') === '1'
  const mobile = matchMedia('(max-width: 767px)').matches
  const sound = SoundBus
  if (muted) sound.defaultMuted(true)
  sound.register(audio)
  const ctx = { deck: null, copy, assets, reduced, mobile, forSlug, presenter, sound, gsap, params }

  root.classList.add('deck')
  if (chromeMode === 'minimal') root.classList.add('is-minimal')
  const stage = el('div', { class: 'stage' })
  const sections = slides.map((s, i) => el('section', { class: 'slide', id: s.id || `s${i + 1}`, 'data-slide': i + 1, 'aria-hidden': 'true' }))
  stage.append(...sections)

  // ---- chrome ----
  const names = chapters || slides.map((s, i) => s.title || `Slide ${i + 1}`)
  const chapterBtns = chromeMode === 'minimal' ? [] : names.map((name, i) => el('button', { class: 'chapter mono', type: 'button', 'aria-label': `${L.chapterGoTo} ${name}`, onclick: (e) => { e.stopPropagation(); sound.start(); go(i) } }, el('i'), el('span', { text: name })))
  const counterN = el('span', { class: 'counter-n' })
  const counter = el('div', { class: 'counter mono', 'aria-live': 'polite' }, counterN, el('span', { class: 'counter-sep', text: '/' }), el('span', { class: 'counter-total', text: L.counterTotal }))
  const muteBtn = el('button', { class: 'mute mono', type: 'button', 'aria-pressed': String(sound.muted), text: sound.muted ? L.soundOff : L.soundOn, onclick: (e) => { e.stopPropagation(); sound.start(); sound.mute() } })
  sound.onMute((m) => { muteBtn.textContent = m ? L.soundOff : L.soundOn; muteBtn.setAttribute('aria-pressed', String(m)) })
  // Chrome minimal: una flecha de filete junto al contador es el único control visible para avanzar. Existe porque una escena
  // puede ocupar toda su superficie con un control propio (S03 del Deck M) y "click en cualquier sitio" deja de ser cierto ahí.
  const nextBtn = chromeMode === 'minimal' ? el('button', { class: 'next', type: 'button', 'aria-label': L.next, title: L.nextTitle, onclick: (e) => { e.stopPropagation(); next() }, html: "<svg viewBox=\"0 0 28 12\" width=\"28\" height=\"12\" aria-hidden=\"true\"><path d=\"M0 6h26M21 1l5 5-5 5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/></svg>" }) : null
  const legal = el('p', { class: 'legal', html: copy.legal })
  const hint = el('p', { class: 'hint', text: isCoarse() ? L.hintTouch : L.hint })
  const footer = el('footer', { class: 'footer mono' }, legal, hint)
  const notes = el('aside', { class: 'notes mono', hidden: !presenter })
  const chrome = el('div', { class: 'chrome' }, el('nav', { class: 'chapters', 'aria-label': 'Chapters' }, ...chapterBtns), el('div', { class: 'topright' }, muteBtn, counter, ...(nextBtn ? [nextBtn] : [])), footer, notes)
  root.append(stage, chrome)
  const counterFlap = FlapDigits(counterN, { value: pad2(1), digits: 2, clack: false, dur: T[3], flip: 90, cascade: 50 })

  // ---- estado ----
  let current = -1, busy = false
  const built = new Set(), preloaded = new Map(), entered = new Set()
  async function ensureBuilt(i) {
    if (built.has(i)) return
    built.add(i)
    try { await slides[i].build?.(sections[i], ctx) } catch (e) { console.error(`[deck] build s${i + 1}`, e) }
  }
  function ensurePreloaded(i) {
    if (!preloaded.has(i)) preloaded.set(i, Promise.resolve().then(() => slides[i].preload?.(ctx)).catch((e) => console.warn(`[deck] preload s${i + 1}`, e)))
    return preloaded.get(i)
  }
  const setChapter = (i) => chapterBtns.forEach((b, k) => b.classList.toggle('is-active', k === i))
  const setNotes = (i) => { notes.textContent = slides[i].notes || '' }

  async function go(n, dir) {
    n = clamp(n, 0, total - 1)
    if (busy || n === current) return
    busy = true
    dir = dir ?? (n > current ? 1 : -1)
    const from = current, to = n
    await ensureBuilt(to)
    await ensurePreloaded(to)
    const fromEl = from >= 0 ? sections[from] : null, toEl = sections[to]
    if (fromEl) { try { slides[from].leave?.(ctx) } catch (e) { console.error(e) } fromEl.classList.add('is-leaving') }
    // ---- "la escena se abre dos veces" ----------------------------------------------------------------
    // enter() corre DESPUÉS de la transición, y leave() no deshace nada: una escena ya vista conserva el estado
    // final de su última entrada. Al volver a ella, el slide aparece ya formado, la transición lo muestra así, y
    // recién entonces enter() lo devuelve a cero y lo vuelve a animar. Eso es lo que se ve como abrirse dos veces,
    // y pasa en cualquier deck en cuanto alguien retrocede o repasa (o sea, en todos los ensayos).
    // Arreglo: al reactivar una escena, devolverla a su estado previo a enter() ANTES de mostrarla.
    //   · reset(ctx) en la escena = la forma exacta y preferida.
    //   · sin reset(), la red de seguridad: se oculta su contenido durante la transición de regreso.
    //     Un hijo directo con [data-keep] se queda visible (contenido que ya existe desde build y no entra con enter()).
    const replay = entered.has(to)
    if (replay) {
      if (typeof slides[to].reset === 'function') { try { slides[to].reset(ctx) } catch (e) { console.error(`[deck] reset s${to + 1}`, e) } }
      else toEl.classList.add('is-replay')
    }
    toEl.classList.add('is-active'); toEl.setAttribute('aria-hidden', 'false')
    setChapter(to); setNotes(to); counterFlap.set(pad2(to + 1))
    if (fromEl) await Transition(slides[to].transition || 'fade', { dur: T[4], sound }).run(fromEl, toEl, dir)
    if (fromEl) { fromEl.classList.remove('is-active', 'is-leaving'); fromEl.setAttribute('aria-hidden', 'true') }
    current = to
    try { onChange?.(to, { from, total, slide: slides[to], next: slides[to + 1] || null }) } catch (e) { console.warn('[deck] onChange', e) }
    const p = new URLSearchParams(location.search); p.set('slide', String(to + 1)); history.replaceState(null, '', `${location.pathname}?${p}`)
    toEl.classList.remove('is-replay') // enter() aplica sus estados iniciales en el mismo frame: no hay parpadeo
    entered.add(to)
    try { slides[to].enter?.(ctx) } catch (e) { console.error(`[deck] enter s${to + 1}`, e) }
    hint.classList.toggle('is-hidden', to > 0)
    if (nextBtn) { const last = to + 1 >= total; nextBtn.classList.toggle('is-quiet', last); nextBtn.setAttribute('aria-disabled', String(last)) }
    busy = false
    if (to + 1 < total) ensureBuilt(to + 1).then(() => ensurePreloaded(to + 1))
  }
  function next() {
    if (busy || current < 0) return
    sound.start()
    if (slides[current].next?.(ctx)) { sound.play('click'); return }
    if (current + 1 >= total) return
    sound.play('click'); go(current + 1, 1)
  }
  function prev() {
    if (busy || current < 0) return
    sound.start()
    if (slides[current].prev?.(ctx)) { sound.play('click'); return }
    if (current === 0) return
    sound.play('click'); go(current - 1, -1)
  }

  // ---- input ----
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': case 'Enter': e.preventDefault(); next(); break
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': e.preventDefault(); prev(); break
      case 'Home': sound.start(); go(0); break
      case 'End': sound.start(); go(total - 1); break
      case 'm': case 'M': sound.start(); sound.mute(); break
    }
  })
  const INTERACTIVE = 'button, a, input, [data-hotspot], [data-no-advance], canvas[data-scrub]'
  stage.addEventListener('click', (e) => { if (e.target.closest(INTERACTIVE)) return; e.shiftKey ? prev() : next() })
  // Una escena que desborda se queda con el gesto vertical: en modo compacto (móvil, móvil apaisado, ventana baja) los
  // bloques vuelven al flujo y el slide scrollea, así que rueda y swipe arriba/abajo son scroll, no cambio de escena.
  // El swipe horizontal y el clic siguen avanzando. En desktop ningún slide desborda, así que esto no cambia nada.
  const scrolls = () => {
    const s = sections[current]
    if (!s) return false
    const o = getComputedStyle(s).overflowY // en desktop es hidden: el gesto vertical sigue cambiando de escena
    return (o === 'auto' || o === 'scroll') && s.scrollHeight - s.clientHeight > 8
  }
  let wheelAcc = 0, wheelLock = 0
  addEventListener('wheel', (e) => {
    if (e.target.closest('[data-scroll]') || scrolls()) return
    const now = performance.now()
    if (now < wheelLock) return
    wheelAcc += e.deltaY
    if (Math.abs(wheelAcc) > 80) { wheelLock = now + 900; const d = wheelAcc; wheelAcc = 0; d > 0 ? next() : prev() }
  }, { passive: true })
  let sx = 0, sy = 0, st = 0
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; sx = e.clientX; sy = e.clientY; st = performance.now() }, { passive: true })
  addEventListener('pointerup', (e) => {
    // [data-no-swipe]: la escena gestiona su propio swipe (p. ej. los mundos de S04) sin renunciar al click-para-avanzar
    if (e.pointerType === 'mouse' || e.target.closest(INTERACTIVE + ', [data-no-swipe]')) return
    const dx = e.clientX - sx, dy = e.clientY - sy
    if (performance.now() - st > 800) return
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? next() : prev()
    else if (Math.abs(dy) > 64 && !scrolls()) dy < 0 ? next() : prev()
  }, { passive: true })

  ctx.deck = { go, next, prev, root, stage, sections, total, sound, get current() { return current } }

  // ---- efectos globales ----
  if (cursor) Cursor()
  Grain(document.body, { amount: grain })

  // ---- arranque: fuentes → chrome entra → primer slide ----
  try { await Promise.all(fonts.map((f) => document.fonts.load(f))) } catch { /* sigue con fallback */ }
  await document.fonts.ready
  const start = clamp((parseInt(params.get('slide')) || 1) - 1, 0, total - 1)
  await ensureBuilt(start)
  await ensurePreloaded(start)
  document.documentElement.classList.add('is-ready')
  Stagger([...chapterBtns, muteBtn, counter, ...(nextBtn ? [nextBtn] : []), legal, hint], { delay: 40, dur: T[4], from: 'start' })
  await go(start, 1)
  return ctx.deck
}
