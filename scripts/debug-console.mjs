#!/usr/bin/env node

/**
 * Find out what triggers a browser console error on a page, step by step.
 *
 *   node scripts/debug-console.mjs https://accessrank.ai/about
 *   node scripts/debug-console.mjs https://accessrank.ai/about --engine=webkit
 *
 * It loads the page in a phone-sized browser, then does the same things the mobile test does, one at a
 * time (wait, screenshot, tap Reject, scroll, ...) and prints any console message that appeared during each
 * step, including the file and line it came from.
 */

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const engine = opt('engine', 'chromium');
if (!url) { console.error('Usage: node scripts/debug-console.mjs <url> [--engine=chromium|webkit]'); process.exit(1); }

let lib;
try { lib = await import('playwright'); } catch { lib = await import('playwright-core'); }
lib = lib.default ?? lib;

const browser = await lib[engine].launch();
console.log(`Playwright ${lib.chromium ? '' : ''}${engine} ${browser.version()}`);
const ctx = await browser.newContext({ ...lib.devices['iPhone 15'] });
const page = await ctx.newPage();

let step = 'before load';
const seen = [];
const record = (kind, text, where) => { const line = `[${step}] ${kind}: ${text.slice(0, 300)}${where ? `   at ${where}` : ''}`; seen.push(line); console.log('  ' + line); };
page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const l = m.location();
  record(m.type(), m.text(), l && l.url ? `${l.url}:${l.lineNumber ?? '?'}` : '');
});
page.on('pageerror', (e) => record('pageerror', String(e.message), ''));

const run = async (name, fn) => { step = name; console.log(`- ${name}`); await fn(); await page.waitForTimeout(600); };

await run('goto (load)', () => page.goto(url, { waitUntil: 'load' }));
await run('wait 3s', () => page.waitForTimeout(3000));
await run('screenshot (viewport)', () => page.screenshot());
await run('evaluate (read the page)', () => page.evaluate(() => document.querySelectorAll('*').length));
await run('tap Reject', async () => {
  const b = page.getByRole('button', { name: /^reject/i }).first();
  if (await b.isVisible().catch(() => false)) await b.click({ timeout: 4000 }).catch(() => {});
});
await run('scroll to bottom', () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)));
await run('scroll to top', () => page.evaluate(() => window.scrollTo(0, 0)));
await run('screenshot (full page)', () => page.screenshot({ fullPage: true }));

const styles = await page.evaluate(() => [...document.querySelectorAll('style')].map((s) => `${s.parentElement.tagName} ${s.textContent.length} chars: ${s.textContent.slice(0, 70).replace(/\s+/g, ' ')}`));
console.log(`\n<style> elements left on the page (${styles.length}):`);
styles.forEach((s) => console.log('  ' + s));
console.log(seen.length ? `\n${seen.length} console message(s) above. The step in [brackets] is what triggered it.` : '\nNo console errors or warnings at any step.');
await browser.close();
