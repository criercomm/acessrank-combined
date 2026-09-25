#!/usr/bin/env node
// image-check.mjs — carga el deck como lo abre un teléfono y falla si el deck no arrancó, si algún <img> de la escena no
// cargó o si alguna petición devolvió error (bundle, fuentes, imágenes, audio). Existe por el bug de V3.2: abrir /deck sin
// barra final resolvía las rutas relativas una carpeta más arriba — en Fly se rompían imágenes y audio; en la copia de
// Vercel (base relativa) no arrancaba ni el JS.
// Uso:
//   node scripts/image-check.mjs --url https://www.accessrank.ai/deck --slides 1,4,5
//   node scripts/image-check.mjs --serve dist --prefix /deck --slides 1,4,5
//     (sirve el build como lo sirve Fly: /deck y /deck/ devuelven el mismo index.html sin redirigir; prueba las dos URLs)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const slides = arg('slides', '1,4').split(',').map(Number)
const W = Number(arg('w', 390)), H = Number(arg('h', 844))
const shotDir = arg('shot', '') // --shot <dir>: guarda una captura por escena y URL (prueba visual de la URL exacta)
if (shotDir) fs.mkdirSync(shotDir, { recursive: true })
// accessrank.ai tiene puerta de contraseña: con GATE_PASSWORD en el entorno, la cruza una vez (la cookie vale para el resto)
async function passGate(page) {
  if (!process.env.GATE_PASSWORD || !(await page.$('form[data-gate]'))) return
  await page.type('#password', process.env.GATE_PASSWORD)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('form[data-gate] button[type=submit]')])
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.opus': 'audio/ogg', '.json': 'application/json' }

let server = null
let urls = [arg('url', 'http://localhost:5180')]
const serveDir = arg('serve', '')
if (serveDir) {
  const prefix = arg('prefix', '/deck').replace(/\/+$/, '')
  const root = path.resolve(serveDir)
  server = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    if (u !== prefix && !u.startsWith(prefix + '/')) { res.statusCode = 404; return res.end() }
    const rel = u.slice(prefix.length).replace(/^\/+/, '') || 'index.html'
    const file = path.join(root, rel)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end() }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  urls = [origin + prefix, origin + prefix + '/']
}

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox'] })
let bad = 0
for (const base of urls) {
  console.log(`— ${base} (${W}×${H})`)
  for (const s of slides) {
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const failed = []
    // el 401 del documento es la página de la puerta, no un fallo; si no se cruza, el deck no arranca y eso sí cuenta
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url()) && !(r.status() === 401 && r.request().resourceType() === 'document')) failed.push(`${r.status()} ${r.url()}`) })
    page.on('requestfailed', (r) => { const t = r.failure()?.errorText || ''; if (!/ERR_ABORTED/.test(t)) failed.push(`FAIL ${r.url()} ${t}`) })
    await page.goto(`${base}${base.includes('?') ? '&' : '?'}slide=${s}&gate=0`, { waitUntil: 'networkidle0', timeout: 60000 })
    await passGate(page)
    await new Promise((r) => setTimeout(r, 5000))
    const st = await page.evaluate(() => {
      const slide = document.querySelector('.slide.is-active')
      const imgs = slide ? [...slide.querySelectorAll('img')].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })) : []
      return { booted: !!slide, imgs }
    })
    if (shotDir) {
      const host = new URL(base).hostname.split('.').filter((x) => x !== 'www')[0]
      const file = path.join(shotDir, host + '-' + (base.endsWith('/') ? 'barra' : 'sinbarra') + '-s' + String(s).padStart(2, '0') + '.png')
      await page.screenshot({ path: file })
    }
    const broken = st.imgs.filter((i) => !i.ok)
    bad += (st.booted ? 0 : 1) + broken.length + failed.length
    console.log(`  s${s}: ${st.booted ? 'arrancó' : 'NO ARRANCÓ'} · ${st.imgs.length} imágenes, ${broken.length} rotas · ${failed.length} peticiones fallidas`)
    for (const b of broken.slice(0, 2)) console.log('     rota →', b.src)
    for (const f of failed.slice(0, 3)) console.log('     ', f)
    await page.close()
  }
}
await browser.close()
server?.close()
console.log(bad ? `  ${bad} fallos` : '  todo cargó')
process.exit(bad ? 1 : 0)
