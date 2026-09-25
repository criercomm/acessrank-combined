// SoundBus — un bus: cama + SFX; ducking −9 dB bajo clacks/braam; mute persistente (cookie); arranca al primer avance.
// Si un SFX no tiene archivo registrado (o falla la carga), suena una síntesis procedural equivalente (Web Audio),
// así el deck cumple "toda transición con sonido" desde el primer día. Los archivos Freesound CC0 en assets/audio
// reemplazan la síntesis con solo registrarlos: SoundBus.register({ click: 'assets/audio/click-soft.opus', ... }).
// Un nombre puede registrar varias variantes con un array de rutas (p. ej. clack: [a, b, c]):
// se cargan todas y play(name) elige una al azar entre las que sí cargaron.
const DB = (db) => Math.pow(10, db / 20)
const LEVEL = { click: 1, whoosh: 1, clack: 1, 'clack-soft': .5, tick: DB(-18), blip: DB(-6), braam: 1, power: 1, 'power-off': 1, bed: 1 }
const BED_GAIN = DB(-14)
const readCookie = (k) => document.cookie.split('; ').find((c) => c.startsWith(k + '='))?.split('=')[1]

function noise(ctx, dur) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}
function env(g, peak, a, d, t0) {
  g.gain.setValueAtTime(.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(peak, .0001), t0 + a)
  g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d)
}
const SYNTH = {
  click(ctx, out, gain, rate) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(1400 * rate, t); o.frequency.exponentialRampToValueAtTime(500 * rate, t + .05)
    env(g, .16 * gain, .002, .06, t); o.connect(g); g.connect(out); o.start(t); o.stop(t + .09)
  },
  whoosh(ctx, out, gain, rate) {
    const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    s.buffer = noise(ctx, .32); f.type = 'bandpass'; f.Q.value = 1.2
    f.frequency.setValueAtTime(300 * rate, t); f.frequency.exponentialRampToValueAtTime(2600 * rate, t + .14); f.frequency.exponentialRampToValueAtTime(600 * rate, t + .28)
    env(g, .14 * gain, .06, .22, t); s.connect(f); f.connect(g); g.connect(out); s.start(t)
  },
  clack(ctx, out, gain, rate) {
    const t = ctx.currentTime
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    s.buffer = noise(ctx, .05); f.type = 'lowpass'; f.frequency.value = 1800 * rate; f.Q.value = 2
    env(g, .45 * gain, .001, .035, t); s.connect(f); f.connect(g); g.connect(out); s.start(t)
    const o = ctx.createOscillator(), g2 = ctx.createGain()
    o.type = 'triangle'; o.frequency.value = 210 * rate
    env(g2, .10 * gain, .001, .03, t); o.connect(g2); g2.connect(out); o.start(t); o.stop(t + .05)
  },
  'clack-soft'(ctx, out, gain, rate) { SYNTH.clack(ctx, out, gain * .6, rate * 1.1) },
  tick(ctx, out, gain, rate) {
    const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    s.buffer = noise(ctx, .02); f.type = 'highpass'; f.frequency.value = 3200 * rate
    env(g, .9 * gain, .001, .015, t); s.connect(f); f.connect(g); g.connect(out); s.start(t)
  },
  // blip de interfaz (pantalla que enciende, LED): seno 1900→1750 Hz, 80 ms, sin barrido cómico
  blip(ctx, out, gain, rate) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(1900 * rate, t); o.frequency.linearRampToValueAtTime(1750 * rate, t + .08)
    env(g, .2 * gain, .0015, .06, t); o.connect(g); g.connect(out); o.start(t); o.stop(t + .09)
  },
  // encendido de una habitación: swell filtrado que sube (power) o baja (power-off)
  power(ctx, out, gain, rate, down = false) {
    const t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    const d = down ? .9 : 1.2
    o.type = 'sawtooth'
    o.frequency.setValueAtTime((down ? 220 : 90) * rate, t); o.frequency.exponentialRampToValueAtTime((down ? 70 : 220) * rate, t + d * .6)
    f.type = 'lowpass'; f.Q.value = 3
    f.frequency.setValueAtTime(down ? 1600 : 300, t); f.frequency.exponentialRampToValueAtTime(down ? 200 : 1800, t + d * .5); f.frequency.exponentialRampToValueAtTime(down ? 120 : 400, t + d)
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12 * gain, t + (down ? .05 : .3)); g.gain.exponentialRampToValueAtTime(.0001, t + d)
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + d + .05)
  },
  'power-off'(ctx, out, gain, rate) { SYNTH.power(ctx, out, gain, rate, true) },
  braam(ctx, out, gain, rate) {
    const t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter()
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.26 * gain, t + .35); g.gain.exponentialRampToValueAtTime(.0001, t + 1.6)
    f.type = 'lowpass'; f.frequency.setValueAtTime(220, t); f.frequency.exponentialRampToValueAtTime(900, t + .5); f.frequency.exponentialRampToValueAtTime(180, t + 1.6)
    f.connect(g); g.connect(out)
    ;[55, 55.6, 110.3].forEach((hz, i) => { const o = ctx.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'sine'; o.frequency.value = hz * rate; o.connect(f); o.start(t); o.stop(t + 1.7) })
  },
}
// Cama procedural (placeholder hasta que llegue el track de Suno): pulso 92 bpm + pads cálidos, muy bajo.
function synthBed(ctx, out, bpm = 92) {
  const beat = 60 / bpm
  const pad = ctx.createGain(); pad.gain.value = .5
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700
  pad.connect(lp); lp.connect(out)
  const chords = [[110, 164.81, 220, 277.18], [98, 146.83, 196, 246.94], [87.31, 130.81, 174.61, 220], [110, 164.81, 220, 261.63]]
  const oscs = chords[0].map((hz) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz; const g = ctx.createGain(); g.gain.value = .11; o.connect(g); g.connect(pad); o.start(); return o })
  const lfo = ctx.createOscillator(); lfo.frequency.value = .07; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(lp.frequency); lfo.start()
  let n = 0, next = ctx.currentTime + .1, timer = 0
  function pulse(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + .12); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + .28); o.connect(g); g.connect(out); o.start(t); o.stop(t + .3) }
  function hat(t) { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise(ctx, .03); f.type = 'highpass'; f.frequency.value = 6000; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.04, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + .03); s.connect(f); f.connect(g); g.connect(out); s.start(t) }
  function schedule() {
    while (next < ctx.currentTime + .6) {
      if (n % 4 === 0) { const ch = chords[Math.floor(n / 4) % chords.length]; oscs.forEach((o, i) => o.frequency.setTargetAtTime(ch[i], next, .4)) }
      pulse(next); hat(next + beat / 2); next += beat; n++
    }
    timer = setTimeout(schedule, 200)
  }
  schedule()
  return { stop() { clearTimeout(timer); oscs.forEach((o) => o.stop()); lfo.stop() } }
}

