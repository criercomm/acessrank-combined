#!/usr/bin/env node
// check-sound.mjs — V3.5, solo efectos: el deck abre sin pantalla de sonido; tras el primer clic el audio arranca, los efectos
// se descargan, la cama musical NO se pide y el botón dice "Sound on". Simula además a alguien que eligió "Enter in silence"
// en una versión anterior (cookie deck_mute=1): la primera visita debe borrarla.
// Uso: node scripts/check-sound.mjs [--url http://localhost:5178]   (con contraseña: GATE_PASSWORD en el entorno)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const base = arg('url', 'http://localhost:5178').replace(/\/+$/, '')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] })
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 })
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const host = new URL(base).hostname
await page.setCookie({ name: 'deck_mute', value: '1', domain: host, path: '/' }) // visitante antiguo que entró en silencio
await page.goto(`${base}/?slide=1`, { waitUntil: 'networkidle0', timeout: 60000 })
if (process.env.GATE_PASSWORD && (await page.$('form[data-gate]'))) {
  await page.type('form[data-gate] input[type=password]', process.env.GATE_PASSWORD)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('form[data-gate] button[type=submit]')])
  errors.length = 0 // el 401 de la página de contraseña no es un error del deck
}
await new Promise((r) => setTimeout(r, 1500))
const before = await page.evaluate(() => ({ soundGate: !!document.getElementById('gate'), scene: !!document.querySelector('.slide.is-active'), mute: document.querySelector('.mute')?.textContent }))
await page.mouse.click(720, 450) // primer gesto: avanza a la escena 2 y despierta el audio
await new Promise((r) => setTimeout(r, 3000))
const after = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map((e) => e.name)
  return {
    mute: document.querySelector('.mute')?.textContent,
    sfxFetched: res.filter((n) => /sfx-.*\.opus/.test(n)).length,
    bedFetched: res.some((n) => n.includes('dr-bed')),
    muteCookie: (document.cookie.match(/deck_mute=(\d)/) || [])[1] ?? null,
    counter: document.querySelector('.counter')?.textContent?.replace(/\s+/g, ''),
  }
})
const ok = !before.soundGate && before.scene && after.mute === 'Sound on' && after.sfxFetched > 0 && !after.bedFetched && after.muteCookie !== '1' && !errors.length
console.log('al abrir:', JSON.stringify(before))
console.log('tras el primer clic:', JSON.stringify(after))
console.log(errors.length ? 'errores: ' + errors.join(' | ') : 'consola limpia')
console.log(ok ? 'TODO OK' : 'FALLA')
await browser.close()
process.exit(ok ? 0 : 1)
