#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Mobile test system.
 *
 * Loads every built page in emulated phones, in real browser engines, and checks the
 * things that go wrong on a phone and nowhere else: horizontal scroll, undersized tap
 * targets, inputs that make iOS Safari zoom, fixed widgets sitting on top of content,
 * a menu that does not open, a headline that stays hidden on a slow connection, motion
 * that ignores "reduce motion", and decorative markers stranded beside wrapped text.
 *
 *   npm run test:mobile                       build in dist/, 4 phones, dark theme, Chromium
 *   npm run test:mobile -- --full             + landscape, tablet, 767px edge, both themes
 *   npm run test:mobile -- --engine=all       Chromium and WebKit (Safari's engine)
 *   npm run test:mobile:live                  the LIVE site (sees edge-injected widgets)
 *   npm run test:mobile -- --route=/,/beta    only these routes
 *   npm run test:mobile -- --strict           warnings fail the run too
 *   npm run test:mobile -- --no-shots         skip screenshots
 *
 * Output: test-results/mobile/report.html (screenshot contact sheet + every finding)
 *         test-results/mobile/report.json
 *
 * Findings are errors (fail the run) or warnings (listed, fail only with --strict).
 * An accepted exception goes in tests/mobile/known-issues.json, with a reason.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'test-results', 'mobile');
const KNOWN_FILE = path.join(ROOT, 'tests', 'mobile', 'known-issues.json');

/* ------------------------------------------------------------------ options */

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};

const FULL = flag('full');
const STRICT = flag('strict');
const SHOTS = !flag('no-shots');
const LIVE = (opt('url') || process.env.BASE_URL || '').replace(/\/+$/, '');
const ENGINE_ARG = opt('engine', 'chromium');
const ENGINES = ENGINE_ARG === 'all' ? ['chromium', 'webkit'] : [ENGINE_ARG];
const ONLY = opt('route') ? opt('route').split(',').map((s) => s.trim()).filter(Boolean) : null;
const CONCURRENCY = Number.parseInt(opt('concurrency', '4'), 10) || 4;
const THEMES = FULL ? ['dark', 'light'] : ['dark'];

/* ----------------------------------------------------------------- playwright */

async function loadPlaywright() {
  try { return await import('playwright'); } catch { return await import('playwright-core'); }
}
const pwModule = await loadPlaywright();
const lib = pwModule.default ?? pwModule;

/* -------------------------------------------------------------------- devices */

const custom = (name, viewport, extra = {}) => ({
  name, options: { viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...extra },
});
const named = (name) => (lib.devices[name] ? { name, options: lib.devices[name] } : null);

const DEVICES = [
  custom('320px reflow', { width: 320, height: 568 }), // WCAG 1.4.10: smallest width the page must reflow into
  named('iPhone SE (3rd gen)'),
  named('iPhone 15'),
  named('Pixel 7'),
  ...(FULL ? [
    named('iPhone 15 Pro Max'),
    named('Galaxy S9+'),
    named('iPhone SE (3rd gen) landscape'),
    named('iPhone 15 landscape'),
    custom('767px (breakpoint edge)', { width: 767, height: 1024 }),
    named('iPad Mini'),
  ] : []),
].filter(Boolean);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
const isAndroid = (d) => /^(Pixel|Galaxy)/.test(d.name);

/* ----------------------------------------------------------------- known list */