export const SoundBus = (() => {
  let ctx = null, master, sfx, bedG, started = false, bedSynth = null, bedNode = null
  let muted = readCookie('deck_mute') === '1'
  const files = new Map(), buffers = new Map(), last = new Map(), listeners = new Set()
  function ensure() {
    if (ctx) return ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1
    sfx = ctx.createGain(); bedG = ctx.createGain(); bedG.gain.value = 0
    sfx.connect(master); bedG.connect(master); master.connect(ctx.destination)
    return ctx
  }
  async function load(name, url) {
    files.set(name, url)
    if (!ensure()) return
    if (Array.isArray(url)) {
      // Varias variantes para un mismo nombre (p. ej. clack: [a,b,c]): se cargan todas las que
      // resuelvan; play() elige una al azar entre las cargadas. Si ninguna carga, sigue la síntesis.
      const decoded = []
      for (const u of url) {
        try { const r = await fetch(u); if (!r.ok) throw new Error(r.status); decoded.push(await ctx.decodeAudioData(await r.arrayBuffer())) } catch { /* se ignora esa variante, siguen las demás */ }
      }
      if (decoded.length) buffers.set(name, decoded)
      return
    }
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); buffers.set(name, await ctx.decodeAudioData(await r.arrayBuffer())) } catch { /* fallback procedural */ }
  }
  function register(map) { for (const [k, v] of Object.entries(map || {})) if (v || (k === 'bed' && v === false)) files.set(k, v) }
  async function startBed() {
    const url = files.get('bed')
    if (url === false) return // deck sin cama (p. ej. Hyundai "Quiet Motion" hasta que exista su track): ni archivo ni síntesis
    const now = () => ctx.currentTime
    if (url) {
      try {
        const r = await fetch(url); if (!r.ok) throw new Error(r.status)
        const buf = await ctx.decodeAudioData(await r.arrayBuffer())
        bedNode = ctx.createBufferSource(); bedNode.buffer = buf; bedNode.loop = true; bedNode.connect(bedG); bedNode.start()
        bedG.gain.setValueAtTime(0, now()); bedG.gain.linearRampToValueAtTime(BED_GAIN, now() + 1.2)
        return
      } catch { /* sigue a la síntesis */ }
    }
    bedSynth = synthBed(ctx, bedG)
    bedG.gain.setValueAtTime(0, now()); bedG.gain.linearRampToValueAtTime(BED_GAIN, now() + 1.2)
  }
  function start() {
    if (!ensure()) return
    if (ctx.state === 'suspended') ctx.resume()
    if (started) return
    started = true
    for (const [k, u] of files) if (k !== 'bed' && !buffers.has(k)) load(k, u)
    startBed()
  }
  function duck(ms = 350) {
    if (!ctx || !started) return
    const t = ctx.currentTime
    bedG.gain.cancelScheduledValues(t)
    bedG.gain.setValueAtTime(bedG.gain.value, t)
    bedG.gain.linearRampToValueAtTime(BED_GAIN * DB(-9), t + .04)
    bedG.gain.linearRampToValueAtTime(BED_GAIN, t + .04 + ms / 1000)
  }
  function play(name, { gain = 1, rate = 1, throttle = 24 } = {}) {
    if (!ctx || muted || ctx.state !== 'running') return
    const n = performance.now()
    if (n - (last.get(name) || 0) < throttle) return
    last.set(name, n)
    const g = gain * (LEVEL[name] ?? 1)
    const loaded = buffers.get(name)
    const buf = Array.isArray(loaded) ? loaded[(Math.random() * loaded.length) | 0] : loaded
    if (buf) {
      const s = ctx.createBufferSource(), gn = ctx.createGain()
      s.buffer = buf; s.playbackRate.value = rate; gn.gain.value = g
      s.connect(gn); gn.connect(sfx); s.start()
      if (name === 'clack') duck(300)
      if (name === 'braam') duck(1200)
      if (name === 'power' || name === 'power-off') duck(700)
      // clips largos (voces): el que llama puede encadenar por duración y cortar al salir de la escena
      return { duration: buf.duration / rate, stop: () => { try { s.stop() } catch { /* ya terminó */ } } }
    } else SYNTH[name]?.(ctx, sfx, g, rate)
    if (name === 'clack') duck(300)
    if (name === 'braam') duck(1200)
    if (name === 'power' || name === 'power-off') duck(700)
    return null
  }
  function mute(v = !muted) {
    muted = v
    document.cookie = `deck_mute=${v ? 1 : 0}; path=/; max-age=31536000; SameSite=Lax`
    if (master) master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, .05)
    listeners.forEach((f) => f(muted))
  }
  // Deck M: arranque en silencio por defecto (spec §7) — solo si el visitante no ha elegido ya (cookie).
  function defaultMuted(v) { if (readCookie('deck_mute') == null) { muted = !!v; if (master) master.gain.value = muted ? 0 : 1; listeners.forEach((f) => f(muted)) } }
  return { start, play, duck, mute, defaultMuted, register, load, onMute: (f) => listeners.add(f), get muted() { return muted }, get started() { return started } }
})()
