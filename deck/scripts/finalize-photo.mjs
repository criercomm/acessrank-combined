#!/usr/bin/env node
// finalize-photo.mjs — fotos sin recorte (heroes, plates, retratos, paneles): AVIF q58 + WebP q78 en varios anchos →
// assets/final/<id>-<w>.{avif,webp}; marca la fila del manifest como status "final" con files/w/h.
// Uso: node scripts/finalize-photo.mjs <id> <src> [--widths 960,1440,2000,2560] [--note "..."]
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [id, src] = process.argv.slice(2)
if (!id || !src) { console.error('uso: node scripts/finalize-photo.mjs <id> <src> [--widths 960,1440,2000,2560]'); process.exit(1) }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const widths = arg('widths', '960,1440,2000,2560').split(',').map(Number)
const avifQ = Number(arg('avif-q', 58)), webpQ = Number(arg('webp-q', 78))
const manifestPath = path.join(root, 'manifest.json')
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const row = m.assets.find((a) => a.id === id)
if (!row) { console.error(`"${id}" no está en manifest.json`); process.exit(1) }
const meta = await sharp(src).metadata()
const outDir = path.join(root, 'assets/final'); fs.mkdirSync(outDir, { recursive: true })
const files = { avif: {}, webp: {} }
let maxW = 0, maxH = 0
for (const w of widths.filter((w) => w <= meta.width)) {
  const base = `${id.toLowerCase()}-${w}`
  const pipe = sharp(src).resize({ width: w, withoutEnlargement: true })
  const a = await pipe.clone().avif({ quality: avifQ, effort: 4 }).toFile(path.join(outDir, base + '.avif'))
  await pipe.clone().webp({ quality: webpQ }).toFile(path.join(outDir, base + '.webp'))
  files.avif[w] = `assets/final/${base}.avif`; files.webp[w] = `assets/final/${base}.webp`
  if (w > maxW) { maxW = w; maxH = a.height }
  console.log(`${base}: avif ${(a.size / 1024).toFixed(0)} KB`)
}
row.files = files; row.file = files.avif[maxW]; row.w = maxW; row.h = maxH; row.status = 'final'
row.source.date = row.source.date || new Date().toISOString().slice(0, 10)
if (arg('note')) row.note = (row.note ? row.note + ' · ' : '') + arg('note')
m.updated = new Date().toISOString().slice(0, 10)
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n')
console.log(`${id} → final (${maxW}×${maxH}, ${Object.keys(files.avif).length} anchos)`)