let KNOWN = [];
try { KNOWN = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')).ignore ?? []; } catch { /* none */ }
const isKnown = (f) => KNOWN.some((r) =>
  r.check === f.check
  && (!r.route || r.route === f.route)
  && (!r.selector || (f.selector ?? '').includes(r.selector)));

/* --------------------------------------------------------------- pages/server */

function collectPages(dir = DIST, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue;
      out.push(...collectPages(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === 'index.html') {
      out.push(prefix === '' ? '/' : prefix);
    } else if (entry.name.endsWith('.html') && entry.name !== '404.html' && !/^google[0-9a-f]+\.html$/.test(entry.name)) {
      out.push(`${prefix}/${entry.name}`);
    }
  }
  return out.sort();
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ======================================================================
 * In-page checks. These run inside the browser, so each is self-contained.
 * ==================================================================== */

/** Static layout checks, run once per page load. Returns finding objects. */
function pageAudit() {
  const F = [];
  const add = (check, severity, selector, message) => F.push({ check, severity, selector, message });
  const vw = document.documentElement.clientWidth;

  const sel = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 3; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
      const c = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      if (c) s += `.${c}`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const rectOf = (el) => el.getBoundingClientRect();
  const hiddenByAncestor = (el) => !!el.closest('[hidden],[inert],[aria-hidden="true"]');
  const visible = (el) => {
    const r = rectOf(el);
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  };
  const offscreenX = (r) => r.right <= 0 || r.left >= vw;
  const insideFixed = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true;
    return false;
  };

  /* 1. Viewport meta: must scale to the device and must not block pinch-zoom (WCAG 1.4.4). */
  const meta = document.querySelector('meta[name="viewport"]');
  const mc = meta ? (meta.getAttribute('content') || '') : '';
  if (!meta) add('viewport-meta', 'error', 'head', 'No <meta name="viewport">. Phones will render a zoomed-out desktop layout.');
  else {
    if (!/width\s*=\s*device-width/i.test(mc)) add('viewport-meta', 'error', 'meta[name=viewport]', `Viewport meta lacks width=device-width: "${mc}"`);
    const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(mc);
    if (/user-scalable\s*=\s*(no|0)/i.test(mc) || (max && parseFloat(max[1]) < 2)) {
      add('viewport-meta', 'error', 'meta[name=viewport]', `Viewport meta blocks pinch-zoom (WCAG 1.4.4): "${mc}"`);
    }
  }

  /* 2. Horizontal overflow: the page must never scroll sideways. */
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) {
    const hits = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = rectOf(el);
      if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
      if (insideFixed(el) || !visible(el)) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') {
          const pr = rectOf(p);
          if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; }
        }
      }
      if (!clipped) hits.push(el);
    }
    const outer = hits.filter((el) => !hits.includes(el.parentElement)).slice(0, 5);
    add('horizontal-overflow', 'error', outer[0] ? sel(outer[0]) : 'html',
      `Page scrolls sideways: content is ${sw}px wide in a ${vw}px viewport. Widest offenders: ${outer.map((e) => `${sel(e)} (${Math.round(rectOf(e).right)}px right edge)`).join('; ') || 'not isolated'}`);
  }

  /* 3. Tap targets. WCAG 2.5.8 (AA) minimum 24px; Apple and Google recommend about 44px, flagged below 40px. */
  const targets = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [tabindex]:not([tabindex="-1"])');
  const seen = new Set();
  const boxes = [];
  const small = [];
  const tight = [];
  for (const el of targets) {
    if (hiddenByAncestor(el) || !visible(el)) continue;
    const r = rectOf(el);
    if (offscreenX(r) || r.width <= 1 || r.height <= 1) continue; // off-canvas drawer, or visually hidden
    if (el.matches('.skip-link, [class*="skip"]') && r.top < 0) continue;
    const cs = getComputedStyle(el);
    // WCAG exempts links that sit inline inside a sentence.
    if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p,li,dd,figcaption,blockquote,td')) {
      const host = el.closest('p,li,dd,figcaption,blockquote,td');
      if ((host.textContent || '').trim().length > (el.textContent || '').trim().length + 3) continue;
    }
    const key = sel(el);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = Math.min(r.width, r.height);
    const label = `${key} (${Math.round(r.width)}x${Math.round(r.height)})`;
    boxes.push({ el, r, m, label });
  }
  // WCAG 2.5.8 spacing exception: an undersized target passes when a 24px circle centred on it
  // touches no other target and no other undersized target's circle.
  const circleHits = (a, b) => {
    const cx = a.r.left + a.r.width / 2, cy = a.r.top + a.r.height / 2;
    const dx = Math.max(b.r.left - cx, 0, cx - b.r.right), dy = Math.max(b.r.top - cy, 0, cy - b.r.bottom);
    if (Math.hypot(dx, dy) < 12) return true;
    if (b.m < 24) { const bx = b.r.left + b.r.width / 2, by = b.r.top + b.r.height / 2; return Math.hypot(cx - bx, cy - by) < 24; }
    return false;
  };
  for (const b of boxes) {
    if (b.m < 24) {
      const crowded = boxes.some((o) => o !== b && !b.el.contains(o.el) && !o.el.contains(b.el) && circleHits(b, o));
      if (crowded) small.push(b); else tight.push(b);
    } else if (b.m < 40) tight.push(b);
  }
  for (const s of small.slice(0, 8)) add('tap-target', 'error', sel(s.el), `Tap target under 24px with other targets too close (WCAG 2.5.8): ${s.label}`);
  if (small.length > 8) add('tap-target', 'error', 'many', `${small.length - 8} more tap targets under 24px`);
  if (tight.length) add('tap-target-comfort', 'warn', sel(tight[0].el), `${tight.length} tap target(s) under 40px: ${tight.slice(0, 6).map((t) => t.label).join('; ')}`);

  /* 4. iOS Safari zooms the whole page when a field under 16px takes focus. */
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]), select, textarea')) {
    if (hiddenByAncestor(el) || !visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) add('ios-input-zoom', 'error', sel(el), `Field text is ${fs}px. iOS Safari zooms the page on focus below 16px and does not zoom back.`);
  }

  /* 5. Small text. */
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tiny = new Map();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || !visible(p) || hiddenByAncestor(p)) continue;
    { const pr = rectOf(p); if (pr.width <= 2 || pr.height <= 2) continue; } // screen-reader-only text is not on screen
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs < 12) { const k = sel(p); if (!tiny.has(k)) tiny.set(k, fs); }
  }
  if (tiny.size) {
    const list = [...tiny.entries()].slice(0, 6).map(([k, v]) => `${k} (${v}px)`).join('; ');
    add('small-text', 'warn', [...tiny.keys()][0], `${tiny.size} text block(s) under 12px: ${list}`);
  }

  /* 6. A tiny decorative marker (dot, icon) in a flex row beside text that wrapped onto 2+ lines. */
  const lineCount = (node) => {
    const rg = document.createRange();
    rg.selectNodeContents(node);
    return new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4))).size;
  };
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display) || cs.flexDirection.startsWith('column') || !visible(el)) continue;
    const kids = [...el.children].filter(visible);
    const marker = kids.find((k) => {
      const r = rectOf(k);
      return r.width <= 16 && r.height <= 16 && (k.textContent || '').trim() === '' && !k.querySelector('img,svg');
    });
    if (!marker) continue;
    const textNodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
    const textKids = kids.filter((k) => k !== marker && (k.textContent || '').trim());
    const wrapped = textNodes.some((n) => lineCount(n) >= 2) || textKids.some((k) => lineCount(k) >= 2);
    if (wrapped) add('detached-marker', 'error', sel(marker), `Decorative marker ${sel(marker)} is stranded beside text that wraps to 2+ lines (flex row on ${sel(el)}). It floats alone at the edge instead of leading the text.`);
  }

  /* 7. Text clipped by its own box (overflow hidden, content wider than the box). */
  let clippedCount = 0;
  let clippedFirst = '';
  for (const el of document.body.querySelectorAll('h1,h2,h3,h4,p,a,button,li,span,label')) {
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis' || !visible(el)) continue;
    { const rr = rectOf(el); if (rr.width <= 2 || rr.height <= 2) continue; }
    if (el.scrollWidth > el.clientWidth + 2 && (el.textContent || '').trim()) { clippedCount++; clippedFirst ||= sel(el); }
  }
  if (clippedCount) add('clipped-text', 'warn', clippedFirst, `${clippedCount} element(s) cut text off at their edge, first: ${clippedFirst}`);

  return F;
}

