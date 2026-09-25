// ContactShadow(el, {blur:24, y:12, alpha:.45}) — la sombra se hornea en el pipeline (cutout-factory);
// este componente solo la posiciona (alinea contact_y con la superficie) o, si el asset aún no trae sombra
// (placeholder), añade una elipse de contacto como fallback. El wrapper del <img> debe ser position:relative.
export function ContactShadow(el, { blur = 24, y = 12, alpha = .45, width = .8, baked = false, contactY = null, surfaceY = null } = {}) {
  const wrap = el.closest('picture')?.parentElement || el.parentElement
  if (baked) {
    if (contactY != null && surfaceY != null && el.naturalHeight) {
      const r = el.getBoundingClientRect()
      const scale = r.height / el.naturalHeight
      wrap.style.setProperty('--sy', `${(surfaceY - contactY * scale).toFixed(1)}px`)
    }
    return { el: null, destroy() {} }
  }
  const sh = document.createElement('i')
  sh.className = 'contact-shadow'
  sh.style.setProperty('--blur', blur + 'px')
  sh.style.setProperty('--y', y + 'px')
  sh.style.setProperty('--alpha', String(alpha))
  sh.style.setProperty('--w', width * 100 + '%')
  wrap.insertBefore(sh, wrap.firstChild)
  return { el: sh, destroy() { sh.remove() } }
}
