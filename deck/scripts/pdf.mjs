// pdf.mjs — imprime un HTML local a PDF con Chrome (A4, fondos, fuentes cargadas). Uso: node scripts/pdf.mjs in.html out.pdf
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [inp, out] = process.argv.slice(2)
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.emulateMediaType('print')
await page.goto(pathToFileURL(path.resolve(inp)).href, { waitUntil: 'networkidle0', timeout: 60000 })
await page.evaluate(() => document.fonts.ready)
await new Promise((r) => setTimeout(r, 800))
await page.pdf({
  path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-family:Inter,system-ui,sans-serif;font-size:8px;color:#6B665E;padding:0 14mm;display:flex;justify-content:space-between"><span>Beyond Production · Presenter Guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
})
await browser.close()
console.log(out, Math.round(fs.statSync(out).size / 1024) + ' KB')
