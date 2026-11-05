// Pre-render the overview deck's words into real HTML.
//
// Why this exists
// ---------------
// The deck is a Vite app: its shipped markup is `<main id="deck"></main>` and
// every word lives inside the JavaScript bundle. A browser runs that bundle and
// sees a deck. Anything that reads raw HTML — the AI crawlers in robots.txt
// (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) among them — sees an empty
// page, because they do not execute JavaScript. A screen reader on a slow
// connection, or any visitor with the bundle blocked, sees the same nothing.
//
// So at build time we read deck/src/copy.js, the deck's single source of copy,
// and write a plain readable version of it into the page as a <section> that
// sits after <main>. Nothing is hidden and nothing is duplicated for crawlers
// only: with JavaScript off the text IS the page, and with JavaScript on the
// deck covers the viewport while the text stays in the document, one link away
// (see the :target rule in the stylesheet below — no script needed).
//
// lib/deck.js mounts with `root.append(stage, chrome)`, so it never clears what
// is already inside #deck; the text block is a sibling of #deck regardless, so
// hydration cannot remove it.
//
// Run by build.mjs against dist/deck/index.html, so the deck's own committed
// build in src/assets/static/deck stays untouched and this can never drift from
// copy.js. Also runnable on its own to look at the output:
//     node scripts/prerender-deck.mjs            # print the HTML
//     node scripts/prerender-deck.mjs --text     # print just the words
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Slide order as src/main.js imports it. s11 (Libraries) is deliberately absent
// from the deck, so it is absent here; `chapters` in copy.js labels these nine
// in the same order.
const SLIDES = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's12'];

// Never pre-rendered: presenter scripts, and the fictional demo storefront used
// to animate the fix (Northline Goods and its products are a prop — indexing it
// would publish invented product names as if they were Accessrank's).
const SKIP_FIELDS = new Set(['notes', 'store', 'letterAlt', 'counts', 'score', 'panel', 'evidence', 'diff', 'catalog', 'rollback']);

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const p = (s) => has(s) ? `<p>${esc(s)}</p>` : '';
const fine = (s) => has(s) ? `<p class="dt-fine">${esc(s)}</p>` : '';

// A figure with its source attributed. Sourced statistics are the part of this
// deck most worth making readable, so each one keeps its citation next to it
// rather than in a footnote.
function stat({ value, label, source }) {
  if (!has(value) && !has(label)) return '';
  return `<li><span class="dt-value">${esc(value)}</span> <span class="dt-label">${esc(label)}</span>`
    + (has(source) ? ` <cite>${esc(source)}</cite>` : '') + '</li>';
}

const statList = (items) => {
  const rows = (items || []).map(stat).filter(Boolean).join('');
  return rows ? `<ul class="dt-stats">${rows}</ul>` : '';
};

const plainList = (items, cls = '') => {
  const rows = (items || []).filter(has).map((s) => `<li>${esc(s)}</li>`).join('');
  return rows ? `<ul${cls ? ` class="${cls}"` : ''}>${rows}</ul>` : '';
};

// { label, line } / { label, steps } pairs read as a description list.
function pairList(items, lineKey = 'line') {
  const rows = (items || []).map((it) => {
    if (!has(it?.label)) return '';
    const body = Array.isArray(it[lineKey] ?? it.steps)
      ? (it[lineKey] ?? it.steps).filter(has).map(esc).join(', ')
      : it[lineKey];
    return `<dt>${esc(it.label)}</dt>${has(body) ? `<dd>${esc(body)}</dd>` : ''}`;
  }).filter(Boolean).join('');
  return rows ? `<dl class="dt-pairs">${rows}</dl>` : '';
}

