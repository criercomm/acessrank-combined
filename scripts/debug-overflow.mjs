#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Find what makes a page scroll sideways.
 *
 *   node scripts/debug-overflow.mjs /signup --engine=webkit --width=320
 *
 * It loads the page from dist/ in the chosen browser engine, then:
 *   1. lists every element that sticks out past the screen edge (visible or not),
 *   2. hides each element in turn and reports the ones whose removal ends the sideways scroll.
 * The deepest names in list 2 are the cause.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const args = process.argv.slice(2);
const route = args.find((a) => !a.startsWith('--')) || '/';
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const engine = opt('engine', 'webkit');
const width = Number.parseInt(opt('width', '320'), 10);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.avif': 'image/avif', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let lib;
try { lib = await import('playwright'); } catch { lib = await import('playwright-core'); }
lib = lib.default ?? lib;

const browser = await lib[engine].launch();
const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(base + route, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const reject = page.getByRole('button', { name: /^reject/i }).first();
if (await reject.isVisible().catch(() => false)) { await reject.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }

const result = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const sel = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
      const c = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      if (c) s += `.${c}`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const base = document.documentElement.scrollWidth;
  const all = [...document.body.querySelectorAll('*')];

  const sticking = all.map((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { sel: sel(e), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), pos: cs.position, disp: cs.display, ox: cs.overflowX, vis: cs.visibility, op: cs.opacity };
  }).filter((x) => x.right > vw + 0.5 || x.left < -0.5).sort((a, b) => b.right - a.right).slice(0, 20);

  const culprits = [];
  if (base > vw) {
    for (const e of all) {
      const prev = e.style.display;
      e.style.display = 'none';
      const sw = document.documentElement.scrollWidth;
      e.style.display = prev;
      if (sw <= vw) culprits.push(e);
    }
  }
  const deepest = culprits.filter((e) => !culprits.some((o) => o !== e && e.contains(o))).map((e) => {
    const r = e.getBoundingClientRect();
    return { sel: sel(e), tag: e.tagName.toLowerCase(), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: (e.textContent || '').trim().slice(0, 50) };
  });

  const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.width)}px wide, content ${e.scrollWidth}px`; };
  return { vw, scrollWidth: base, sticking, deepest, boxes: { body: box('body'), main: box('main'), authGrid: box('.auth-grid'), formCard: box('.form-card'), form: box('form'), select: box('select') } };
});

console.log(`\n${route} in ${engine} at ${width}px: screen ${result.vw}px, page content ${result.scrollWidth}px`);
console.log('\nKey containers:'); console.log(result.boxes);
console.log(`\n1. Elements sticking out past the screen edge (${result.sticking.length}):`);
for (const s of result.sticking) console.log(`   right=${s.right} left=${s.left} w=${s.w}  ${s.sel}  [${s.pos}, ${s.disp}, overflow-x ${s.ox}, ${s.vis}, opacity ${s.op}]`);
console.log(`\n2. Hiding any ONE of these ends the sideways scroll (${result.deepest.length}):`);
for (const d of result.deepest) console.log(`   ${d.sel}  <${d.tag}>  left=${d.left} right=${d.right} w=${d.w}  "${d.text}"`);
console.log('');
await browser.close();
server.close();
