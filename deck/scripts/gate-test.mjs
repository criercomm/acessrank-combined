#!/usr/bin/env node
// gate-test.mjs — prueba en local la puerta de contraseña de accessrank.ai (accessrank-fly-deck/gate/gate.mjs) antes de
// desplegarla. Arranca la puerta con una app falsa detrás (dist/ en /deck servido como Fly, una home y /api/health) y
// comprueba: health abierto; todo lo demás cerrado y sin contenido; contraseña mala → 401 y 429 al décimo intento; buena
// → cookie y vuelta a la URL pedida; sin open redirect; cookie manipulada o caducada rechazada; cabeceras de Fly intactas
// hacia la app; y el recorrido real en Chrome (contraseña → deck con imágenes, con y sin barra final).
// La contraseña de la prueba NO es la real.
// Uso: node scripts/gate-test.mjs [--gate C:/Developer/accessrank-fly-deck/gate/gate.mjs]
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(self), '..')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.opus': 'audio/ogg', '.json': 'application/json' }

if (process.argv.includes('--fake-app')) {
  // la "app" detrás de la puerta: /deck y /deck/ → dist/index.html sin redirigir, como Express en Fly
  const dist = path.join(root, 'dist')
  http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '/').split('?')[0])
    if (u === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}') }
    if (u === '/api/echo') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] })
      return res.end(JSON.stringify({ xff: req.headers['x-forwarded-for'] || null, fly: req.headers['fly-client-ip'] || null, host: req.headers.host }))
    }
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>home</title><h1>Accessrank home</h1>') }
    if (u === '/deck' || u.startsWith('/deck/')) {
      const f = path.join(dist, u.slice(5).replace(/^\/+/, '') || 'index.html')
      if (f.startsWith(dist) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' })
        return fs.createReadStream(f).pipe(res)
      }
    }
    res.writeHead(404); res.end()
  }).listen(Number(process.env.PORT), '127.0.0.1')
  // se apaga sola cuando la puerta desaparece: en Windows matar la puerta no mata a sus hijos
  const gatePort = Number(process.env.GATE_PORT || 0)
  let misses = 0
  if (gatePort) setInterval(() => {
    const s = net.connect(gatePort, '127.0.0.1')
    s.on('connect', () => { misses = 0; s.destroy() })
    s.on('error', () => { if (++misses >= 3) process.exit(0) })
  }, 500)
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
  const GATE = arg('gate', 'C:/Developer/accessrank-fly-deck/gate/gate.mjs')
  const PORT = 4310, APP_PORT = 4311, PW = 'test-only-not-the-real-password'
  const base = `http://localhost:${PORT}`
  const node = process.execPath.replace(/\\/g, '/')
  const gate = spawn(process.execPath, [GATE], {
    env: { ...process.env, PORT: String(PORT), GATE_PORT: String(PORT), APP_PORT: String(APP_PORT), SITE_PASSWORD: PW, GATE_APP_CMD: `"${node}" "${self.replace(/\\/g, '/')}" --fake-app`, GATE_APP_CWD: root },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const results = []
  const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`) }
  const html = { accept: 'text/html,application/xhtml+xml' }
  const post = (body, headers = {}) => fetch(base + '/__gate', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() })

  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base + '/api/health')).ok } catch { await wait(250) } }
    if (!up) throw new Error('la puerta no arrancó')

    console.log('— HTTP')
    let r = await fetch(base + '/api/health')
    ok(r.status === 200 && (await r.text()).includes('"ok"'), '/api/health abierto sin contraseña (health check de Fly)')
    r = await fetch(base + '/', { headers: html })
    let t = await r.text()
    ok(r.status === 401 && t.includes('data-gate') && t.includes('name="next" value="/"'), '/ sin sesión → 401 con la página de acceso')
    ok(/noindex/.test(r.headers.get('x-robots-tag') || '') && /no-store/.test(r.headers.get('cache-control') || ''), 'la página de acceso lleva noindex y no-store')
    ok(/for="password"/.test(t) && /autocomplete="current-password"/.test(t) && /<html lang="en">/.test(t), 'la página de acceso tiene label, autocomplete y lang')
    r = await fetch(base + '/deck?slide=4', { headers: html })
    t = await r.text()
    ok(r.status === 401 && t.includes('value="/deck?slide=4"'), '/deck?slide=4 sin sesión → acceso que recuerda la URL')
    const js = fs.readdirSync(path.join(root, 'dist/assets')).find((f) => f.endsWith('.js'))
    r = await fetch(`${base}/deck/assets/${js}`)
    t = await r.text()
    ok(r.status === 401 && !t.includes('function') && t.length < 40, 'assets sin sesión → 401 seco, sin contenido')
    r = await fetch(base + '/api/echo')
    ok(r.status === 401, 'API sin sesión → 401')

    r = await post({ password: 'wrong', next: '/deck/' }, { 'fly-client-ip': '10.0.0.1' })
    t = await r.text()
    ok(r.status === 401 && t.includes('role="alert"') && t.includes('aria-invalid="true"'), 'contraseña mala → 401 con error anunciado')
    r = await post({ password: PW, next: '//evil.example/x' }, { 'fly-client-ip': '10.0.0.2' })
    ok(r.status === 303 && r.headers.get('location') === '/', 'next=//evil.example → vuelve a / (sin open redirect)')
    r = await post({ password: PW, next: '/deck/?slide=4' }, { 'fly-client-ip': '10.0.0.3' })
    const sc = r.headers.get('set-cookie') || ''
    ok(r.status === 303 && r.headers.get('location') === '/deck/?slide=4', 'contraseña buena → 303 a la URL pedida')
    ok(/ar_gate=\d+\.[0-9a-f]{64}/.test(sc) && /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc), 'cookie firmada, HttpOnly, Secure, SameSite=Lax')
    const cookie = sc.split(';')[0]

    r = await fetch(base + '/deck/', { headers: { ...html, cookie } })
    t = await r.text()
    ok(r.status === 200 && t.includes('/deck/assets/'), 'con sesión: /deck/ sirve el deck')
    r = await fetch(base + '/', { headers: { ...html, cookie } })
    ok(r.status === 200 && (await r.text()).includes('Accessrank home'), 'con sesión: / sirve la home de la app')
    r = await fetch(base + '/api/echo', { headers: { cookie, 'x-forwarded-for': '203.0.113.7', 'fly-client-ip': '203.0.113.7' } })
    const echo = await r.json()
    const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : String(r.headers.get('set-cookie')).split(/,(?=\s*\w+=)/)
    ok(echo.xff === '203.0.113.7' && echo.fly === '203.0.113.7' && echo.host === `localhost:${PORT}`, 'X-Forwarded-For, Fly-Client-IP y Host llegan intactos a la app')
    ok(setCookies.length === 2, 'las dos Set-Cookie de la app atraviesan la puerta')

    const [exp, mac] = cookie.split('=')[1].split('.')
    r = await fetch(base + '/deck/', { headers: { ...html, cookie: `ar_gate=${exp}.${mac.slice(0, -1)}${mac.endsWith('0') ? '1' : '0'}` } })
    ok(r.status === 401, 'cookie manipulada → 401')
    const key = crypto.createHash('sha256').update('accessrank-gate:' + PW).digest()
    const old = Math.floor(Date.now() / 1000) - 60
    r = await fetch(base + '/deck/', { headers: { ...html, cookie: `ar_gate=${old}.${crypto.createHmac('sha256', key).update(String(old)).digest('hex')}` } })
    ok(r.status === 401, 'cookie bien firmada pero caducada → 401')

    const statuses = []
    for (let i = 0; i < 11; i++) statuses.push((await post({ password: 'nope' }, { 'fly-client-ip': '10.9.9.9' })).status)
    r = await post({ password: PW }, { 'fly-client-ip': '10.9.9.9' })
    ok(statuses.slice(0, 10).every((s) => s === 401) && statuses[10] === 429 && r.status === 429, `10 intentos fallidos → 429, también con la contraseña buena (${statuses.join(' ')} · ${r.status})`)

    console.log('— Chrome: contraseña → deck')
    const { default: puppeteer } = await import('puppeteer-core')
    const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
    const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox'] })
    for (const [want, slide, minImgs] of [['/deck?slide=4&gate=0', 4, 4], ['/deck/?slide=1&gate=0', 1, 1]]) {
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      await page.goto(base + want, { waitUntil: 'networkidle0' })
      ok(await page.$('form[data-gate]'), `${want}: aparece la puerta`)
      await page.type('#password', 'wrong')
      await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')])
      ok(await page.$('[role=alert]'), `${want}: la contraseña mala muestra el error`)
      await page.type('#password', PW)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')])
      const u = new URL(page.url())
      ok(u.pathname + u.search === want, `${want}: tras la contraseña vuelve a la misma URL (${u.pathname + u.search})`)
      await wait(5000)
      const st = await page.evaluate(() => {
        const s = document.querySelector('.slide.is-active')
        const imgs = s ? [...s.querySelectorAll('img')] : []
        return { n: s?.dataset.slide, imgs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length }
      })
      ok(st.n === String(slide) && st.imgs >= minImgs && st.loaded === st.imgs, `${want}: el deck arranca en la escena ${st.n} con ${st.loaded}/${st.imgs} imágenes`)
      await ctx.close()
    }
    await browser.close()
  } catch (e) {
    ok(false, 'error: ' + e.message)
  } finally {
    gate.kill('SIGTERM')
    let appDown = false
    for (let i = 0; i < 20 && !appDown; i++) { await wait(400); try { await fetch(`http://127.0.0.1:${APP_PORT}/api/health`) } catch { appDown = true } }
    ok(appDown, 'al parar la puerta, la app de detrás también se apaga')
    const bad = results.filter(([p]) => !p)
    console.log(bad.length ? `\n${bad.length} FALLOS` : `\nTODO OK (${results.length} comprobaciones)`)
    process.exit(bad.length ? 1 : 0)
  }
}