/** Fixed/sticky elements lying on top of content right now. */
function coverage() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const sel = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 3; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
      const c = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      if (c) s += `.${c}`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const all = [...document.body.querySelectorAll('*')];
  const fixedAll = all.filter((el) => getComputedStyle(el).position === 'fixed');
  const fixed = fixedAll.filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 100 || cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    if (cs.pointerEvents === 'none') return false;
    if (el.closest('[aria-modal="true"]')) return false;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return false;
    if (fixedAll.some((o) => o !== el && o.contains(el))) return false; // only top-level fixed boxes
    // The site header is meant to sit over content; only flag floating widgets and bars at the bottom.
    if (r.top <= 2 && r.width >= vw - 2) return false;
    return true;
  });
  const content = all.filter((el) => {
    if (!/^(H1|H2|H3|H4|P|LI|A|BUTTON|INPUT|LABEL|SPAN|TD|TH|DT|DD|SUMMARY|FIGCAPTION)$/.test(el.tagName)) return false;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    const interactive = /^(A|BUTTON|INPUT|SUMMARY)$/.test(el.tagName);
    if (!own && !interactive) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  const seen = new Set();
  for (const F of fixed) {
    const fr = F.getBoundingClientRect();
    for (const c of content) {
      if (F.contains(c) || c.contains(F)) continue;
      const cr = c.getBoundingClientRect();
      const ix = Math.max(cr.left, fr.left), iy = Math.max(cr.top, fr.top);
      const ex = Math.min(cr.right, fr.right, vw), ey = Math.min(cr.bottom, fr.bottom, vh);
      if (ex <= ix || ey <= iy) continue;
      const share = ((ex - ix) * (ey - iy)) / (cr.width * cr.height);
      if (share < 0.25) continue;
      const hit = document.elementFromPoint((ix + ex) / 2, (iy + ey) / 2);
      if (!hit || !(hit === F || F.contains(hit))) continue;
      const key = `${sel(F)}|${sel(c)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fixed: sel(F), content: sel(c), text: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50) });
      if (out.length >= 14) return out;
    }
  }
  return out;
}

/** Share of the viewport covered by floating UI. */
function floatingShare() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let area = 0;
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (r.width >= vw - 2 && r.height >= vh - 2) continue; // full-screen backdrop
    area += w * h;
  }
  return area / (vw * vh);
}

/** Things that must stop under prefers-reduced-motion. */
function motionAudit() {
  const out = [];
  const infinite = document.getAnimations().filter((a) => {
    const t = a.effect?.getComputedTiming?.();
    return a.playState === 'running' && t && t.iterations === Infinity;
  });
  if (infinite.length) {
    const names = [...new Set(infinite.map((a) => `${a.animationName || a.transitionProperty || 'animation'} on ${(a.effect.target.className || a.effect.target.tagName || '').toString().slice(0, 40)}`))];
    out.push(`Infinite animation still running with reduced motion on: ${names.slice(0, 4).join('; ')}`);
  }
  if (document.documentElement.classList.contains('hero-fx')) out.push('The hero-fx class (hides the headline until JavaScript animates it) is set even with reduced motion on.');
  const vids = [...document.querySelectorAll('video[autoplay]')].filter((v) => !v.paused);
  if (vids.length) out.push(`${vids.length} autoplaying video(s) still playing.`);
  return out;
}

/* ======================================================================
 * Runner
 * ==================================================================== */

const themeScript = (theme) => `try{localStorage.setItem('ar-theme','${theme}')}catch(e){}`;
const dismissConsent = async (page) => {
  const btn = page.getByRole('button', { name: /^(reject|decline|no thanks)/i }).first();
  if (!(await btn.isVisible().catch(() => false))) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    await btn.click({ timeout: 4000 }).catch(() => {});
    const gone = await page.locator('#analytics-choice').waitFor({ state: 'hidden', timeout: 2500 }).then(() => true).catch(() => false);
    if (gone) break;
  }
  await page.waitForTimeout(300);
};

async function navTest(page, add) {
  const toggle = page.locator('button[aria-expanded]:visible').first();
  if (!(await toggle.count())) {
    add({ check: 'mobile-nav', severity: 'error', selector: 'header', message: 'No visible menu button (button[aria-expanded]) found at a phone width, so the navigation may be unreachable.' });
    return;
  }
  const beforeW = await page.evaluate(() => document.documentElement.scrollWidth);
  await toggle.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(450);
  const state = await toggle.getAttribute('aria-expanded');
  if (state !== 'true') {
    add({ check: 'mobile-nav', severity: 'error', selector: 'button[aria-expanded]', message: `Menu button did not report aria-expanded="true" after tapping it (it says "${state}").` });
    return;
  }
  const controls = await toggle.getAttribute('aria-controls');
  const scope = controls ? page.locator(`[id="${controls}"]`) : page.locator('header, nav').first();
  const info = await scope.evaluate((root) => {
    const vw = document.documentElement.clientWidth;
    const links = [...root.querySelectorAll('a')].filter((a) => {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
    });
    const outside = links.filter((a) => { const r = a.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; });
    return { count: links.length, outside: outside.length, scrollW: document.documentElement.scrollWidth, vw };
  }).catch(() => ({ count: 0, outside: 0, scrollW: 0, vw: 0 }));
  if (info.count < 3) add({ check: 'mobile-nav', severity: 'error', selector: 'nav', message: `Menu opened but shows only ${info.count} visible link(s).` });
  if (info.outside) add({ check: 'mobile-nav', severity: 'error', selector: 'nav', message: `${info.outside} menu link(s) sit outside the screen when the menu is open.` });
  if (info.scrollW > info.vw + 1 && info.scrollW > beforeW) add({ check: 'horizontal-overflow', severity: 'error', selector: 'nav', message: `Opening the menu makes the page scroll sideways (${info.scrollW}px in ${info.vw}px).` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await toggle.getAttribute('aria-expanded')) !== 'false') {
    add({ check: 'mobile-nav', severity: 'warn', selector: 'button[aria-expanded]', message: 'Escape does not close the open menu.' });
  }
}

async function layoutJob(job, browsers, base) {
  const { engine, device, theme, route, diagnostics } = job;
  const findings = [];
  const add = (f) => findings.push({ route, device: device.name, engine, theme, ...f });
  const ctx = await browsers[engine].newContext({ ...device.options, colorScheme: theme });
  await ctx.addInitScript(themeScript(theme));
  const page = await ctx.newPage();
  const noise = new Set();
  if (diagnostics) {
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) noise.add(`console error: ${m.text().slice(0, 140)}`); });
    page.on('pageerror', (e) => noise.add(`script error: ${String(e.message).slice(0, 140)}`));
    page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) noise.add(`HTTP ${r.status()}: ${r.url().replace(base, '')}`); });
    page.on('requestfailed', (r) => noise.add(`request failed: ${r.url().replace(base, '')}`));
  }
  let shot = null;
  try {
    const resp = await page.goto(base + route, { waitUntil: 'load', timeout: 45000 });
    if (!resp || resp.status() >= 400) add({ check: 'http', severity: 'error', selector: route, message: `HTTP ${resp?.status()}` });
    await page.waitForTimeout(route === '/' ? 7000 : 300);
    // The consent banner is injected by a deferred script. Wait for it to exist before judging the page,
    // otherwise a slow load makes it look "missing" and then it lands on top of the checks.
    if (await page.locator('script[src*="analytics-consent"]').count()) {
      await page.locator('#analytics-choice').waitFor({ state: 'attached', timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);
    }

    // What a first-time visitor sees, before dismissing anything.
    const share = await page.evaluate(floatingShare);
    if (share > 0.35) add({ check: 'first-visit-overlay', severity: 'warn', selector: 'fixed', message: `Floating UI covers ${Math.round(share * 100)}% of the first screen before the visitor has done anything.` });
    if (SHOTS) {
      shot = path.join(slug(`${engine}-${device.name}-${theme}`), `${slug(route)}.png`);
      fs.mkdirSync(path.join(OUT, path.dirname(shot)), { recursive: true });
      await page.screenshot({ path: path.join(OUT, shot) });
    }

    const yBefore = await page.evaluate(() => window.scrollY);
    await dismissConsent(page);
    const yAfter = await page.evaluate(() => window.scrollY);
    if (Math.abs(yAfter - yBefore) > 40) {
      add({ check: 'scroll-jump', severity: 'error', selector: 'consent', message: `The page jumped ${Math.round(yAfter - yBefore)}px after answering the banner (focus moved to something far away).` });
    }
    (await page.evaluate(pageAudit)).forEach(add);

    // Steady state: anything still sitting on top of content at rest, or at the very bottom (unreachable).
    for (const [label, y] of [['top', 0], ['bottom', -1]]) {
      const goTo = () => page.evaluate((yy) => window.scrollTo(0, yy < 0 ? document.documentElement.scrollHeight : yy), y);
      await goTo();
      await page.waitForTimeout(250);
      // Scrolling can itself bring up a prompt that makes the page taller; scroll to the true end again.
      if (y < 0) { await goTo(); await page.waitForTimeout(250); }
      const hits = await page.evaluate(coverage);
      const byFixed = new Map();
      for (const c of hits) byFixed.set(c.fixed, [...(byFixed.get(c.fixed) ?? []), c]);
      for (const [fixed, list] of byFixed) {
        const name = fixed.split(' > ').pop();
        add({ check: 'covered-content', severity: 'error', selector: fixed,
          message: `${name} sits on top of content at the ${label} of the page, e.g. ${list.slice(0, 3).map((c) => `"${c.text.slice(0, 34)}" (${c.content.split(' > ').pop()})`).join('; ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}.` });
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    if (route === '/' && device.options.viewport.width < 768) await navTest(page, add);

    if (SHOTS && route === '/') {
      const full = path.join(slug(`${engine}-${device.name}-${theme}`), 'home-full.png');
      await page.screenshot({ path: path.join(OUT, full), fullPage: true }).catch(() => {});
    }
  } catch (e) {
    add({ check: 'load', severity: 'error', selector: route, message: `Page could not be tested: ${String(e.message).split('\n')[0]}` });
  }
  for (const n of noise) add({ check: 'console', severity: 'error', selector: route, message: n });
  await ctx.close();
  return { findings, shot, job };
}

/** Headline reveal and LCP on a mid-range phone: CPU 4x slower, Slow-4G network. Chromium only. */
async function perfJob(browsers, base, device) {
  const route = '/';
  const findings = [];
  const add = (f) => findings.push({ route, device: `${device.name} (throttled)`, engine: 'chromium', theme: 'dark', ...f });
  const ctx = await browsers.chromium.newContext({ ...device.options });
  await ctx.addInitScript(themeScript('dark'));
  await ctx.addInitScript(() => {
    window.__m = { h1: null, lcp: null, lcpEl: '' };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) { window.__m.lcp = e.startTime; window.__m.lcpEl = e.element ? e.element.tagName.toLowerCase() : ''; }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) { /* unsupported */ }
    (function poll() {
      const h = document.querySelector('h1');
      if (h && getComputedStyle(h).visibility !== 'hidden' && h.getBoundingClientRect().height > 0) { window.__m.h1 = performance.now(); return; }
      requestAnimationFrame(poll);
    })();
  });
  const page = await ctx.newPage();
  let info = '';
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(base + route, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(6000);
    const m = await page.evaluate(() => window.__m);
    info = `headline visible at ${m.h1 ? Math.round(m.h1) + 'ms' : 'NEVER'}, LCP ${m.lcp ? Math.round(m.lcp) + 'ms' : 'n/a'} (${m.lcpEl || '?'})`;
    if (!m.h1 || m.h1 > 2000) add({ check: 'headline-reveal', severity: 'error', selector: 'h1', message: `On a throttled phone (4x CPU, Slow 4G) the main headline first appears at ${m.h1 ? Math.round(m.h1) + 'ms' : 'never'}. Target: under 2000ms. A script hides it until the animation is ready.` });
    if (m.lcp && m.lcp > 2500) add({ check: 'lcp', severity: 'error', selector: m.lcpEl || 'page', message: `Largest Contentful Paint ${Math.round(m.lcp)}ms on a throttled phone (Google's "good" is under 2500ms).` });
  } catch (e) {
    add({ check: 'load', severity: 'error', selector: route, message: `Performance pass failed: ${String(e.message).split('\n')[0]}` });
  }
  await ctx.close();
  return { findings, info };
}

/** Reduced-motion pass on one device across all routes. */
async function motionJob(browsers, base, device, route) {
  const findings = [];
  const add = (f) => findings.push({ route, device: `${device.name} (reduce motion)`, engine: 'chromium', theme: 'dark', ...f });
  const ctx = await browsers.chromium.newContext({ ...device.options, reducedMotion: 'reduce' });
  await ctx.addInitScript(themeScript('dark'));
  const page = await ctx.newPage();
  try {
    await page.goto(base + route, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(900);
    for (const msg of await page.evaluate(motionAudit)) add({ check: 'reduced-motion', severity: 'error', selector: route, message: msg });
  } catch (e) {
    add({ check: 'load', severity: 'error', selector: route, message: `Reduced-motion pass failed: ${String(e.message).split('\n')[0]}` });
  }
  await ctx.close();
  return { findings };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

/* ------------------------------------------------------------------- main */

if (!LIVE && !fs.existsSync(DIST)) { console.error('dist/ not found. Run "npm run build" first, or pass --url=https://accessrank.ai'); process.exit(1); }

const routes = ONLY ?? collectPages();

// dist/ is committed, so it can quietly fall behind src/. Testing a stale build tests the wrong site.
if (!LIVE) {
  const newest = (dir) => {
    let t = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name);
      t = Math.max(t, e.isDirectory() ? newest(f) : fs.statSync(f).mtimeMs);
    }
    return t;
  };
  try {
    const srcTime = newest(path.join(ROOT, 'src'));
    const distTime = fs.statSync(path.join(DIST, 'index.html')).mtimeMs;
    if (srcTime > distTime + 1000) console.warn('! dist/ is OLDER than src/. You are testing a stale build. Run "npm run build" first.\n');
  } catch { /* no src/ here */ }
}
let server = null;
let base = LIVE;
if (!LIVE) { server = await startStaticServer(); base = `http://127.0.0.1:${server.address().port}`; }

const browsers = {};
const usable = [];
for (const engine of ENGINES) {
  try {
    browsers[engine] = await lib[engine].launch({
      executablePath: engine === 'chromium' ? process.env.CHROMIUM_PATH || undefined : undefined,
      args: engine === 'chromium' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    usable.push(engine);
  } catch (e) {
    console.warn(`! ${engine} is not available (${String(e.message).split('\n')[0]}). Install it with: npx playwright install ${engine}`);
  }
}
if (!usable.length) { console.error('No browser engine could be launched.'); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const jobs = [];
for (const engine of usable) {
  const devs = DEVICES.filter((d) => engine === 'chromium' || !isAndroid(d));
  for (const device of devs) for (const theme of THEMES) for (const route of routes) {
    jobs.push({ engine, device, theme, route, diagnostics: device === devs[0] && theme === THEMES[0] });
  }
}

console.log(`\nMobile tests: ${routes.length} pages x ${DEVICES.length} devices x ${THEMES.length} theme(s) x ${usable.join('+')}  against ${LIVE || 'local build (dist/)'}\n`);

const results = [];
const started = Date.now();
await pool(jobs, CONCURRENCY, async (job) => {
  const r = await layoutJob(job, browsers, base);
  results.push(r);
  process.stdout.write(r.findings.some((f) => f.severity === 'error' && !isKnown(f)) ? 'x' : '.');
});

let perfInfo = '';
const extra = [];
if (usable.includes('chromium')) {
  const phone = DEVICES.find((d) => d.name === 'Pixel 7') ?? DEVICES[1];
  if (!ONLY || ONLY.includes('/')) {
    const p = await perfJob(browsers, base, phone);
    extra.push(...p.findings);
    perfInfo = p.info;
  }
  await pool(routes, CONCURRENCY, async (route) => {
    const m = await motionJob(browsers, base, phone, route);
    extra.push(...m.findings);
  });
}
console.log(`\n\nDone in ${Math.round((Date.now() - started) / 1000)}s.\n`);

for (const b of Object.values(browsers)) await b.close();
if (server) server.close();

/* ----------------------------------------------------------------- report */

const all = [...results.flatMap((r) => r.findings), ...extra].map((f) => ({ ...f, known: isKnown(f) }));
const live = all.filter((f) => !f.known);
const errors = live.filter((f) => f.severity === 'error');
const warns = live.filter((f) => f.severity === 'warn');

// One line per distinct problem, with every place it happens.
const norm = (m) => m.replace(/\(\d+x\d+\)/g, '').replace(/\d+(\.\d+)?(px|ms)/g, 'N');
const group = (list) => {
  const m = new Map();
  for (const f of list) {
    const k = f.check === 'covered-content'
      ? `${f.check}|${f.route}|${f.selector}|${/bottom of the page/.test(f.message) ? 'bottom' : 'top'}`
      : `${f.check}|${f.route}|${norm(f.message)}`;
    const g = m.get(k) ?? { ...f, where: new Set() };
    g.where.add(`${f.device}${usable.length > 1 ? ` ${f.engine}` : ''}${THEMES.length > 1 ? ` ${f.theme}` : ''}`);
    m.set(k, g);
  }
  return [...m.values()];
};

const printGroups = (title, list, mark) => {
  if (!list.length) return;
  const groups = group(list);
  console.log(`${title} (${groups.length})`);
  for (const g of groups) {
    console.log(`  ${mark} [${g.check}] ${g.route}  ${g.message}`);
    console.log(`      on: ${[...g.where].join(', ')}`);
  }
  console.log('');
};
const printErrorSummary = (list) => {
  const groups = group(list);
  const by = new Map();
  for (const g of groups) by.set(g.check, [...(by.get(g.check) ?? []), g]);
  console.log(`ERRORS (${groups.length} distinct, grouped by cause here; every one is listed in the report)`);
  for (const [check, gs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    const pages = new Set(gs.map((g) => g.route));
    console.log(`  x [${check}] ${gs.length} issue(s) on ${pages.size} page(s)`);
    if (check === 'covered-content') {
      const bySel = new Map();
      for (const g of gs) {
        const k = `${g.selector.split(' > ').pop()} (${/bottom of the page/.test(g.message) ? 'page bottom' : 'page top'})`;
        bySel.set(k, new Set([...(bySel.get(k) ?? []), g.route]));
      }
      for (const [k, rs] of bySel) console.log(`      ${k}: ${rs.size} page(s), e.g. ${[...rs].slice(0, 4).join(', ')}`);
    } else {
      for (const g of gs.slice(0, 3)) console.log(`      ${g.route}  ${g.message.slice(0, 150)}`);
      if (gs.length > 3) console.log(`      ... and ${gs.length - 3} more`);
    }
  }
  console.log('');
};
const printWarnSummary = (list) => {
  if (!list.length) return;
  const byCheck = new Map();
  for (const g of group(list)) byCheck.set(g.check, [...(byCheck.get(g.check) ?? []), g]);
  console.log(`WARNINGS (${[...byCheck.values()].reduce((n, a) => n + a.length, 0)}, full list in the report)`);
  for (const [check, gs] of byCheck) {
    const routes = [...new Set(gs.map((g) => g.route))];
    console.log(`  ! [${check}] on ${routes.length} page(s): ${routes.slice(0, 6).join(', ')}${routes.length > 6 ? ', ...' : ''}`);
    console.log(`      e.g. ${gs[0].route}: ${gs[0].message.slice(0, 150)}`);
  }
  console.log('');
};

if (perfInfo) console.log(`Throttled-phone home page: ${perfInfo}\n`);
if (group(errors).length > 25) printErrorSummary(errors); else printGroups('ERRORS', errors, 'x');
printWarnSummary(warns);
if (all.some((f) => f.known)) console.log(`${all.filter((f) => f.known).length} finding(s) skipped as known issues (tests/mobile/known-issues.json).\n`);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (SHOTS) {
  const shotsByRoute = new Map();
  for (const r of results) if (r.shot) {
    const key = r.job.route;
    shotsByRoute.set(key, [...(shotsByRoute.get(key) ?? []), { label: `${r.job.device.name}${usable.length > 1 ? ` / ${r.job.engine}` : ''}${THEMES.length > 1 ? ` / ${r.job.theme}` : ''}`, src: r.shot.split(path.sep).join('/') }]);
  }
  const rows = [...shotsByRoute.entries()].sort().map(([route, shots]) => {
    const fs_ = group(all.filter((f) => f.route === route));
    return `<section><h2>${esc(route)}</h2><div class="strip">${shots.map((s) => `<figure><a href="${esc(s.src)}"><img loading="lazy" src="${esc(s.src)}" alt="${esc(route)} on ${esc(s.label)}"></a><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}</div>${fs_.length ? `<ul>${fs_.map((g) => `<li class="${g.known ? 'known' : g.severity}"><b>${esc(g.check)}</b> ${esc(g.message)} <small>(${esc([...g.where].join(', '))})</small></li>`).join('')}</ul>` : '<p class="ok">No findings.</p>'}</section>`;
  }).join('');
  fs.writeFileSync(path.join(OUT, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessrank mobile report</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px;border-top:1px solid #ddd;padding-top:16px}.strip{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}figure{margin:0;flex:none}img{display:block;width:170px;height:auto;border:1px solid #ccc}figcaption{font-size:12px;color:#555;margin-top:4px}ul{padding-left:18px}li.error{color:#a00}li.warn{color:#7a5200}li.known{color:#777}.ok{color:#060}small{color:#666}</style><h1>Accessrank mobile report</h1><p>${group(errors).length} distinct error(s), ${group(warns).length} warning(s). Target: ${esc(LIVE || 'local build')}. ${new Date().toISOString()}</p>${perfInfo ? `<p>Throttled phone, home page: ${esc(perfInfo)}</p>` : ''}${rows}</html>`);
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ target: LIVE || 'dist', generatedAt: new Date().toISOString(), perf: perfInfo, errors: errors.length, warnings: warns.length, findings: all }, null, 2));

console.log(`${group(errors).length} distinct error(s), ${group(warns).length} warning(s) (${errors.length}/${warns.length} counting every device). Report: test-results/mobile/report.html`);
if (errors.length || (STRICT && warns.length)) {
  console.log(STRICT && !errors.length ? 'FAILED (--strict: warnings count).' : 'FAILED.');
  process.exit(1);
}
console.log('PASSED.');
