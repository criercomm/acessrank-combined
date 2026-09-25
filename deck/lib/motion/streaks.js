// Streaks(canvas, {count, speed, color}) — estelas de luz de exposición larga (canvas 2D, mezcla aditiva)
import { prng } from '../util/prng.js'
import { prefersReduced } from '../util/dom.js'
export function Streaks(canvas, { count = 80, speed = 1, color = '#E8E4DC', angle = 0, length = .3, thickness = 1.2, intensity = 1, fade = .12, seed = 7, dpr = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  const c = canvas.getContext('2d')
  const r = prng(seed)
  const reduced = prefersReduced()
  let on = false, raf = 0, W = 0, H = 0, I = intensity
  const S = Array.from({ length: count }, () => ({ x: r(), y: r(), v: .4 + r() * .9, len: length * (.5 + r()), a: .3 + r() * .7, w: thickness * (.6 + r() * .8) }))
  const cosA = Math.cos(angle), sinA = Math.sin(angle)
  function size() {
    const b = canvas.getBoundingClientRect()
    W = Math.max(1, Math.round(b.width * dpr)); H = Math.max(1, Math.round(b.height * dpr))
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
  }
  function frame() {
    size()
    c.globalCompositeOperation = 'destination-out'
    c.fillStyle = `rgba(0,0,0,${fade})`
    c.fillRect(0, 0, W, H)
    c.globalCompositeOperation = 'lighter'
    c.strokeStyle = color
    c.lineCap = 'round'
    const n = Math.min(count, Math.round(count * I))
    for (let k = 0; k < n; k++) {
      const s = S[k]
      const dx = s.v * speed * .004
      s.x += dx * cosA; s.y += dx * sinA
      // reingresa exactamente en el borde "de donde viene", sirve para cualquier ángulo (no solo 0°/90°):
      // se elige el eje de entrada (x o y) con probabilidad proporcional a |cosA|/|sinA| — el eje dominante
      // del movimiento — y se fija ese borde a -.2 o 1.2 según el signo de avance; el otro eje se sortea en
      // todo el rango visible. Con angle=0 (cosA=1,sinA=0) esto reproduce exactamente el reset original
      // (entra por la izquierda, y al azar); generalizarlo así fue necesario porque el reset previo (un
      // único borde fijo en y=-.2, cualquiera fuera el eje de salida) no correspondía a la dirección de
      // viaje diagonal de S1 (angle=-.5): las partículas reentraban ya "aguas abajo" de sí mismas y quedaban
      // varadas fuera de cuadro para siempre — de ahí la franja de estelas limitada a la esquina superior.
      if (s.x > 1.2 || s.y > 1.2 || s.x < -.2 || s.y < -.2) {
        const denom = Math.abs(cosA) + Math.abs(sinA) || 1
        if (r() * denom < Math.abs(cosA)) { s.x = cosA >= 0 ? -.2 : 1.2; s.y = r() * 1.4 - .2 }
        else { s.y = sinA >= 0 ? -.2 : 1.2; s.x = r() * 1.4 - .2 }
      }
      const x = s.x * W, y = s.y * H, L = s.len * W * .5
      c.globalAlpha = Math.min(1, s.a * I)
      c.lineWidth = s.w * dpr
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - L * cosA, y - L * sinA); c.stroke()
    }
    c.globalAlpha = 1
    if (on && !reduced) raf = requestAnimationFrame(frame)
  }
  function start() { if (on) return; on = true; if (reduced) { for (let k = 0; k < 12; k++) frame(); return } raf = requestAnimationFrame(frame) }
  function stop() { on = false; cancelAnimationFrame(raf) }
  return { start, stop, setIntensity(v) { I = Math.max(0, Math.min(1.5, v)) }, destroy() { stop(); c.clearRect(0, 0, canvas.width, canvas.height) } }
}
