#!/usr/bin/env node
// credits.mjs — libro de créditos Magnific del deck (techo 10.000; aviso al 80 %).
// Uso: node scripts/credits.mjs add <créditos> <generaciones> "<nota>"   |   node scripts/credits.mjs status
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json')
const m = JSON.parse(fs.readFileSync(file, 'utf8'))
const c = m.credits
const [cmd, credits, gens, ...note] = process.argv.slice(2)
if (cmd === 'add') {
  c.spent += Number(credits); c.generations += Number(gens || 0)
  c.log.push({ date: new Date().toISOString().slice(0, 19), credits: Number(credits), generations: Number(gens || 0), note: note.join(' ') })
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n')
}
const pct = Math.round((c.spent / c.ceiling) * 100)
console.log(`créditos: ${c.spent} / ${c.ceiling} (${pct} %) · generaciones: ${c.generations} / ${c.generationsCeiling} · balance estimado: ${c.balanceStart - c.spent}`)
if (c.spent >= c.ceiling) { console.log('⛔ TECHO ALCANZADO: detenerse y reportar.'); process.exitCode = 2 }
else if (c.spent >= c.warnAt) console.log('⚠️  80 % del techo: avisar antes de seguir generando.')
