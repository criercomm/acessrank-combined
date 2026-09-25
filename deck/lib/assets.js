// createAssets(manifest, {base}) — acceso a los assets del deck vía manifest.json (procedencia = receipts).
// Un asset con status "final" y files{avif,webp}{w} se sirve como <picture> con srcset; cualquier otro → placeholder.
// Nada entra a un slide sin fila en el manifest: img()/url() lanzan si el id no existe.
import { loadImage, supportsAvif, el } from './util/dom.js'
import { placeholder } from './placeholder.js'
export function createAssets(manifest, { base = '' } = {}) {
  // base = prefijo del despliegue (import.meta.env.BASE_URL). Las rutas del manifest son relativas ("assets/final/x.avif"):
  // sin prefijo el navegador las resuelve contra la URL actual, así que en /deck/ cargan y en /deck (sin barra final, que
  // el servidor sirve igual sin redirigir) buscan /assets/... y dan 404 — imágenes y audio rotos en todo el deck.
  const root = base && base !== './' ? base.replace(/\/+$/, '') + '/' : base
  const join = (p) => (root && !/^(https?:|data:|\/)/.test(p) ? root + String(p).replace(/^\.?\//, '') : p)
  const byId = new Map()
  for (const a of manifest.assets) byId.set(a.id, a)
  let avif = true
  const ready = supportsAvif().then((ok) => { avif = ok; return ok })
  const isFinal = (a) => !!(a && a.status === 'final' && a.files)
  function pick(a, w) {
    const f = (avif && a.files.avif) || a.files.webp || a.files.avif
    if (!f) return null
    const ws = Object.keys(f).map(Number).sort((x, y) => x - y)
    const best = ws.find((x) => x >= w) ?? ws[ws.length - 1]
    return join(f[best])
  }
  function must(id) { const a = byId.get(id); if (!a) throw new Error(`[assets] "${id}" no está en manifest.json`); return a }
  function url(id, w = 800) { const a = must(id); return isFinal(a) ? pick(a, w) : placeholder(a, w) }
  function srcset(a, fmt) { const f = a.files?.[fmt]; return f ? Object.entries(f).map(([w, p]) => `${join(p)} ${w}w`).join(', ') : '' }
  function img(id, { w = 800, sizes = '50vw', alt = '', className = '', lazy = false } = {}) {
    const a = must(id)
    if (!isFinal(a)) {
      const im = el('img', { class: className, alt, width: a.w, height: a.h, decoding: 'async', 'data-asset': id, 'data-placeholder': '' })
      im.src = placeholder(a, w)
      return im
    }
    const pic = el('picture')
    if (a.files.avif) pic.append(el('source', { type: 'image/avif', srcset: srcset(a, 'avif'), sizes }))
    if (a.files.webp) pic.append(el('source', { type: 'image/webp', srcset: srcset(a, 'webp'), sizes }))
    pic.append(el('img', { class: className, alt, width: a.w, height: a.h, decoding: 'async', loading: lazy ? 'lazy' : 'eager', src: pick(a, w), 'data-asset': id }))
    return pic
  }
  function list(fn) { return manifest.assets.filter(typeof fn === 'function' ? fn : (a) => a.group === fn) }
  function get(id) { return byId.get(id) }
  async function preload(ids, w = 800) { await ready; return Promise.all(ids.map((id) => loadImage(url(id, w)).catch(() => null))) }
  function stats() { const t = manifest.assets.length, f = manifest.assets.filter(isFinal).length; return { total: t, final: f, placeholder: t - f } }
  return { get, list, url, img, preload, ready, stats, isFinal, manifest }
}
