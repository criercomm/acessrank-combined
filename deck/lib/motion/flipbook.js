// Flipbook(frames[], {fps:12–24, hold:600, scrub:bool, tick:bool}) — montaje a velocidad sobre canvas.
// preload() en el slide anterior; scrub = pointer-x → frame; tick = SFX por frame; reduced-motion = último frame.
import { clamp, loadImage, prefersReduced } from '../util/dom.js'
export function Flipbook(frames, { fps = 16, hold = 600, scrub = false, tick = false, loop = false, canvas = null, fit = 'contain', sound = null, onFrame, onEnd, dpr = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  const cv = canvas || document.createElement('canvas')
  cv.classList.add('flipbook')
  if (scrub) cv.dataset.scrub = ''
  const c = cv.getContext('2d', { alpha: true })
  const reduced = prefersReduced()
  let imgs = null, loading = null, i = -1, playing = false, raf = 0, acc = 0, last = 0, holdLeft = 0, scrubbing = false
  function preload() {
    if (!loading) loading = Promise.all(frames.map((f) => loadImage(typeof f === 'string' ? f : f.src).catch(() => null))).then((arr) => (imgs = arr))
    return loading
  }
  function size() {
    const r = cv.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr))
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  }
  function draw(n) {
    if (!imgs) return
    size()
    const im = imgs[n]
    c.clearRect(0, 0, cv.width, cv.height)
    if (!im) return
    const s = fit === 'cover' ? Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight) : Math.min(cv.width / im.naturalWidth, cv.height / im.naturalHeight)
    const w = im.naturalWidth * s, h = im.naturalHeight * s
    c.drawImage(im, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
  }
  function seek(n, silent = false) {
    const nn = clamp(Math.round(n), 0, frames.length - 1)
    if (nn === i) return
    i = nn
    draw(i)
    if (tick && !silent && sound) sound.play('tick', { throttle: 1000 / 40 })
    onFrame?.(i)
  }
  function step(t) {
    if (!playing) return
    if (!last) last = t
    const dt = Math.min(100, t - last); last = t
    if (holdLeft > 0) {
      holdLeft -= dt
      if (holdLeft <= 0) { if (loop) { holdLeft = 0; seek(0) } else { playing = false; onEnd?.(); return } }
    } else {
      acc += dt
      const per = 1000 / fps
      while (acc >= per) {
        acc -= per
        if (i >= frames.length - 1) {
          if (hold > 0) { holdLeft = hold; acc = 0; break }
          if (loop) { seek(0); continue } // loop sin hold: reinicia en el mismo tick
          playing = false; onEnd?.(); return
        }
        seek(i + 1)
      }
    }
    raf = requestAnimationFrame(step)
  }
  async function play() {
    await preload()
    if (reduced) { seek(frames.length - 1, true); onEnd?.(); return }
    if (playing) return
    playing = true; last = 0; acc = 0; holdLeft = 0
    if (i < 0 || i >= frames.length - 1) seek(0, true)
    raf = requestAnimationFrame(step)
  }
  function pause() { playing = false; cancelAnimationFrame(raf) }
  function scrubTo(x) { pause(); seek(x * (frames.length - 1)) }
  if (scrub) {
    const onMove = (e) => { if (!scrubbing) return; const r = cv.getBoundingClientRect(); scrubTo(clamp((e.clientX - r.left) / r.width, 0, 1)) }
    const onDown = (e) => { scrubbing = true; try { cv.setPointerCapture(e.pointerId) } catch {} onMove(e) }
    const onUp = () => { scrubbing = false }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
  }
  return {
    canvas: cv, preload, play, pause, seek, scrubTo,
    redraw() { if (i >= 0) draw(i) },
    destroy() { pause(); imgs = null },
    get frame() { return i }, get length() { return frames.length }, get playing() { return playing }, get loaded() { return !!imgs },
  }
}
