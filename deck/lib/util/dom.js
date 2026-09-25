// /decks/lib/util/dom.js — utilidades DOM mínimas
export const qs = (s, r = document) => r.querySelector(s)
export const qsa = (s, r = document) => Array.from(r.querySelectorAll(s))
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (val == null) continue; p.startsWith('--') ? n.style.setProperty(p, String(val)) : (n.style[p] = val) }
    else if (k === 'text') n.textContent = v
    else if (k === 'html') n.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)))
  return n
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const pad2 = (n) => String(n).padStart(2, '0')
export const prefersReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
export const isCoarse = () => matchMedia('(pointer: coarse)').matches
export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
export function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image()
    im.decoding = 'async'
    im.onload = () => (im.decode ? im.decode().catch(() => {}).then(() => res(im)) : res(im))
    im.onerror = () => rej(new Error('img: ' + src))
    im.src = src
  })
}
let _avif
export function supportsAvif() {
  if (_avif) return _avif
  _avif = new Promise((res) => {
    const im = new Image()
    im.onload = () => res(im.width > 0)
    im.onerror = () => res(false)
    im.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A='
  })
  return _avif
}
