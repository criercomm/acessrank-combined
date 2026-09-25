#!/usr/bin/env node
// shots.mjs — capturas reales del deck (Chrome headless vía puppeteer-core, tiempo real, no virtual) + consola.
// Uso: node scripts/shots.mjs --slides 1,4,11 [--w 1440 --h 900] [--wait 6000] [--keys ArrowRight,ArrowRight] [--out refs/review/shots] [--url http://localhost:5177]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const slides = arg('slides', '1').split(',').map(Number)
const W = Number(arg('w', 1440)), H = Number(arg('h', 900)), wait = Number(arg('wait', 6000))
const keys = arg('keys', '').split(',').filter(Boolean)
const after = Number(arg('after', 0)) // extra wait after the last key (lets a staged animation finish)
const out = arg('out', 'refs/review/shots'); fs.mkdirSync(out, { recursive: true })
const base = arg('url', 'http://localhost:5177')
const extraQ = arg('q', '') // p. ej. --q presenter=1
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox'] })
const logs = []
// accessrank.ai tiene puerta de contraseña: con GATE_PASSWORD en el entorno, la cruza una vez (la cookie vale para el resto)
async function passGate(page) {
  if (!process.env.GATE_PASSWORD || !(await page.$('form[data-gate]'))) return
  await page.type('#password', process.env.GATE_PASSWORD)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('form[data-gate] button[type=submit]')])
}
for (const s of slides) {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type()) && !/status of 401/.test(m.text())) logs.push(`s${s} console.${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => logs.push(`s${s} pageerror: ${e.message}`))
  await page.goto(`${base}/?slide=${s}${/gate=/.test(extraQ) ? '' : '&gate=0'}${extraQ ? '&' + extraQ : ''}`, { waitUntil: 'networkidle0', timeout: 60000 })
  await passGate(page)
  await new Promise((r) => setTimeout(r, wait))
  for (const k of keys) { await page.keyboard.press(k); await new Promise((r) => setTimeout(r, 1800)) }
  if (after) await new Promise((r) => setTimeout(r, after))
  const file = path.join(out, `s${String(s).padStart(2, '0')}-${W}x${H}${keys.length ? '-k' + keys.length : ''}${extraQ ? '-' + extraQ.replace(/[^a-z0-9]/gi, '') : ''}.png`)
  await page.screenshot({ path: file })
  console.log(file)
  await page.close()
}
await browser.close()
console.log(logs.length ? logs.join('\n') : 'consola limpia (sin errores ni warnings)')
