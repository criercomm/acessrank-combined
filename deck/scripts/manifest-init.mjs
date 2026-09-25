#!/usr/bin/env node
// manifest-init.mjs — crea/actualiza manifest.json del Deck R · AccessRank "Fix the code. Prove it." con todas las filas
// planeadas (PLAN.md §4) y sus prompts (sujeto + STYLE-LOCK R + negativos). Idempotente: conserva status/files/source/credits/qa
// de filas existentes. Uso: node scripts/manifest-init.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'manifest.json')
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
const prevById = new Map((prev?.assets || []).map((a) => [a.id, a]))
const today = new Date().toISOString().slice(0, 10)

// ---- style-lock R (obligatorio en todo prompt) ----
const NEG = 'No logos, no text, no watermark, no visible faces, no brand names, no screens with UI.'
const LOCK = 'Dark studio product photography, deep navy seamless background, single cool key light from top-left, warm amber rim light, 85mm lens, matte surfaces, plain matte floor, clean silhouette edges for cut-out.'
const LOCK_PLATE = 'deep navy sky, a few warm amber windows, still water reflection in the foreground, restrained palette of navy, amber and white, subtle film grain, negative space in the upper third for typography. 24mm lens, full-frame cinema camera.'

// ---- modelos y costo unitario (simulate_cost / respuesta del MCP, 2026-09-14) ----
const M = {
  seedream: { model: 'seedream-5-pro (Magnific) 2k', credits: 100 },
  gpt2: { model: 'gpt-2 (Magnific) 2k high, transparent background', credits: 600 },
  render: { model: 'render local del PDF (PyMuPDF) + desenfoque (sin costo)', credits: 0 },
  lyria: { model: 'audio_music_generate google-lyria-3-pro 90s', credits: 160 },
  crop: { model: 'crop local de una hoja (sin costo)', credits: 0 },
}

const assets = []
function row(id, slide, group, w, h, m, prompt, note, extra = {}) {
  const p = prevById.get(id)
  assets.push({
    id, slide, group, kind: extra.kind || 'image', status: p?.status || 'pending',
    file: p?.file || null, files: p?.files || null,
    w: p?.w || w, h: p?.h || h, anchor: extra.anchor || 'center', z: extra.z ?? 1, shadow: extra.shadow ?? false,
    contactY: p?.contactY ?? null, ratio: extra.ratio || null, note,
    source: {
      model: m.model, prompt, refs: extra.refs || [], candidates: p?.source?.candidates || extra.candidates || [],
      creation: p?.source?.creation || extra.creation || null, date: p?.source?.date || extra.date || null,
      credits: p?.source?.credits ?? m.credits, count: extra.count || 1, chosen_by: p?.source?.chosen_by || extra.chosen_by || null,
    },
    qa: p?.qa || null,
  })
}
const P = (subject) => `${subject} ${LOCK} ${NEG}`

// ---- Lote 1 · hojas (2 candidatos cada una; 1 curada) ----
const SHEET_A = 'Contact sheet of four separate ecommerce products evenly spaced in a single row, generous gaps between them, none touching: an original-design running sneaker in off-white and slate with no brand marks; a frosted glass skincare pump bottle with a blank label area; a matte cream ceramic candle in a short vessel; a pair of matte black over-ear headphones standing upright.'
const SHEET_B = 'Contact sheet of four separate ecommerce products evenly spaced in a single row, generous gaps between them, none touching: a neatly folded oatmeal knit sweater; a tan full-grain leather bifold wallet standing slightly open; a matte sage-green insulated steel water bottle; a small brass and black articulated desk lamp switched off.'
const TRIO = 'Three separate human figures seen strictly from behind, widely spaced in a single row with generous gaps, none touching, faces never visible: on the left a person seated at a desk typing on a laptop, in the middle a standing person holding a phone in one hand, on the right a person in a manual wheelchair at a desk. Backlit by a warm amber rim light with a cool key from top-left, dark studio,'
row('dR-s01-product-sheet-A', 1, 'sheet', 2048, 1152, M.seedream, P(SHEET_A), 'Lote 1 · hoja A (count 2, curada la 2: WDhfmFjcXe). Se trocea en 4 cut-outs.', { ratio: '16:9', count: 2, candidates: ['VXCQf5yMMU', 'WDhfmFjcXe'], creation: 'WDhfmFjcXe', date: '2026-09-14', chosen_by: 'Claude (nitidez, luz, textura)' })
row('dR-s01-product-sheet-B', 1, 'sheet', 2048, 1152, M.seedream, P(SHEET_B), 'Lote 1 · hoja B (count 2, curada la 1: cpvChb40eP, lámpara apagada como pedía el prompt).', { ratio: '16:9', count: 2, candidates: ['cpvChb40eP', 'xS6RNYKjfW'], creation: 'cpvChb40eP', date: '2026-09-14', chosen_by: 'Claude' })
row('dR-s05-silhouette-sheet', 5, 'sheet', 2048, 1152, M.seedream, P(TRIO), 'Lote 1 · trío de siluetas (count 2, curada la 2: xS6RNMXjfW; las tres estrictamente de espaldas). QA: ningún rasgo facial.', { ratio: '16:9', count: 2, candidates: ['mErL197hJQ', 'xS6RNMXjfW'], creation: 'xS6RNMXjfW', date: '2026-09-14', chosen_by: 'Claude (regla de rostros)' })

