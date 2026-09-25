#!/usr/bin/env node
// responsive-check.mjs — QA del modo compacto (móvil, móvil apaisado, ventana baja). Comprueba lo que una captura no ve:
// que la barra inferior existe y navega de verdad, que sus targets cumplen los 24 px de la WCAG 2.5.8, que el footer
// legal sigue presente (en su versión corta) y que en desktop nada de esto se enciende.
// Uso: node scripts/responsive-check.mjs [--url http://localhost:5179]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const BASE = arg('url', 'http://localhost:5179')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox'] })
const out = [], errs = [], fails = []

async function open(w, h) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errs.push(`${w}x${h} console.error: ${m.text()}`) })
  page.on('pageerror', (e) => errs.push(`${w}x${h} pageerror: ${e.message}`))
  await page.goto(`${BASE}/?slide=1&gate=0`, { waitUntil: 'networkidle0', timeout: 60000 })
  await passGate(page)
  await new Promise((r) => setTimeout(r, 4000))
  return page
}
const active = (page) => page.evaluate(() => document.querySelector('.slide.is-active')?.dataset.slide)
const check = (cond, msg) => { if (!cond) fails.push(msg) }
// accessrank.ai tiene puerta de contraseña: con GATE_PASSWORD en el entorno, la cruza una vez (la cookie vale para el resto)
async function passGate(page) {
  if (!process.env.GATE_PASSWORD || !(await page.$('form[data-gate]'))) return
  await page.type('#password', process.env.GATE_PASSWORD)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('form[data-gate] button[type=submit]')])
}

