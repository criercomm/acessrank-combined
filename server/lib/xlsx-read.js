/**
 * A small reader for .xlsx workbooks: the cell values of every sheet, as text, and nothing else.
 *
 * Enough for a filled-in results sheet coming back from a testing vendor. It reads the zip
 * directory, inflates only the parts it needs (the workbook, its relationships, the shared
 * strings and each sheet) and ignores styles, formulas and charts. A formula cell gives its
 * last saved value. No dependency: node:zlib does the inflating.
 *
 * Limits keep a hostile file small: at most 400 entries in the zip, 20 MB inflated per part.
 */
import zlib from 'node:zlib';

const MAX_ENTRIES = 400;
const MAX_PART = 20 * 1024 * 1024;

export class XlsxError extends Error {}

function unzip(buf) {
  // End of central directory: the last 0x06054b50 within the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('That file is not an .xlsx workbook.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError('That workbook has too many parts to read.');
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('That workbook is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name.replace(/^\/+/, ''), { method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw new XlsxError('That workbook is damaged.');
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.compSize);
    let out;
    if (e.method === 0) out = raw;
    else if (e.method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: MAX_PART });
    else throw new XlsxError('That workbook uses a compression this reader does not support.');
    return out.toString('utf8');
  };
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** All the text in <t> elements inside a block (rich text runs joined), skipping phonetic hints. */
const textOf = (xml) => decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g) || [])
  .map((t) => (t.endsWith('/>') ? '' : t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''))).join(''));

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

/** Column letters to a 0-based index: A -> 0, AA -> 26. */
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/**
 * Read a workbook. Returns { sheets: [{ name, rows }] } in workbook order, where rows is an array
 * of arrays of strings ('' for an empty cell). Numbers come back as written in the file.
 */
export function readXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError('That file is not an .xlsx workbook.');
  const part = unzip(buf);
  const workbook = part('xl/workbook.xml');
  if (!workbook) throw new XlsxError('That file is not an .xlsx workbook.');
  const rels = part('xl/_rels/workbook.xml.rels') || '';
  const targets = new Map();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) || []) {
    const target = attr(tag, 'Target') || '';
    targets.set(attr(tag, 'Id'), target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const shared = [];
  const sst = part('xl/sharedStrings.xml');
  if (sst) for (const si of sst.match(/<si\b[\s\S]*?<\/si>/g) || []) shared.push(textOf(si));

  const sheets = [];
  for (const tag of workbook.match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(tag, 'name') || `Sheet${sheets.length + 1}`;
    const rid = attr(tag, 'r:id');
    const xml = part(targets.get(rid) || '') || '';
    const rows = [];
    for (const row of xml.match(/<row\b[^>]*\/>|<row\b[^>]*[^/>]>[\s\S]*?<\/row>|<row>[\s\S]*?<\/row>/g) || []) {
      const rIndex = Number(attr(row.match(/<row\b[^>]*>/)[0], 'r')) - 1;
      const cells = [];
      let next = 0;
      for (const c of row.match(/<c\b[^>]*\/>|<c\b[^>]*[^/>]>[\s\S]*?<\/c>|<c>[\s\S]*?<\/c>/g) || []) {
        const open = c.match(/<c\b[^>]*>/)[0];
        const ref = attr(open, 'r');
        const col = ref ? colIndex(ref.replace(/\d+/g, '')) : next;
        next = col + 1;
        const type = attr(open, 't');
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf((c.match(/<is>[\s\S]*?<\/is>/) || [''])[0]);
        else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (v !== undefined) value = decode(v);
        cells[col] = value;
      }
      const index = Number.isFinite(rIndex) && rIndex >= 0 ? rIndex : rows.length;
      rows[index] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
    }
    sheets.push({ name, rows: Array.from({ length: rows.length }, (_, i) => rows[i] ?? []) });
  }
  return { sheets };
}

/** Parse CSV text (RFC 4180: quotes, doubled quotes, newlines inside quotes). */
export function readCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** An Excel date serial (days since 1899-12-30) as YYYY-MM-DD, or the text unchanged. */
export function excelDate(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{5}(\.\d+)?$/.test(s)) return s;
  const ms = Math.round((Number(s) - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}
