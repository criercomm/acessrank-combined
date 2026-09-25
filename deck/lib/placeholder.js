// placeholder(asset, w) — imagen provisional por grupo (tile / hero / device / silhouette), determinista por id.
// Se usa mientras el asset del manifest está en status "pending". Lleva etiqueta para que el QA vea qué falta.
import { prng, hashSeed } from './util/prng.js'
const cache = new Map()
function glow(c, x, y, rad, color, alpha, blur) { c.save(); c.filter = `blur(${blur}px)`; c.globalAlpha = alpha; c.fillStyle = color; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); c.restore() }
function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r) }
const DRAW = {
  tile(c, W, H, r) {
    c.fillStyle = '#0c0e12'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#090a0d'; c.fillRect(0, H * .72, W, H * .28)
    const wx = W * (.08 + r() * .5), ww = W * (.18 + r() * .25), wy = H * (.12 + r() * .2), wh = H * (.3 + r() * .3)
    c.fillStyle = `rgba(232,176,112,${(.10 + r() * .1).toFixed(3)})`; c.fillRect(wx, wy, ww, wh)
    const n = 2 + Math.floor(r() * 3)
    for (let i = 0; i < n; i++) glow(c, W * (.1 + r() * .8), H * (.2 + r() * .5), W * (.01 + r() * .02), '#ffb46b', .7, W * .02)
    const m = 2 + Math.floor(r() * 3)
    for (let i = 0; i < m; i++) { c.fillStyle = `rgba(30,32,38,${(.7 + r() * .3).toFixed(2)})`; const bw = W * (.1 + r() * .25), bh = H * (.08 + r() * .18); c.fillRect(W * r() * .85, H * .72 - bh, bw, bh) }
    c.strokeStyle = '#000'; c.lineWidth = Math.max(2, W * .006); c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, W - c.lineWidth, H - c.lineWidth)
  },
  hero(c, W, H, r) {
    c.fillStyle = '#07080b'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#05060a'; c.fillRect(0, H * .68, W, H * .32)
    const hx = W / 2, hy = H * .68, hw = W * .22, hh = H * .34
    glow(c, hx, hy - hh * .5, hw * .9, '#e8e4dc', .16, W * .05)
    c.fillStyle = 'rgba(232,228,220,.85)'
    c.beginPath(); c.moveTo(hx - hw / 2, hy); c.lineTo(hx - hw / 2, hy - hh * .6); c.lineTo(hx, hy - hh); c.lineTo(hx + hw / 2, hy - hh * .6); c.lineTo(hx + hw / 2, hy); c.closePath(); c.fill()
    c.fillStyle = '#0b0c10'; c.fillRect(hx - hw / 2 + W * .01, hy - hh * .6 + H * .02, hw - W * .02, hh * .6 - H * .02)
    c.fillStyle = 'rgba(255,190,120,.9)'; c.fillRect(hx - hw * .06, hy - hh * .32, hw * .12, hh * .32)
    c.save(); c.globalAlpha = .25; c.translate(0, hy * 2); c.scale(1, -1); c.fillRect(hx - hw * .06, hy - hh * .32, hw * .12, hh * .32); c.restore()
    for (let i = 0; i < 5; i++) glow(c, W * r(), H * (.1 + r() * .4), W * .006, '#ffb46b', .5, W * .01)
  },
  device(c, W, H) {
    const pad = W * .1, bw = W - pad * 2, bh = H * .74, x = pad, y = H * .08
    c.save(); c.filter = `blur(${W * .03}px)`; c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(W / 2, y + bh + H * .02, bw * .5, H * .035, 0, 0, Math.PI * 2); c.fill(); c.restore()
    c.fillStyle = '#1a1d23'; rrect(c, x, y, bw, bh, Math.min(bw, bh) * .08); c.fill()
    c.fillStyle = '#0a0c10'; rrect(c, x + bw * .06, y + bh * .06, bw * .88, bh * .88, Math.min(bw, bh) * .05); c.fill()
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = Math.max(1, W * .004); c.beginPath(); c.moveTo(x + bw * .08, y + c.lineWidth); c.lineTo(x + bw * .92, y + c.lineWidth); c.stroke()
  },
  silhouette(c, W, H) {
    const cx = W / 2, top = H * .06, hr = W * .16
    c.save(); c.filter = `blur(${W * .05}px)`; c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(cx, H * .97, W * .3, H * .02, 0, 0, Math.PI * 2); c.fill(); c.restore()
    c.fillStyle = '#12141a'
    c.beginPath(); c.arc(cx, top + hr, hr, 0, Math.PI * 2); c.fill()
    rrect(c, cx - W * .3, top + hr * 2.1, W * .6, H * .5, W * .12); c.fill()
    c.fillRect(cx - W * .24, top + hr * 2.1 + H * .45, W * .2, H * .38); c.fillRect(cx + W * .04, top + hr * 2.1 + H * .45, W * .2, H * .38)
    c.strokeStyle = 'rgba(232,228,220,.25)'; c.lineWidth = Math.max(1, W * .01); c.beginPath(); c.arc(cx, top + hr, hr, -Math.PI * .9, -Math.PI * .1); c.stroke()
  },
}
// Cada deck registra los dibujos de sus grupos propios (angle, part, ingredient, layer…) sin tocar este archivo:
//   registerPlaceholder('angle', (ctx2d, W, H, rng, asset) => { … })
export function registerPlaceholder(group, draw) { DRAW[group] = draw }
export function placeholder(a, w = 800) {
  const key = a.id + '@' + w
  if (cache.has(key)) return cache.get(key)
  const aw = a.w || 1600, ah = a.h || 900
  const W = Math.min(w, aw), H = Math.max(1, Math.round(W * ah / aw))
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d')
  const r = prng(hashSeed(a.id))
  ;(DRAW[a.group] || DRAW.tile)(c, W, H, r, a)
  c.filter = 'none'; c.globalAlpha = 1
  c.fillStyle = 'rgba(232,228,220,.35)'
  c.font = `${Math.max(9, Math.round(W / 70))}px ui-monospace, monospace`
  c.textBaseline = 'bottom'
  c.fillText('placeholder · ' + a.id, Math.round(W * .03), H - Math.round(W * .03))
  let out
  try { out = cv.toDataURL('image/webp', .8) } catch { out = cv.toDataURL() }
  cache.set(key, out)
  return out
}