// ---- cut-outs derivados de las hojas (sin costo) ----
const PRODUCTS = { sneaker: 'A', skincare: 'A', candle: 'A', headphones: 'A', sweater: 'B', wallet: 'B', bottle: 'B', lamp: 'B' }
for (const [k, sheet] of Object.entries(PRODUCTS)) row(`dR-s01-product-${k}`, 1, 'product', 1000, 1000, M.crop, '', `S01/S04 · cut-out ${k} recortado de la hoja ${sheet} → cutout-factory (QA + sombra) → AVIF/WebP.`, { refs: [`dR-s01-product-sheet-${sheet}`], shadow: true, z: 3 })
for (const k of ['operator', 'client', 'shopper']) row(`dR-s05-silhouette-${k}`, 5, 'silhouette', 900, 1100, M.crop, '', `S05 · silueta ${k} (de espaldas) recortada del trío → cutout-factory.`, { refs: ['dR-s05-silhouette-sheet'], shadow: true, z: 2 })

// ---- Lote 1 · piezas únicas ----
row('dR-s02-letter-envelope', 2, 'letter', 2048, 1365, M.seedream,
  P('A single closed cream-colored legal envelope with a dark red wax seal, seen from a slight three-quarter angle, resting flat on a plain surface, the corner of a folded formal letter showing at the flap, the envelope centered with generous empty space around it.') + ' No handwriting, no stamps.',
  'S02 · el sobre de demanda (count 2, curado el 1: gO2zZpASXO, plano y centrado). Cut-out con sombra.', { ratio: '3:2', count: 2, candidates: ['gO2zZpASXO', 'rgN39cnxtc'], creation: 'gO2zZpASXO', date: '2026-09-14', chosen_by: 'Claude', shadow: true, z: 3 })
row('dR-s08-plate-dallas', 8, 'plate', 2048, 878, M.seedream,
  `Wide cinematic view of the downtown Dallas, Texas skyline at blue-hour dusk seen from across the Trinity River floodplain, the ball-topped observation tower and the tall skyscrapers outlined in soft light, ${LOCK_PLATE} No logos, no text, no signage, no watermark, no visible faces, no people, no billboards.`,
  'S08 · placa de Dallas 21:9 (count 2). Sin uso desde la V2 (JP quitó Dallas); se conserva como asset.', { ratio: '21:9', count: 2, candidates: ['ks46PDg16B', 'Lw32iBnswO'], date: '2026-09-14', z: 0 })

// ---- V2 (2026-09-15, notas de JP) ----
row('dR-s01-mockup-home', 1, 'mockup', 2048, 1152, M.gpt2,
  'A floating 3D mockup of an ecommerce website home page for a fictional outdoor lifestyle brand called "Northline Goods", rendered as a tilted browser window in perspective with a few product cards lifted out of the page as separate floating layers; nav, hero "Built for cold mornings.", yellow button, six product cards, newsletter strip; deep navy UI, white text, single yellow accent; single cool key light from top-left with a warm amber rim light. Isolated on a transparent background. No real brand logos, no watermark, no visible faces.',
  'S01 (V2) · home de ecommerce en 3D (JP). gpt-2 con fondo transparente, count 2; candidato Seedream (P30CEey42C, 1l9Dp2Gr4r) como plan B. Cut-out + sombra vía cutout-factory --keep-alpha.', { ratio: '16:9', count: 2, candidates: ['CqlAGl1EEy', 'lJZo8Zcgv9'], date: '2026-09-15', shadow: true, z: 3 })