// ---- compacto: la barra manda ----
for (const [w, h, name] of [[390, 660, 'portrait'], [812, 310, 'landscape'], [768, 1024, 'tablet-portrait']]) {
  const page = await open(w, h)
  const bar = await page.evaluate(() => {
    const n = document.querySelector('.navbar')
    if (!n) return null
    const r = n.getBoundingClientRect()
    const dots = [...n.querySelectorAll('.nav-dot')].map((d) => d.getBoundingClientRect())
    const spacing = dots.length > 1 ? dots[1].left + dots[1].width / 2 - (dots[0].left + dots[0].width / 2) : 0
    const arrows = [...n.querySelectorAll('.nav-arrow')].map((a) => { const b = a.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}` })
    const slide = document.querySelector('.slide.is-active')
    return {
      visible: getComputedStyle(n).display !== 'none', height: Math.round(r.height), clearsBottom: Math.round(window.innerHeight - r.bottom),
      dots: dots.length, dotBox: `${Math.round(dots[0]?.width)}x${Math.round(dots[0]?.height)}`, spacing: +spacing.toFixed(1), arrows,
      legal: (n.querySelector('.nav-legal')?.textContent || '').slice(0, 28) + '…', legalLines: Math.round(n.querySelector('.nav-legal').getBoundingClientRect().height / 14),
      libFooterHidden: getComputedStyle(document.querySelector('.footer')).display === 'none',
      slideOverflowY: getComputedStyle(slide).overflowY, slidePadBottom: getComputedStyle(slide).paddingBottom,
    }
  })
  out.push(`[${name} ${w}×${h}] ${JSON.stringify(bar)}`)
  check(bar?.visible, `${name}: la barra inferior no se ve`)
  check(bar?.dots === 11, `${name}: ${bar?.dots} puntos, esperaba 11`)
  check(bar?.spacing >= 24, `${name}: separación entre puntos ${bar?.spacing}px < 24px (WCAG 2.5.8)`)
  check(bar?.libFooterHidden, `${name}: el footer de escritorio sigue visible`)
  check(bar?.slideOverflowY === 'auto', `${name}: la escena no scrollea (overflowY=${bar?.slideOverflowY})`)

  const quiet = await page.evaluate(() => document.querySelector('.nav-arrow[aria-label="Previous scene"]').getAttribute('aria-disabled'))
  check(quiet === 'true', `${name}: en la escena 1 la flecha atrás debería estar apagada`)
  await page.click('.nav-arrow[aria-label="Next scene"]')
  await new Promise((r) => setTimeout(r, 2600))
  const n2 = await active(page)
  await page.click('.nav-dot[aria-label^="7."]')
  await new Promise((r) => setTimeout(r, 2600))
  const n7 = await active(page)
  const aria = await page.evaluate(() => document.querySelector('.nav-dot[aria-current="true"]')?.getAttribute('aria-label'))
  out.push(`[${name}] flecha siguiente → escena ${n2} · punto 7 → escena ${n7} · aria-current="${aria}"`)
  check(n2 === '2', `${name}: la flecha siguiente llevó a ${n2}, esperaba 2`)
  check(n7 === '7', `${name}: el punto 7 llevó a ${n7}, esperaba 7`)
  check(aria === '7. Model', `${name}: aria-current en "${aria}"`)
  await page.close()
}

// ---- desktop: nada de esto se enciende y la rueda sigue viva (el guard exige overflow real) ----
const page = await open(1440, 900)
const desk = await page.evaluate(() => ({
  navHidden: getComputedStyle(document.querySelector('.navbar')).display === 'none',
  footer: getComputedStyle(document.querySelector('.footer')).display,
  chapterDots: document.querySelectorAll('.chapter').length,
  slideOverflowY: getComputedStyle(document.querySelector('.slide.is-active')).overflowY,
}))
out.push(`[desktop 1440×900] ${JSON.stringify(desk)}`)
check(desk.navHidden, 'desktop: la barra inferior no debería verse')
check(desk.footer !== 'none', 'desktop: el footer legal desapareció')
check(desk.chapterDots === 11, `desktop: ${desk.chapterDots} puntos de capítulo`)
check(desk.slideOverflowY === 'hidden', `desktop: overflowY=${desk.slideOverflowY}; la rueda quedaría desactivada`)
await page.close()

// ---- escritorio: parejas izquierda/derecha que no deben tocarse ----
// Cada pareja ocupa sus dos anchos + los dos márgenes; si eso pasa del ancho de ventana, se solapan. Pasaba en S09 a
// 1440 (los tiles de Engineering encima del primer TBD de Traction) y por la misma aritmética en S02, S06 y S11.
const PAIRS = [
  { slide: 2, left: '.s02-copy', right: '.s02-right', name: 'S02 copy/carta' },
  { slide: 2, left: '.s02-tiles', right: '.s02-right', name: 'S02 tiles/carta' },
  { slide: 6, left: '.s06-grid', right: '.s06-right', name: 'S06 grid/estándares' },
  { slide: 9, left: '.s09-eng', right: '.s09-traction', name: 'S09 engineering/traction' },
  { slide: 10, left: '.s11-copy', right: '.lib', name: 'S11 copy/catálogo' },
]
for (const w of [1024, 1280, 1440, 1920]) {
  for (const p of PAIRS) {
    const pg = await browser.newPage()
    await pg.setViewport({ width: w, height: 900, deviceScaleFactor: 1 })
    pg.on('pageerror', (e) => errs.push(`${w}x900 pageerror: ${e.message}`))
    await pg.goto(`${BASE}/?slide=${p.slide}&gate=0`, { waitUntil: 'networkidle0', timeout: 60000 })
    await passGate(pg)
    await new Promise((r) => setTimeout(r, 2500))
    const gap = await pg.evaluate(([l, r]) => {
      const a = document.querySelector(l), b = document.querySelector(r)
      if (!a || !b) return null
      return Math.round(b.getBoundingClientRect().left - a.getBoundingClientRect().right)
    }, [p.left, p.right])
    out.push(`[overlap ${w}px] ${p.name}: hueco ${gap}px`)
    check(gap !== null && gap >= 0, `${p.name} a ${w}px: se solapan ${gap === null ? '?' : Math.abs(gap)}px`)
    await pg.close()
  }
}

// ---- escritorio: en S05 la explicación del paso activo no pisa las siluetas ----
// Evidence pack (paso 5) es el texto más largo; a 1280 × 720 llegó a montarse sobre la silueta de Shopper.
for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  const pg = await browser.newPage()
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  pg.on('pageerror', (e) => errs.push(`${w}x${h} pageerror: ${e.message}`))
  await pg.goto(`${BASE}/?slide=5&gate=0`, { waitUntil: 'networkidle0', timeout: 60000 })
  await passGate(pg)
  await new Promise((r) => setTimeout(r, 4000))
  for (let k = 0; k < 4; k++) { await pg.keyboard.press('ArrowRight'); await new Promise((r) => setTimeout(r, 700)) }
  await new Promise((r) => setTimeout(r, 900))
  const res = await pg.evaluate(() => {
    const line = document.querySelector('.s05-line').getBoundingClientRect()
    const rail = document.querySelector('.s05-rail').getBoundingClientRect()
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const figs = [...document.querySelectorAll('.s05-person img')].map((i) => i.getBoundingClientRect())
    return {
      step: document.querySelector('.s05-rail .hotspot.is-active')?.textContent,
      lines: Math.round(line.height / 26),
      clash: figs.filter((f) => hit(line, f)).length,
      clearance: Math.round(Math.min(...figs.map((f) => f.top)) - line.bottom),
      inRail: line.left >= rail.left - 1 && line.right <= rail.right + 1,
    }
  })
  out.push(`[S05 ${w}×${h}] paso "${res.step}" · ${res.lines} líneas · holgura vertical con las siluetas ${res.clearance}px · choques ${res.clash} · dentro del riel ${res.inRail}`)
  check(res.step === 'Evidence pack', `S05 ${w}×${h}: el paso activo es "${res.step}", esperaba Evidence pack`)
  check(res.clash === 0, `S05 ${w}×${h}: la explicación pisa ${res.clash} silueta(s)`)
  check(res.inRail, `S05 ${w}×${h}: la explicación se sale del riel`)
  await pg.close()
}

await browser.close()
console.log(out.join('\n'))
console.log(errs.length ? '\nCONSOLA:\n' + errs.join('\n') : '\nconsola sin errores')
console.log(fails.length ? '\nFALLOS:\n- ' + fails.join('\n- ') : '\nTODO OK')
process.exit(fails.length ? 1 : 0)
