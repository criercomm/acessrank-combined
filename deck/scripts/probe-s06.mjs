#!/usr/bin/env node
// probe-s06.mjs — mide en S06 la caída vertical: fondo del copy (titular + lede) contra el borde superior de la rejilla de
// tiles y de la columna de estándares, y el fondo de ambas contra la regla del pie. Falla si algo se pisa.
// Uso: node scripts/probe-s06.mjs [--url http://localhost:5178]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const BASE = arg('url', 'http://localhost:5178')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox'] })
const sizes = [[1024, 768], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 900], [1920, 1080], [2560, 1440]]
let bad = 0
for (const [w, h] of sizes) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/?slide=6&gate=0`, { waitUntil: 'networkidle0', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3500))
  const m = await page.evaluate(() => {
    const s = document.querySelector('.slide.is-active')
    const r = (q) => s.querySelector(q)?.getBoundingClientRect()
    const lede = r('.s06-lede'), grid = r('.s06-grid'), right = r('.s06-right')
    const legal = document.querySelector('.slide.is-active .legal, .legal, footer')?.getBoundingClientRect()
    const pos = getComputedStyle(s.querySelector('.s06-grid')).position
    return { pos, ledeB: lede.bottom, gridT: grid.top, gridB: grid.bottom, rightT: right.top, rightB: right.bottom, legalT: legal?.top }
  })
  const gap = Math.round(Math.min(m.gridT, m.rightT) - m.ledeB)
  const foot = m.legalT != null ? Math.round(m.legalT - Math.max(m.gridB, m.rightB)) : null
  const ok = m.pos !== 'absolute' || (gap >= 16 && (foot == null || foot >= 8))
  if (!ok) bad++
  console.log(`${w}x${h} ${m.pos} · lede→rejilla ${gap}px · rejilla→pie ${foot}px ${ok ? 'ok' : 'FALLA'}`)
  await page.close()
}
await browser.close()
console.log(bad ? `\n${bad} tamaño(s) con choque` : '\nTODO OK')
process.exit(bad ? 1 : 0)