row('dR-s01-mockup-single', 1, 'mockup', 2048, 1152, M.gpt2,
  'A single floating 3D mockup of an ecommerce website home page for a fictional outdoor lifestyle brand called "Northline Goods", one tilted browser window in perspective, nothing floating outside it; nav, hero "Built for cold mornings.", yellow button, six product cards, newsletter strip; deep navy UI, white text, single yellow accent; single cool key light from top-left with a warm amber rim light. Isolated on a transparent background. No real brand logos, no watermark, no visible faces.',
  'S01 (V3, JP): solo la ventana principal, sin tarjetas flotantes; se muestra un 12 % más grande. gpt-2 fondo transparente, count 1 (el segundo candidato lo rechazó el límite de uso de gpt-2).', { ratio: '16:9', count: 1, candidates: ['mErc2HuhJQ'], creation: 'mErc2HuhJQ', date: '2026-09-15', shadow: true, z: 3 })
row('dR-s02-letter-page', 2, 'page', 1714, 2218, M.render, '',
  'S02 (V2) · página 1 del complaint real (Martinez v. Ecofish, Kings County, 2026-03-18) renderizada con scripts/letter-page.py; 24 regiones desenfocadas (personas, direcciones, teléfono, email, bufete, cliente, índice). Sin costo.', { date: '2026-09-15', z: 2 })

// ---- audio ----
row('dR-bed', 0, 'audio', 0, 0, M.lyria, 'quiet confident electronic pulse, warm analog pads, subtle sub bass, minimal percussion, 96 bpm, instrumental, cinematic corporate, narrow stereo, no vocals', 'Cama 90 s (Lyria 3 Pro, 160 cr.) → −16 LUFS, loop, Opus. Arranca al entrar con sonido.', { kind: 'audio' })

const manifest = {
  deck: 'R', name: 'Accessrank · Fix the code. Prove it.', brand: 'Accessrank (nombre solo en texto)', spine: 'Widgets hide the problem. AccessRank fixes the code — and proves it.',
  styleLock: { lock: LOCK, plate: LOCK_PLATE, negatives: NEG, note: 'Todo prompt lleva LOCK + NEG. Productos = diseños originales de la tienda ficticia "Northline Goods". Siluetas siempre de espaldas.' },
  credits: prev?.credits || { ceiling: 10000, warnAt: 8000, generationsCeiling: 60, balanceStart: 23035, balanceDate: '2026-09-14', spent: 0, generations: 0, log: [] },
  audio: prev?.audio || { bed: null, muted: false, sfx: { click: 'assets/audio/sfx-click.opus', whoosh: 'assets/audio/sfx-whoosh.opus', clack: ['assets/audio/sfx-clack-1.opus', 'assets/audio/sfx-clack-2.opus', 'assets/audio/sfx-clack-3.opus'], tick: 'assets/audio/sfx-tick.opus', blip: 'assets/audio/sfx-blip.opus', braam: 'assets/audio/sfx-braam.opus', power: 'assets/audio/sfx-room-on.opus', 'power-off': 'assets/audio/sfx-room-off.opus' } },
  updated: today,
  assets,
}
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
const byStatus = assets.reduce((m, a) => ((m[a.status] = (m[a.status] || 0) + 1), m), {})
const byGroup = assets.reduce((m, a) => ((m[a.group] = (m[a.group] || 0) + 1), m), {})
const planned = assets.reduce((s, a) => s + (a.source.credits || 0) * (a.source.count || 1), 0)
console.log(`manifest.json: ${assets.length} filas`, byStatus, byGroup, `· créditos planeados ${planned} · gastados ${manifest.credits.spent}/${manifest.credits.ceiling}`)