function slideBody(key, s) {
  const out = [];
  const put = (html) => { if (html) out.push(html); };

  put(p(s.sub));
  put(p(s.lede));
  put(statList(s.stats));
  put(statList(s.tiles));

  // s03 states its headline figure as pct / pctLabel / pctSource.
  if (has(s.pct)) {
    put(statList([{ value: `${s.pct}${s.pctSuffix || ''}`, label: s.pctLabel, source: s.pctSource }]));
  }

  // The four scan-to-validate stages, and the guardrails around a theme edit.
  if (Array.isArray(s.stages)) put(plainList(s.stages, 'dt-inline'));
  if (Array.isArray(s.steps)) {
    const rows = s.steps.map((st) => has(st?.label)
      ? `<li><strong>${esc(st.label)}</strong>${has(st.line) ? ` ${esc(st.line)}` : ''}</li>` : '').filter(Boolean).join('');
    if (rows) put(`<ol class="dt-steps">${rows}</ol>`);
  }

  // Audit findings carry the success criterion they map to.
  if (Array.isArray(s.findings)) {
    const rows = s.findings.map((f) => has(f?.label)
      ? `<li>${esc(f.label)}${has(f.wcag) ? ` <span class="dt-wcag">WCAG ${esc(f.wcag)}</span>` : ''}</li>` : '').filter(Boolean).join('');
    if (rows) put(`<ul class="dt-findings">${rows}</ul>`);
  }

  if (Array.isArray(s.standards)) put(pairList(s.standards));
  if (Array.isArray(s.rails)) put(pairList(s.rails, 'steps'));
  if (has(s.platformsLabel)) put(`<h3>${esc(s.platformsLabel)}</h3>`);
  if (Array.isArray(s.platforms)) put(plainList(s.platforms, 'dt-inline'));

  // Plans: name, what it is for, the two prices, and what is included.
  if (Array.isArray(s.plans)) {
    const rows = s.plans.map((pl) => {
      if (!has(pl?.name)) return '';
      const price = [has(pl.once) ? `${esc(pl.once)} once` : '', has(pl.monthly) ? `${esc(pl.monthly)} a month` : '']
        .filter(Boolean).join(' · ');
      return `<div class="dt-plan"><h3>${esc(pl.name)}</h3>`
        + (price ? `<p class="dt-price">${price}</p>` : '')
        + p(pl.who) + plainList(pl.items) + '</div>';
    }).filter(Boolean).join('');
    if (rows) put(`<div class="dt-plans">${rows}</div>`);
  }
  if (s.express && has(s.express.name)) {
    put(`<h3>${esc(s.express.name)}</h3>`);
    put(p(s.express.line));
  }
  put(p(s.today));
  put(p(s.next));

  // Market tables.
  for (const [labelKey, listKey, srcKey] of [['statesLabel', 'states', 'statesSource'], ['industriesLabel', 'industries', 'industriesSource']]) {
    if (!Array.isArray(s[listKey])) continue;
    if (has(s[labelKey])) put(`<h3>${esc(s[labelKey])}</h3>`);
    const rows = s[listKey].map((r) => has(r?.name)
      ? `<li>${esc(r.name)}${has(r.n) ? ` <span class="dt-n">${esc(r.n)}</span>` : ''}</li>` : '').filter(Boolean).join('');
    if (rows) put(`<ul class="dt-rank">${rows}</ul>`);
    if (has(s[srcKey])) put(`<p class="dt-fine"><cite>${esc(s[srcKey])}</cite></p>`);
  }

  // Contact. An entry with no name still has a role and an address worth
  // printing, so the blank is dropped rather than the whole person.
  if (Array.isArray(s.people)) {
    const rows = s.people.map((who) => {
      const bits = [has(who?.name) ? `<strong>${esc(who.name)}</strong>` : '', has(who?.role) ? esc(who.role) : '',
        has(who?.email) ? `<a href="mailto:${esc(who.email)}">${esc(who.email)}</a>` : '',
        has(who?.phone) ? esc(who.phone) : ''].filter(Boolean);
      return bits.length ? `<li>${bits.join(' · ')}</li>` : '';
    }).filter(Boolean).join('');
    if (rows) put(`<ul class="dt-people">${rows}</ul>`);
  }
  if (has(s.site)) put(`<p><a href="${esc(s.siteHref || `https://${s.site}`)}">${esc(s.site)}</a></p>`);

  put(fine(s.micro));
  put(has(s.rollback) ? fine(s.rollback) : '');
  return out.join('\n      ');
}

// The page's one <h1> is the first slide's headline, here in the text; the slide
// draws the same words as an <h2> styled as the hero (s01-cover.js), so a reader
// with or without JavaScript meets exactly one h1 and it says the same thing.
const DEFINITION = 'Accessrank is a US accessibility and discovery service for online stores. '
  + 'We fix WCAG 2.2 Level AA failures in your theme code, prove the work in a dated record, '
  + 'and rebuild the product data Google and AI search need to recommend you.';

export function renderDeckText(copy) {
  const chapters = copy.chapters || [];
  const titleOf = (s) => Array.isArray(s?.title) ? s.title.filter(has).join(' ') : s?.title;
  const sections = SLIDES.map((key, i) => {
    const s = copy[key];
    if (!s) return '';
    for (const f of SKIP_FIELDS) delete s[f];
    const heading = titleOf(s);
    const label = chapters[i];
    const body = slideBody(key, s);
    if (!has(heading) && !body) return '';
    // Slide 1's headline is the document's h1 above; its section carries no second heading.
    const h = i === 0 ? '' : `<h2 id="dt-${key}">${esc(heading)}</h2>`;
    return `    <section class="dt-section"${i === 0 ? '' : ` aria-labelledby="dt-${key}"`}>
      ${has(label) ? `<p class="dt-chapter">${esc(label)}</p>` : ''}
      ${h}
      ${body}
    </section>`;
  }).filter(Boolean).join('\n');

  return `  <section id="deck-text" class="deck-text" aria-label="Text version of the Accessrank overview">
    <p class="dt-eyebrow">${esc(copy.brand || 'Accessrank')} overview</p>
    <h1>${esc(titleOf(copy.s01) || `${copy.brand || 'Accessrank'} overview`)}</h1>
    <p class="dt-definition">${esc(DEFINITION)}</p>
    ${p(copy.spine)}
${sections}
    <p class="dt-back"><a href="#deck">Back to the slides</a></p>
  </section>`;
}

export async function loadCopy() {
  // A file: URL, not a bare path — import() of 'C:\\...' fails on Windows, and
  // the deck is built there as well as on macOS and in the Linux image.
  const mod = await import(pathToFileURL(path.join(HERE, '..', 'deck', 'src', 'copy.js')).href);
  return mod.copy;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const copy = await loadCopy();
  const html = renderDeckText(copy);
  if (process.argv.includes('--text')) {
    console.log(html.replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim());
  } else {
    console.log(html);
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
// lib/deck.css pins the document — `html { overflow: hidden }` and
// `body { position: fixed; inset: 0 }` — and it is a linked stylesheet, so it
// applies whether or not the bundle ever runs. Left alone, that would clip the
// text version even with JavaScript off. These rules hand the document back in
// the two cases where the deck is not the thing on screen.
//
// `.deck` is added to #deck by createDeck, so it is a reliable marker for "the
// bundle ran". No script of our own is involved: :target does the switching.
export const DECK_TEXT_CSS = `
.deck-text-skip { position: fixed; top: 8px; left: 8px; z-index: 9999; padding: 10px 16px; border-radius: 6px;
  background: #FFD23F; color: #14142A; font: 600 15px/1.2 Inter, system-ui, sans-serif; text-decoration: none;
  transform: translateY(-200%); }
.deck-text-skip:focus { transform: none; }

.deck-text { max-width: 760px; margin: 0 auto; padding: 56px 24px 96px; color: #E8E6F0;
  font: 400 17px/1.7 Inter, system-ui, sans-serif; }
.dt-eyebrow { font: 700 12px/1 Inter, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #9A96B0; margin: 0 0 12px; }
.deck-text h1 { font-size: 34px; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 14px; color: #fff; }
.dt-definition { font-size: 18px; line-height: 1.6; color: #fff; margin: 0 0 12px; }
.deck-text h2 { font-size: 25px; line-height: 1.2; letter-spacing: -.02em; margin: 0 0 14px; color: #fff; }
.deck-text h3 { font-size: 17px; margin: 24px 0 8px; color: #fff; }
.deck-text h4 { font-size: 17px; margin: 0 0 4px; color: #fff; }
.deck-text p { margin: 0 0 14px; }
.deck-text a { color: #FFD23F; }
.dt-section { padding: 28px 0; border-top: 1px solid rgba(255,255,255,.14); }
.dt-chapter { font: 700 12px/1 Inter, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase;
  color: #9A96B0; margin: 0 0 10px; }
.deck-text ul, .deck-text ol { margin: 0 0 14px; padding-left: 22px; }
.deck-text li { margin: 0 0 7px; }
.dt-stats { list-style: none; padding: 0; }
.dt-stats li { margin: 0 0 12px; }
.dt-value { font-weight: 800; color: #FFD23F; }
.dt-stats cite, .dt-fine cite { display: block; font-style: normal; font-size: 13px; color: #9A96B0; }
.dt-fine { font-size: 13px; color: #9A96B0; }
.dt-wcag, .dt-n { color: #9A96B0; font-size: 14px; }
.dt-inline { list-style: none; padding: 0; }
.dt-inline li { display: inline; }
.dt-inline li + li::before { content: " \\2022 "; color: #9A96B0; }
.dt-pairs { margin: 0 0 14px; }
.dt-pairs dt { font-weight: 700; color: #fff; }
.dt-pairs dd { margin: 0 0 8px; }
.dt-plan { padding: 14px 0; border-top: 1px solid rgba(255,255,255,.1); }
.dt-price { color: #FFD23F; font-weight: 700; margin: 0 0 6px; }
.dt-people { list-style: none; padding: 0; }
.dt-back { margin-top: 32px; }

/* Where scripts run, the deck owns the viewport from the first paint: park the
   text below it, where body's own overflow:hidden clips it. Deliberately NOT
   display:none or visibility:hidden — it stays laid out and part of the
   document, which is both honest and what keeps it worth indexing.
   This keys off \`(scripting: enabled)\` rather than off the deck having
   mounted (\`#deck.deck\`), because the mount happens after first paint: parking
   the text only then moved it out from under the slides and scored a 0.98
   Cumulative Layout Shift in Lighthouse. */
@media (scripting: enabled) {
  body:not(:has(#deck-text:target)) #deck-text { position: absolute; top: 100%; left: 0; width: 100%; }
}
/* No JavaScript: the deck never mounts, so the document is a normal page. */
@media (scripting: none) {
  html, body { position: static; overflow: auto; height: auto; }
}
/* Reading the text: step the deck aside. */
html:has(#deck-text:target), body:has(#deck-text:target) { position: static; overflow: auto; height: auto; }
body:has(#deck-text:target) #deck { display: none; }
`;

const START = '<!-- deck-text:start -->';
const END = '<!-- deck-text:end -->';

const LINK_START = '<!-- deck-text:css -->';

// Idempotent: a previous block is replaced, so re-running never stacks copies.
//
// The stylesheet goes in as a <link>, not a <style> block. server/app.js sends
// a Content-Security-Policy whose style-src is 'self' plus the exact hash of
// the main site's one inline block — never 'unsafe-inline' — so an inline
// <style> added here is silently dropped by the browser and the text renders
// unstyled on top of the deck. A same-origin file is allowed by 'self'.
// `cssHref` is where build.mjs wrote DECK_TEXT_CSS.
export function injectDeckText(html, copy, { cssHref } = {}) {
  if (!cssHref) throw new Error('prerender-deck: cssHref is required (see build.mjs)');
  let out = html
    .replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, 'g'), '')
    .replace(new RegExp(`\\s*${LINK_START}[^\\n]*`, 'g'), '');
  const link = `${LINK_START}<link rel="stylesheet" href="${cssHref}">`;
  const block = `${START}\n`
    + `<nav class="deck-text-skipnav" aria-label="Text version"><a class="deck-text-skip" href="#deck-text">Read this overview as text</a></nav>\n`
    + `${renderDeckText(copy)}\n${END}`;
  if (!out.includes('</head>') || !out.includes('</body>')) throw new Error('prerender-deck: deck HTML has no </head> or </body>');
  out = out.replace('</head>', `    ${link}\n  </head>`);
  return out.replace('</body>', `${block}\n  </body>`);
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------
// The slides are served from a committed Vite build in src/assets/static/deck;
// the text version is generated from deck/src/copy.js at build time. Nothing
// rebuilds the slides automatically, so after an edit to copy.js the page can
// say one thing in its text and another on its slides until someone runs
//     cd deck && DECK_BASE=/deck/ npm run build
// and copies deck/dist over src/assets/static/deck. This compares a few
// distinctive strings from copy.js against the bundle the page actually loads
// and names the first one missing. Used by build.mjs (a warning) and by the
// unit tests (a failure).
export function deckBundleDrift(copy, staticDeckDir) {
  const fs = require('node:fs');
  const indexHtml = path.join(staticDeckDir, 'index.html');
  if (!fs.existsSync(indexHtml)) return { ok: false, reason: `no ${indexHtml}` };
  const ref = fs.readFileSync(indexHtml, 'utf8').match(/\/deck\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  if (!ref) return { ok: false, reason: 'index.html references no index-*.js bundle' };
  const bundlePath = path.join(staticDeckDir, 'assets', ref[1]);
  if (!fs.existsSync(bundlePath)) return { ok: false, reason: `${ref[1]} is referenced but not on disk` };
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const probes = [
    ['s01.title[1]', String(copy.s01?.title?.[1] || '')],
    ['s01.sub', String(copy.s01?.sub || '').slice(0, 48)],
    ['s02.title', String(copy.s02?.title?.[0] || '')],
    ['s03.lede', String(copy.s03?.lede || '').slice(0, 48)],
    ['s07.express.name', String(copy.s07?.express?.name || '')],
    ['s07.express.line', String(copy.s07?.express?.line || '').slice(0, 48)],
    ['s12.people[0].name', String(copy.s12?.people?.[0]?.name || '')],
    ['s12.people[1].name', String(copy.s12?.people?.[1]?.name || '')],
  ].filter(([, v]) => v.length >= 3);
  for (const [field, text] of probes) {
    if (!bundle.includes(text)) return { ok: false, reason: `copy.js ${field} says "${text}" but ${ref[1]} does not contain it`, bundle: ref[1] };
  }
  return { ok: true, bundle: ref[1], probes: probes.length };
}
