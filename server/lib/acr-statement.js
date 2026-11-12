/**
 * Pull the proposed accessibility statement out of a client report, so the approved
 * wording can go into the ACR update word for word.
 *
 * Reports are hand-built HTML pages, so this looks for the statement block in this order:
 *   1. an element marked data-acr-content="statement" (use this in new reports)
 *   2. a <div class="statement"> or <div class="stmt"> whose first line is "Accessibility Statement"
 * The block is reduced to plain text: headings, paragraphs and list items, in order.
 * No markup from the report is ever passed through.
 */

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·',
  eacute: 'é', copy: '©', reg: '®', trade: '™', bull: '•',
};

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent.toLowerCase()] ?? m;
  });
}

const plain = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** Find the end of the element whose opening tag ends at `from`, counting nested tags of the same name. */
function closeOf(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

function findBlock(html) {
  const candidates = [];
  const marked = /<([a-z][a-z0-9]*)\b[^>]*\bdata-acr-content\s*=\s*["']statement["'][^>]*>/i.exec(html);
  if (marked) candidates.push(marked);
  const re = /<(div|section|article|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:statement|stmt)\b[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) candidates.push(m);
  for (const open of candidates) {
    const start = open.index + open[0].length;
    const end = closeOf(html, open[1], start);
    if (end < 0) continue;
    const inner = html.slice(start, end);
    const lead = decode(inner.slice(0, 400).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (open === marked || /^accessibility statement\b/i.test(lead)) return inner;
  }
  return null;
}

/**
 * The statement as an ordered list of blocks: { type: 'heading' | 'paragraph' | 'item', text }.
 * Returns null when the report has no statement block.
 */
export function extractStatement(html) {
  if (typeof html !== 'string' || !html) return null;
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const inner = findBlock(body);
  if (!inner) return null;
  const blocks = [];
  const re = /<(h[1-6]|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(inner))) {
    const text = plain(m[3]);
    if (!text) continue;
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(m[2])?.[1] ?? '';
    const heading = /^h/i.test(m[1]) || /\b(st|sh|heading|title)\b/.test(cls) || /\bdata-acr-heading\b/i.test(m[2]);
    blocks.push({ type: m[1].toLowerCase() === 'li' ? 'item' : heading ? 'heading' : 'paragraph', text });
  }
  return blocks.length ? blocks : null;
}

/** Does this approval item ask about the accessibility statement itself? */
export function isStatementItem(key, title) {
  return key === 'statement' || /\baccessibility statement\b|\bstatement text\b|\bproposed statement\b/i.test(String(title ?? ''));
}

/** Bracketed blanks left in the wording, such as "[date of publication]". */
export function statementPlaceholders(blocks) {
  const found = new Set();
  for (const b of blocks ?? []) for (const m of b.text.matchAll(/\[[^\]]{2,60}\]/g)) found.add(m[0]);
  return [...found];
}
