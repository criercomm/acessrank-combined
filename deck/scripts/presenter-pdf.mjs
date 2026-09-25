// presenter-pdf.mjs — PRESENTER.md → PRESENTER.html (styled, printable) → PRESENTER.pdf (Chrome headless).
// Uso: node scripts/presenter-pdf.mjs
import { marked } from 'marked'
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const md = fs.readFileSync(path.join(root, 'PRESENTER.md'), 'utf8')
const body = marked.parse(md)
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessrank — Presenter Guide</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.5 Inter, "Segoe UI", system-ui, sans-serif; color: #14142A; max-width: 180mm; margin: 0 auto; }
  h1 { font-size: 22pt; letter-spacing: -.02em; margin: 0 0 4pt; }
  h1::before { content: ''; display: inline-block; width: 14pt; height: 14pt; border-radius: 3pt; background: #FFD23F; vertical-align: -2pt; margin-right: 8pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; padding-top: 6pt; border-top: 1px solid #D4D0C5; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 8pt 0; page-break-inside: auto; }
  th, td { border: 1px solid #D4D0C5; padding: 5pt 6pt; vertical-align: top; text-align: left; }
  th { background: #F4F1EA; }
  tr { page-break-inside: avoid; }
  code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 9pt; background: #F4F1EA; padding: 1pt 3pt; border-radius: 2pt; }
  a { color: #1D4ED8; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #D4D0C5; margin: 14pt 0; }
  strong { color: #0E0E10; }
</style></head><body>${body}</body></html>`
const htmlPath = path.join(root, 'PRESENTER.html')
fs.writeFileSync(htmlPath, html)
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.emulateMediaType('print')
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
await page.pdf({ path: path.join(root, 'PRESENTER.pdf'), format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } })
await browser.close()
console.log('PRESENTER.pdf listo')
