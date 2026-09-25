#!/usr/bin/env node
// manifest-merge.mjs — vuelca el manifest de proceso de cutout-factory (assets/cutouts/manifest.json: qa, contact_y, outputs)
// en el manifest del deck (manifest.json: status, files, contactY, shadow). Salta los qa=fail. Nada entra sin fila.
// Uso: node scripts/manifest-merge.mjs [assets/cutouts/manifest.json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.resolve(root, process.argv[2] || 'assets/cutouts/manifest.json')
const deckPath = path.join(root, 'manifest.json')
const proc = JSON.parse(fs.readFileSync(src, 'utf8'))
const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'))
const byId = new Map(deck.assets.map((a) => [a.id.toLowerCase(), a]))
let n = 0, skipped = []
for (const [id, a] of Object.entries(proc.assets || {})) {
  const row = byId.get(id.toLowerCase())
  if (!row) { skipped.push(`${id} (sin fila)`); continue }
  if (a.qa?.status === 'fail' && !process.argv.includes('--force')) { skipped.push(`${id} (qa=fail)`); continue }
  const outs = a.outputs || {}
  const files = { avif: {}, webp: {} }
  const list = Array.isArray(outs) ? outs : [...(outs.avif || []), ...(outs.webp || [])]
  for (const o of list) {
    const fmt = (o.format || path.extname(o.file || '').slice(1)).toLowerCase()
    if (!files[fmt]) continue
    // rutas del pipeline son relativas a assets/cutouts (web-dir ../final) → normalizamos a assets/final/<name>
    files[fmt][o.w] = 'assets/final/' + path.basename(o.file)
  }
  if (!Object.keys(files.avif).length && !Object.keys(files.webp).length) { skipped.push(`${id} (sin outputs)`); continue }
  const ws = Object.keys(files.avif).map(Number)
  const maxW = Math.max(...ws)
  const big = list.find((o) => o.w === maxW && (o.format || o.file).includes('avif')) || list[0]
  row.files = files
  row.file = files.avif[maxW] || Object.values(files.webp)[0]
  row.w = big?.w || row.w; row.h = big?.h || row.h
  row.contactY = a.contact_y ?? row.contactY
  row.shadow = !!a.shadow
  row.qa = a.qa?.status || null
  row.status = 'final'
  row.source.date = row.source.date || new Date().toISOString().slice(0, 10)
  n++
}
deck.updated = new Date().toISOString().slice(0, 10)
fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2) + '\n')
console.log(`${n} cut-outs → manifest.json` + (skipped.length ? `\nsaltados: ${skipped.join(', ')}` : ''))
