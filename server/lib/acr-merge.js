/**
 * Merge queued, approved changes into an ACR draft written as HTML.
 *
 * The draft marks the places that change with data-acr attributes. Everything else in the
 * draft is left exactly as written. Values from approvals are always escaped.
 *
 *   data-acr="version"          Text such as "Version 1.0 draft". The number goes up by 0.1 and "draft" is dropped.
 *   data-acr="date"             Text such as "November 6, 2026". Set to the date the update is built.
 *   data-acr="history"          Record history (a table, tbody, list or block). One row is added per update.
 *   data-acr="remediation-log"  Section 2. One row per change.
 *   data-acr="conformance"      Section 3. One row per change that names a criterion.
 *   data-acr="approvals"        Client approvals recorded. One row per change.
 *   data-acr="statement"        Exhibit D. Replaced with the approved statement wording.
 *   data-acr="statement-status" Replaced with "Approved by <name> on <date>."
 *   data-acr="appendix"         Anything with no marked place goes in an "Updates" section just before this.
 *   data-acr-when="KEY"         Kept hidden until the item with this approval key is applied, then shown.
 *   data-acr-until="KEY"        Removed once the item with this approval key is applied (e.g. "pending" notes).
 *                               Either can test the answer too: "contacts~Option 3" matches only when the
 *                               contacts answer contains "Option 3" (case ignored).
 *   data-acr-fill="KEY"         Its text is replaced with that item's answer (the choice, or the comment).
 *                               With data-acr-format="…" the text is built from tokens instead:
 *                               {{@choice}} {{@answer}} {{@comment}} {{@signer}} {{@date}} {{@live}}, or
 *                               {{Field label}} for a field the client filled in (e.g. {{Freshé contact email}}).
 *                               A token can name another item: {{footer:@choice}}.
 *   data-acr-order="newest-first"  On a container: new rows go at the top (after the row template).
 *   data-acr-placeholder="…"    A highlighted draft placeholder still left after the merge. Build replaces the whole
 *                               element with the attribute's text, or with its own text minus the [brackets] if the
 *                               attribute is empty, so no draft marking reaches the built ACR.
 *
 * A container can hold <template data-acr-row>…</template> with {{date}}, {{title}}, {{answer}},
 * {{signer}}, {{approvedOn}}, {{comment}}, {{criterion}}, {{conformance}}, {{note}}, {{report}},
 * {{details}}, {{version}}, {{builtBy}} and {{dateShort}} (e.g. "Nov 10"). New rows are placed just before the template.
 * With no template, a table or tbody gets <tr><td>date</td><td>title</td><td>details</td></tr>,
 * a list gets <li>, anything else gets <p>.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function closeOf(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** Every element whose opening tag matches attrRe: { tag, open, openEnd, innerStart, innerEnd, end }. */
function findAll(html, attrRe) {
  const out = [];
  const re = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!attrRe.test(m[2])) continue;
    const tag = m[1].toLowerCase();
    const openEnd = m.index + m[0].length;
    if (VOID.has(tag) || m[0].endsWith('/>')) {
      out.push({ tag, attrs: m[2], start: m.index, innerStart: openEnd, innerEnd: openEnd, end: openEnd });
      continue;
    }
    const close = closeOf(html, tag, openEnd);
    if (!close) continue;
    out.push({ tag, attrs: m[2], start: m.index, innerStart: openEnd, innerEnd: close.start, end: close.end });
  }
  return out;
}

const marker = (name) => new RegExp(`\\bdata-acr\\s*=\\s*["']${name}["']`, 'i');
const keyAttr = (attr) => new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
const fill = (tpl, fields) => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => esc(fields[k] ?? ''));
const decodeEntities = (t) => t.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);
const plainText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Apply a change to the first (or every) marked element, searching fresh each time so offsets stay right. */
function each(html, re, fn, { all = true } = {}) {
  let out = html;
  let from = 0;
  for (;;) {
    const hit = findAll(out.slice(from), re)[0];
    if (!hit) return out;
    const el = { ...hit, start: hit.start + from, innerStart: hit.innerStart + from, innerEnd: hit.innerEnd + from, end: hit.end + from };
    const replaced = fn(el, out);
    if (replaced == null) { from = el.end; continue; }
    out = out.slice(0, el.start) + replaced + out.slice(el.end);
    from = el.start + replaced.length;
    if (!all) return out;
  }
}

function defaultRow(tag, fields) {
  if (tag === 'table' || tag === 'tbody' || tag === 'thead') {
    return `<tr><td>${esc(fields.date)}</td><td>${esc(fields.title)}</td><td>${esc(fields.details)}</td></tr>`;
  }
  if (tag === 'ul' || tag === 'ol') return `<li><strong>${esc(fields.title)}</strong> (${esc(fields.date)}). ${esc(fields.details)}</li>`;
  return `<p><strong>${esc(fields.title)}</strong> (${esc(fields.date)}). ${esc(fields.details)}</p>`;
}

/** Add rows to the first element with this marker. Returns [html, placed]. */
function addRows(html, name, rows) {
  if (!rows.length) return [html, true];
  let placed = false;
  const out = each(html, marker(name), (el, doc) => {
    placed = true;
    let inner = doc.slice(el.innerStart, el.innerEnd);
    let tag = el.tag;
    // A marked table with a tbody takes its rows in the tbody.
    let pre = '';
    let post = '';
    if (tag === 'table') {
      const body = findAll(inner, /(?:)/).find((x) => x.tag === 'tbody');
      if (body) { pre = inner.slice(0, body.innerStart); post = inner.slice(body.innerEnd); inner = inner.slice(body.innerStart, body.innerEnd); tag = 'tbody'; }
    }
    const tplHit = /<template\b[^>]*\bdata-acr-row\b[^>]*>([\s\S]*?)<\/template>/i.exec(inner);
    const newestFirst = /\bdata-acr-order\s*=\s*["']newest-first["']/i.test(el.attrs);
    const ordered = newestFirst ? [...rows].reverse() : rows;
    const built = ordered.map((f) => (tplHit ? fill(tplHit[1].trim(), f) : defaultRow(tag, f))).join('\n');
    let next;
    if (tplHit && newestFirst) {
      const after = tplHit.index + tplHit[0].length;
      next = inner.slice(0, after) + '\n' + built + inner.slice(after);
    } else if (tplHit) {
      next = inner.slice(0, tplHit.index) + built + '\n' + inner.slice(tplHit.index);
    } else {
      next = inner.replace(/\s*$/, '') + '\n' + built + '\n';
    }
    return doc.slice(el.start, el.innerStart) + pre + next + post + doc.slice(el.innerEnd, el.end);
  }, { all: false });
  return [out, placed];
}

function statementHtml(blocks) {
  const parts = [];
  let list = [];
  const flush = () => { if (list.length) parts.push(`<ul>${list.join('')}</ul>`); list = []; };
  for (const b of blocks) {
    if (b.type === 'item') { list.push(`<li>${esc(b.text)}</li>`); continue; }
    flush();
    parts.push(b.type === 'heading' ? `<h4>${esc(b.text)}</h4>` : `<p>${esc(b.text)}</p>`);
  }
  flush();
  return parts.join('\n');
}

export function isHtmlDraft(name) {
  return /\.html?$/i.test(String(name ?? ''));
}

/** The version the draft states, e.g. "1.0", or '' if it has no version marker. */
export function draftVersion(html) {
  const hit = findAll(html, marker('version'))[0];
  const m = hit && /(\d+)\.(\d+)/.exec(plainText(html.slice(hit.innerStart, hit.innerEnd)));
  return m ? `${m[1]}.${m[2]}` : '';
}

/** "1.0 draft" becomes 1.0 (the draft is issued); an issued 1.0 becomes 1.1. */
export function nextVersion(current, isDraft = false) {
  const m = /^(\d+)\.(\d+)$/.exec(current || '');
  if (!m) return isDraft ? '1.0' : '1.1';
  return isDraft ? `${m[1]}.${m[2]}` : `${m[1]}.${Number(m[2]) + 1}`;
}

function draftVersionText(html) {
  const hit = findAll(html, marker('version'))[0];
  return hit ? plainText(html.slice(hit.innerStart, hit.innerEnd)) : '';
}
function draftDateText(html) {
  const hit = findAll(html, marker('date'))[0];
  return hit ? plainText(html.slice(hit.innerStart, hit.innerEnd)) : '';
}

/** The client's own words in an answer, without the "Label: value" lines of fields they filled in. */
function clientNote(w) {
  const lines = String(w.comment ?? '').split('\n').filter(Boolean);
  const notes = lines.find((l) => l.startsWith('Notes: '));
  let note;
  if (notes) note = notes.slice(7).trim();
  else {
    const fieldsOnly = lines.length > 0 && lines.every((l) => /^[^:]{1,80}: /.test(l) || /\.$/.test(l));
    note = fieldsOnly && lines.some((l) => /^[^:]{1,80}: /.test(l)) ? '' : String(w.comment ?? '').trim();
  }
  // A comment that only repeats the signer's name (clients often sign in the comment box) is not a note.
  const squash = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return note && squash(note) === squash(w.signerName) ? '' : note;
}

/** A bare 10-digit US number, as clients type it, in the usual written form: (603) 834-6034. */
function formatPhone(v) {
  const d = String(v).replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 && /^[\d\s().+-]+$/.test(v) ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : v;
}

/** The value of one field line ("Label: value") the client filled in, from an answer's comment. */
function fieldValue(w, label) {
  const lines = String(w.comment ?? '').split('\n');
  const clean = (v) => (/phone/i.test(label) ? formatPhone(v.trim()) : v.trim());
  for (const line of lines) {
    if (line.startsWith(`${label}: `)) return clean(line.slice(label.length + 2));
  }
  // The template's generic labels ("Contact email") also match a client's own ("Freshé contact email").
  const want = label.toLowerCase();
  for (const line of lines) {
    const i = line.indexOf(': ');
    if (i > 0 && line.slice(0, i).toLowerCase().endsWith(want)) return clean(line.slice(i + 2));
  }
  return '';
}

/** True when the draft has its own Exhibit D statement (id="exd" or a class="statement" block). */
export function hasWrittenExhibitD(html) {
  return /\bid\s*=\s*["']exd["']/i.test(html) || /\bclass\s*=\s*["'](?:[^"']*\s)?statement(?:\s[^"']*)?["']/i.test(html);
}

/**
 * Merge the queue into the draft.
 * acr: { client, queue } as clientAcr returns it. meta: { builtAt, builtBy, day(date) -> text, decisions, conformance }.
 * Returns { html, version, placed: { remediation, conformance, approvals, statement }, applied: [keys] }.
 */
export function mergeAcr(draftHtml, acr, meta) {
  const day = meta.day;
  let html = String(draftHtml);
  const queue = acr.queue;
  const oldVersionText = draftVersionText(html);
  const oldDateText = draftDateText(html);
  const version = nextVersion(draftVersion(html), /\bdraft\b/i.test(oldVersionText));
  const builtDay = day(meta.builtAt);

  const fieldsFor = (w) => {
    // "Approved as is" already says it was approved; "Human-written" needs the decision in front.
    const label = meta.decisions[w.decision] ?? w.decision;
    const answer = w.choice ? (/approv|change|declin|rather not/i.test(w.choice) ? w.choice : `${label}: ${w.choice}`) : label;
    const conformance = w.conformance ? meta.conformance[w.conformance] : '';
    const note = clientNote(w);
    const details = [
      `Client answer: ${answer}${w.signerName ? ` (${w.signerName}, ${day(w.decidedAt)})` : ''}.`,
      note ? `Client comment: ${note}.` : '',
      w.criterion || conformance ? `Conformance: ${w.criterion || 'criterion not given'}${conformance ? `, ${conformance}` : ''}.` : '',
      `Done and live ${day(w.doneAt)}${w.doneByName ? `, marked by ${w.doneByName}` : ''}.`,
      w.note ? `Note: ${w.note}.` : '',
    ].filter(Boolean).join(' ').replace(/\.\./g, '.');
    const live = w.doneAt ? new Date(w.doneAt) : null;
    return {
      dateShort: live ? live.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '',
      date: day(w.doneAt), title: w.title, answer, signer: w.signerName, approvedOn: day(w.decidedAt),
      comment: w.comment, criterion: w.criterion, conformance, note: w.note, report: w.reportTitle,
      details, version, builtBy: meta.builtBy,
    };
  };

  const rows = queue.map(fieldsFor);
  const unplaced = [];
  let placedLog;
  let placedApprovals;
  let placedConformance;
  [html, placedLog] = addRows(html, 'remediation-log', rows);
  [html, placedApprovals] = addRows(html, 'approvals', rows);
  const confRows = queue.map((w, i) => [w, rows[i]]).filter(([w]) => w.criterion || w.conformance).map(([, f]) => f);
  [html, placedConformance] = addRows(html, 'conformance', confRows);
  if (!placedLog && !placedApprovals) unplaced.push(...rows);

  // The approved statement replaces the proposed wording in Exhibit D.
  const st = queue.find((w) => w.statement && !w.statement.missing && !w.statement.asProposed);
  // A record that writes Exhibit D out in full (the house template does) already carries the
  // approved wording, so the statement is never reprinted from the approval report.
  let placedStatement = !st || (!findAll(html, marker('statement')).length && hasWrittenExhibitD(html));
  if (st) {
    html = each(html, marker('statement'), (el, doc) => {
      placedStatement = true;
      return doc.slice(el.start, el.innerStart) + statementHtml(st.statement.blocks) + doc.slice(el.innerEnd, el.end);
    }, { all: false });
    html = each(html, marker('statement-status'), (el, doc) =>
      doc.slice(el.start, el.innerStart) + esc(`Approved by ${st.signerName || 'the client'} on ${day(st.decidedAt)}.`) + doc.slice(el.innerEnd, el.end));
  }

  // Conditional text keyed to approval items.
  const keys = new Map(queue.map((w) => [w.key, w]));
  // "KEY" means the item is applied; "KEY~text" also needs its answer to contain the text.
  const applies = (spec) => {
    const [key, want] = decodeEntities(spec).split('~');
    const w = keys.get(key.trim());
    if (!w) return false;
    if (!want) return true;
    return `${w.choice ?? ''} ${w.decision ?? ''}`.toLowerCase().includes(want.trim().toLowerCase());
  };
  html = each(html, keyAttr('data-acr-until'), (el, doc) => (applies(keyAttr('data-acr-until').exec(el.attrs)[1]) ? '' : null));
  html = each(html, keyAttr('data-acr-when'), (el, doc) => {
    if (!applies(keyAttr('data-acr-when').exec(el.attrs)[1])) return null;
    const open = doc.slice(el.start, el.innerStart).replace(/\s+hidden(?:\s*=\s*(?:""|''|"hidden"|'hidden'))?(?=[\s/>])/i, '');
    return open + doc.slice(el.innerStart, el.end);
  });
  const answerText = (w) => {
    const note = clientNote(w);
    return (w.choice || meta.decisions[w.decision] || w.decision) + (note ? ` (${note})` : '');
  };
  const token = (w, name) => {
    if (!w) return null;
    switch (name) {
      case '@choice': return w.choice || meta.decisions[w.decision] || w.decision;
      case '@answer': return answerText(w);
      case '@comment': return clientNote(w);
      case '@signer': return w.signerName;
      case '@date': return day(w.decidedAt);
      case '@live': return day(w.doneAt);
      default: return fieldValue(w, name);
    }
  };
  html = each(html, keyAttr('data-acr-fill'), (el, doc) => {
    const key = keyAttr('data-acr-fill').exec(el.attrs)[1];
    const w = keys.get(key);
    if (!w) return null;
    const format = /\bdata-acr-format\s*=\s*"([^"]*)"/i.exec(el.attrs)?.[1] ?? /\bdata-acr-format\s*=\s*'([^']*)'/i.exec(el.attrs)?.[1];
    let value;
    if (format != null) {
      let complete = true;
      value = decodeEntities(format).replace(/\{\{\s*(?:([a-z][\w-]*):)?([^}]+?)\s*\}\}/gi, (_, other, name) => {
        const v = token(other ? keys.get(other) : w, name.trim());
        if (!v) complete = false;
        return v ?? '';
      });
      // Leave the placeholder in place when a needed answer is missing, rather than print a half-filled line.
      if (!complete) return null;
    } else {
      value = w.choice || w.comment;
    }
    return value ? doc.slice(el.start, el.innerStart) + esc(value) + doc.slice(el.innerEnd, el.end) : null;
  });

  // Prep fill-ins (<span class="fill">) are only highlighted while the draft is prepared; the built ACR shows plain text.
  html = each(html, /\bclass\s*=\s*["']fill["']/i, (el, doc) => (el.tag === 'span' ? doc.slice(el.innerStart, el.innerEnd) : null));

  // Draft placeholders still standing are cleared: the built ACR carries no [bracketed] draft markings.
  html = each(html, /\bdata-acr-placeholder\b/i, (el, doc) => {
    const given = /\bdata-acr-placeholder\s*=\s*"([^"]*)"/i.exec(el.attrs)?.[1] ?? /\bdata-acr-placeholder\s*=\s*'([^']*)'/i.exec(el.attrs)?.[1] ?? '';
    const text = given ? decodeEntities(given) : decodeEntities(plainText(doc.slice(el.innerStart, el.innerEnd))).replace(/^\[\s*|\s*\]$/g, '');
    return esc(text);
  });

  // Version, date and history.
  html = each(html, marker('version'), (el, doc) => {
    const text = plainText(doc.slice(el.innerStart, el.innerEnd));
    const next = /\d+\.\d+/.test(text) ? text.replace(/\d+\.\d+/, version).replace(/\s*\bdraft\b/i, '') : `Version ${version}`;
    return doc.slice(el.start, el.innerStart) + esc(next) + doc.slice(el.innerEnd, el.end);
  });
  html = each(html, marker('date'), (el, doc) => doc.slice(el.start, el.innerStart) + esc(builtDay) + doc.slice(el.innerEnd, el.end));
  // Page headers and footers written as CSS (@page margin boxes) carry the version and date too.
  const newVersionText = /\d+\.\d+/.test(oldVersionText) ? oldVersionText.replace(/\d+\.\d+/, version).replace(/\s*\bdraft\b/i, '') : '';
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => block.replace(/@page\b[^{]*\{(?:"[^"]*"|'[^']*'|[^{}"']|\{(?:"[^"]*"|'[^']*'|[^{}"'])*\})*\}/g, (rule) => {
    let r = rule;
    if (oldVersionText && newVersionText) r = r.split(oldVersionText).join(newVersionText);
    if (oldDateText) r = r.split(oldDateText).join(builtDay);
    return r;
  }));
  const issued = /\bdraft\b/i.test(oldVersionText);
  const historyRow = {
    date: builtDay, title: issued ? `Record issued as version ${version}` : `Record updated to version ${version}`, version, builtBy: meta.builtBy,
    details: `Updated with ${queue.length} approved ${queue.length === 1 ? 'change' : 'changes'}: ${queue.map((w) => w.title).join('; ')}.`,
  };
  [html] = addRows(html, 'history', [historyRow]);

  // Anything with no marked place goes in an Updates section, so nothing approved is lost.
  if (unplaced.length || !placedStatement) {
    const section = `<section class="acr-updates" data-acr-added="${esc(version)}">
<h2>Updates in version ${esc(version)}</h2>
<p>Added ${esc(builtDay)} by ${esc(meta.builtBy)}. Each change below was approved by the client and is live on the site.</p>
${unplaced.map((f) => `<h3>${esc(f.title)}</h3><p>${esc(f.details)}</p>`).join('\n')}
${placedStatement ? '' : `<h3>Approved accessibility statement</h3><p>${esc(`Approved by ${st.signerName || 'the client'} on ${day(st.decidedAt)}.`)}</p>\n${statementHtml(st.statement.blocks)}`}
</section>\n`;
    const appendix = findAll(html, marker('appendix'))[0];
    if (appendix) html = html.slice(0, appendix.start) + section + html.slice(appendix.start);
    else if (/<\/main>/i.test(html)) html = html.replace(/<\/main>(?![\s\S]*<\/main>)/i, `${section}</main>`);
    else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${section}</body>`);
    else html += section;
  }

  return {
    html, version,
    placed: { remediation: placedLog, approvals: placedApprovals, conformance: placedConformance || !confRows.length, statement: placedStatement },
  };
}

/**
 * Problems worth a warning when a draft is uploaded: prep fill-ins ([[like this]]) still in it,
 * or no merge markers at all (Build would then put every change in an Updates section).
 */
export function draftWarnings(html) {
  const text = String(html ?? '');
  const warnings = [];
  const body = text.replace(/<(style|script|template)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const left = [...new Set([...body.matchAll(/\[\[([^\]]{1,80})\]\]/g)].map((m) => m[1]))];
  if (left.length) warnings.push(`${left.length} fill-in${left.length === 1 ? '' : 's'} still to complete, such as [[${left.slice(0, 3).join(']], [[')}]].`);
  if (!/\bdata-acr\s*=/.test(text)) warnings.push('No merge markers found. Build will add approved changes in an Updates section instead of in place.');
  return warnings;
}

/**
 * The approval answer keys a draft refers to: data-acr-fill="KEY", data-acr-when / data-acr-until
 * ("KEY" or "KEY~text"), and {{KEY:@token}} references inside a data-acr-format. Each key maps to
 * the number of places that use it.
 */
export function draftKeys(html) {
  const text = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const keys = new Map();
  const add = (k) => { const key = decodeEntities(String(k)).split('~')[0].trim(); if (key) keys.set(key, (keys.get(key) ?? 0) + 1); };
  for (const m of text.matchAll(/\bdata-acr-(?:fill|when|until)\s*=\s*"([^"]*)"/gi)) add(m[1]);
  for (const m of text.matchAll(/\bdata-acr-(?:fill|when|until)\s*=\s*'([^']*)'/gi)) add(m[1]);
  for (const m of text.matchAll(/\bdata-acr-format\s*=\s*"([^"]*)"/gi)) {
    for (const t of decodeEntities(m[1]).matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*:\s*@/g)) add(t[1]);
  }
  return keys;
}

/** Header and footer templates the draft supplies for the PDF, or null. */
export function pdfTemplates(html) {
  const get = (name) => new RegExp(`<template\\b[^>]*\\bdata-acr-pdf-${name}\\b[^>]*>([\\s\\S]*?)</template>`, 'i').exec(html)?.[1]?.trim() ?? null;
  return { header: get('header'), footer: get('footer') };
}
