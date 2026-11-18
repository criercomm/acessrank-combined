/**
 * VPAT builder: turns a client's Accessibility Evidence File and their human testing results into
 * an Accessibility Conformance Report on ITI's VPAT® 2.5Rev form, WCAG edition.
 *
 *   1. Start a draft. Every WCAG 2.2 Level A and AA criterion gets a row. Passages in the latest
 *      Evidence File (and changes queued for it) that name a criterion are copied into that row
 *      as starting evidence. They suggest; they never answer.
 *   2. Import the testing vendor's results sheet (.xlsx or .csv, the Accessrank template). Each
 *      row they filled in becomes that criterion's answer, with their remarks and evidence.
 *   3. The team reviews and edits in the portal. An edit by the team counts as a human answer.
 *   4. Issue. Allowed only when every A and AA row has a level that a person gave (ITI allows
 *      "Not Evaluated" only for Level AAA), the gaps are explained, and the report says who
 *      tested, when and how. The PDF and its HTML go to the client's Compliance files and the
 *      PDF becomes their VPAT.
 *
 * Team only. Nothing a client login can call reads a draft.
 */
import crypto from 'node:crypto';
import { isUuid } from './store.js';
import { PortalError, clientAcr, getAcrDraft, addFile, setClientServices, clientServices } from './portal.js';
import { readXlsx, readCsv, excelDate, XlsxError } from './xlsx-read.js';

/** Text a person typed: control characters and angle brackets removed, line breaks kept (at most one blank line), trimmed, capped. */
function cleanText(raw, max = 200) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/* ------------------------------------------------------------- criteria --- */

/** WCAG 2.2 Level A and AA, in ITI's order (Table 1 then Table 2). since = the WCAG version that added it. */
export const CRITERIA = [
  ['1.1.1', 'Non-text Content', 'A', '2.0'],
  ['1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A', '2.0'],
  ['1.2.2', 'Captions (Prerecorded)', 'A', '2.0'],
  ['1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A', '2.0'],
  ['1.3.1', 'Info and Relationships', 'A', '2.0'],
  ['1.3.2', 'Meaningful Sequence', 'A', '2.0'],
  ['1.3.3', 'Sensory Characteristics', 'A', '2.0'],
  ['1.4.1', 'Use of Color', 'A', '2.0'],
  ['1.4.2', 'Audio Control', 'A', '2.0'],
  ['2.1.1', 'Keyboard', 'A', '2.0'],
  ['2.1.2', 'No Keyboard Trap', 'A', '2.0'],
  ['2.1.4', 'Character Key Shortcuts', 'A', '2.1'],
  ['2.2.1', 'Timing Adjustable', 'A', '2.0'],
  ['2.2.2', 'Pause, Stop, Hide', 'A', '2.0'],
  ['2.3.1', 'Three Flashes or Below Threshold', 'A', '2.0'],
  ['2.4.1', 'Bypass Blocks', 'A', '2.0'],
  ['2.4.2', 'Page Titled', 'A', '2.0'],
  ['2.4.3', 'Focus Order', 'A', '2.0'],
  ['2.4.4', 'Link Purpose (In Context)', 'A', '2.0'],
  ['2.5.1', 'Pointer Gestures', 'A', '2.1'],
  ['2.5.2', 'Pointer Cancellation', 'A', '2.1'],
  ['2.5.3', 'Label in Name', 'A', '2.1'],
  ['2.5.4', 'Motion Actuation', 'A', '2.1'],
  ['3.1.1', 'Language of Page', 'A', '2.0'],
  ['3.2.1', 'On Focus', 'A', '2.0'],
  ['3.2.2', 'On Input', 'A', '2.0'],
  ['3.2.6', 'Consistent Help', 'A', '2.2'],
  ['3.3.1', 'Error Identification', 'A', '2.0'],
  ['3.3.2', 'Labels or Instructions', 'A', '2.0'],
  ['3.3.7', 'Redundant Entry', 'A', '2.2'],
  ['4.1.2', 'Name, Role, Value', 'A', '2.0'],
  ['1.2.4', 'Captions (Live)', 'AA', '2.0'],
  ['1.2.5', 'Audio Description (Prerecorded)', 'AA', '2.0'],
  ['1.3.4', 'Orientation', 'AA', '2.1'],
  ['1.3.5', 'Identify Input Purpose', 'AA', '2.1'],
  ['1.4.3', 'Contrast (Minimum)', 'AA', '2.0'],
  ['1.4.4', 'Resize Text', 'AA', '2.0'],
  ['1.4.5', 'Images of Text', 'AA', '2.0'],
  ['1.4.10', 'Reflow', 'AA', '2.1'],
  ['1.4.11', 'Non-text Contrast', 'AA', '2.1'],
  ['1.4.12', 'Text Spacing', 'AA', '2.1'],
  ['1.4.13', 'Content on Hover or Focus', 'AA', '2.1'],
  ['2.4.5', 'Multiple Ways', 'AA', '2.0'],
  ['2.4.6', 'Headings and Labels', 'AA', '2.0'],
  ['2.4.7', 'Focus Visible', 'AA', '2.0'],
  ['2.4.11', 'Focus Not Obscured (Minimum)', 'AA', '2.2'],
  ['2.5.7', 'Dragging Movements', 'AA', '2.2'],
  ['2.5.8', 'Target Size (Minimum)', 'AA', '2.2'],
  ['3.1.2', 'Language of Parts', 'AA', '2.0'],
  ['3.2.3', 'Consistent Navigation', 'AA', '2.0'],
  ['3.2.4', 'Consistent Identification', 'AA', '2.0'],
  ['3.3.3', 'Error Suggestion', 'AA', '2.0'],
  ['3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA', '2.0'],
  ['3.3.8', 'Accessible Authentication (Minimum)', 'AA', '2.2'],
  ['4.1.3', 'Status Messages', 'AA', '2.1'],
].map(([id, name, level, since]) => ({ id, name, level, since }));

const BY_ID = new Map(CRITERIA.map((c) => [c.id, c]));

/** The 15 criteria the vendor brief says Accessrank pre-fills from scans and the fix log. */
export const SCAN_CHECKABLE = new Set(['1.1.1', '1.3.1', '1.3.5', '1.4.1', '1.4.3', '1.4.4', '1.4.12', '2.1.1', '2.4.1', '2.4.2', '2.4.4', '2.5.8', '3.1.1', '3.1.2', '4.1.2']);

/** ITI's conformance terms. Not Evaluated exists only for Level AAA, which this report does not include. */
export const LEVELS = {
  supports: 'Supports',
  partially_supports: 'Partially Supports',
  does_not_support: 'Does Not Support',
  not_applicable: 'Not Applicable',
};

const SOURCES = new Set(['evidence', 'vendor', 'team']);

/** "partially supports", "Partially Supports", "partially_supports" -> partially_supports; '' when unknown. */
export function normalizeLevel(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!s) return '';
  if (s === 'supports' || s === 'supported' || s === 'pass' || s === 'yes') return 'supports';
  if (s.startsWith('partially')) return 'partially_supports';
  if (s.startsWith('does not') || s === 'fail' || s === 'not supported') return 'does_not_support';
  if (s === 'not applicable' || s === 'n/a' || s === 'na') return 'not_applicable';
  if (s.startsWith('not evaluated')) return 'not_evaluated';
  return '?';
}

/* --------------------------------------------------- Evidence File input --- */

const plain = (html) => html
  .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, '’').replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const ID_RE = /(?<![\d.])(\d\.\d{1,2}\.\d{1,2})(?![\d.]*\d)/g;

/**
 * Passages of an Evidence File (HTML) that name a WCAG 2.2 A or AA criterion: table rows and
 * list items, each with the heading of the section it sits in. Draft placeholders ([[...]] or
 * marked .fill / data-acr-placeholder) are skipped, so an unfilled template contributes nothing.
 */
export function evidencePassages(html) {
  const src = String(html ?? '').replace(/<template\b[\s\S]*?<\/template>/gi, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const out = new Map();
  const headingAt = [];
  for (const m of src.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) headingAt.push({ at: m.index, text: plain(m[2]) });
  const sectionAt = (at) => {
    let h = '';
    for (const x of headingAt) { if (x.at > at) break; h = x.text; }
    return h;
  };
  for (const m of src.matchAll(/<(tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (/data-acr-placeholder|class="fill"|\[\[/.test(m[2])) continue;
    const text = plain(m[2].replace(/<\/t[dh]>/gi, ' · ')).replace(/(\s·\s*)+$/, '').replace(/^(\s*·\s)+/, '');
    if (!text) continue;
    const ids = new Set([...text.matchAll(ID_RE)].map((x) => x[1]).filter((id) => BY_ID.has(id)));
    for (const id of ids) {
      const list = out.get(id) ?? out.set(id, []).get(id);
      const line = { section: sectionAt(m.index), text: text.length > 400 ? `${text.slice(0, 397)}…` : text };
      if (!list.some((l) => l.text === line.text)) list.push(line);
    }
  }
  return out;
}

/** Starting evidence for every criterion: Evidence File passages plus queued changes that name one. */
async function prefillFor(store, clientId) {
  const acr = await clientAcr(store, clientId);
  const latest = acr.drafts.find((d) => d.mergeable) ?? null;
  let passages = new Map();
  if (latest) {
    const row = await getAcrDraft(store, latest.id);
    passages = evidencePassages(Buffer.from(row.data).toString('utf8'));
  }
  for (const w of acr.queue) {
    const ids = [...String(w.criterion ?? '').matchAll(ID_RE)].map((x) => x[1]).filter((id) => BY_ID.has(id));
    for (const id of ids) {
      const list = passages.get(id) ?? passages.set(id, []).get(id);
      list.push({ section: 'Queued for the next Evidence File update', text: `${w.title}${w.note ? `: ${w.note}` : ''}${w.conformance ? ` (${w.conformance.replace(/_/g, ' ')})` : ''}` });
    }
  }
  return { client: acr.client, source: latest ? { draftId: latest.id, name: latest.name, createdAt: latest.createdAt } : null, passages };
}

/* ----------------------------------------------------------------- storage --- */

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const COLS = 'id, created_at, updated_at, client_id, status, data, created_by_name, created_by_email, updated_by_name, issued_at, issued_by_name, issued_file_id';

function pgRepo(store) {
  const q = (text, params) => store.query(text, params);
  return {
    async list(clientId) {
      return (await q(`SELECT ${COLS} FROM portal_vpats WHERE client_id = $1 ORDER BY created_at DESC LIMIT 50`, [clientId])).rows;
    },
    async insert({ clientId, data, byName, byEmail }) {
      return (await q(
        `INSERT INTO portal_vpats (client_id, data, created_by_name, created_by_email, updated_by_name)
         VALUES ($1, $2::jsonb, $3, $4, $3) RETURNING ${COLS}`,
        [clientId, JSON.stringify(data), byName, byEmail],
      )).rows[0];
    },
    async save(id, data, byName) {
      return (await q(`UPDATE portal_vpats SET data = $2::jsonb, updated_at = now(), updated_by_name = $3 WHERE id = $1 AND status = 'draft' RETURNING ${COLS}`,
        [id, JSON.stringify(data), byName])).rows[0] ?? null;
    },
    async issue(id, { data, byName, fileId }) {
      return (await q(
        `UPDATE portal_vpats SET status = 'issued', data = $2::jsonb, updated_at = now(), issued_at = now(), issued_by_name = $3, issued_file_id = $4
          WHERE id = $1 AND status = 'draft' RETURNING ${COLS}`,
        [id, JSON.stringify(data), byName, fileId],
      )).rows[0] ?? null;
    },
    async remove(id) {
      return (await q("DELETE FROM portal_vpats WHERE id = $1 AND status = 'draft'", [id])).rowCount > 0;
    },
  };
}

function memRepo(store) {
  store._vpats ??= new Map();
  const db = store._vpats;
  let last = 0;
  const now = () => new Date(last = Math.max(Date.now(), last + 1)).toISOString();
  const alive = (row) => !store._portal || !store._portal.clients || store._portal.clients.has(row.client_id);
  const copy = (row) => (row ? JSON.parse(JSON.stringify(row)) : null);
  return {
    async list(clientId) {
      return [...db.values()].filter((r) => r.client_id === clientId && alive(r))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(copy);
    },
    async insert({ clientId, data, byName, byEmail }) {
      if ([...db.values()].some((r) => r.client_id === clientId && r.status === 'draft' && alive(r))) {
        throw Object.assign(new Error('duplicate draft'), { code: '23505' });
      }
      const at = now();
      const row = {
        id: crypto.randomUUID(), created_at: at, updated_at: at, client_id: clientId, status: 'draft', data,
        created_by_name: byName, created_by_email: byEmail, updated_by_name: byName, issued_at: null, issued_by_name: '', issued_file_id: null,
      };
      db.set(row.id, row);
      return copy(row);
    },
    async save(id, data, byName) {
      const row = db.get(id);
      if (!row || row.status !== 'draft') return null;
      Object.assign(row, { data: JSON.parse(JSON.stringify(data)), updated_at: now(), updated_by_name: byName });
      return copy(row);
    },
    async issue(id, { data, byName, fileId }) {
      const row = db.get(id);
      if (!row || row.status !== 'draft') return null;
      const at = now();
      Object.assign(row, { status: 'issued', data: JSON.parse(JSON.stringify(data)), updated_at: at, issued_at: at, issued_by_name: byName, issued_file_id: fileId });
      return copy(row);
    },
    async remove(id) {
      const row = db.get(id);
      if (!row || row.status !== 'draft') return false;
      db.delete(id);
      return true;
    },
  };
}

const repos = new WeakMap();
function repoFor(store) {
  if (!repos.has(store)) repos.set(store, store.kind === 'memory' ? memRepo(store) : pgRepo(store));
  return repos.get(store);
}

/* ---------------------------------------------------------------- shapes --- */

/** Report details the team fills in. Each is plain text. */
export const META_FIELDS = {
  productName: { label: 'Name of product', max: 200 },
  productVersion: { label: 'Version', max: 200 },
  productUrl: { label: 'Website', max: 300 },
  description: { label: 'Product description', max: 2000 },
  contact: { label: 'Contact information', max: 600 },
  notes: { label: 'Notes', max: 4000 },
  evaluationMethods: { label: 'Evaluation methods used', max: 4000 },
  testers: { label: 'Tested by', max: 400 },
  testDates: { label: 'Test dates', max: 200 },
  signedBy: { label: 'Tester sign-off', max: 200 },
  signedOn: { label: 'Signed on', max: 40 },
};

const emptyRow = () => ({ level: '', remarks: '', source: '', evidence: '', flow: '', testedWith: '', tester: '', testedOn: '', prefill: [] });

function freshData(client, pre) {
  const rows = {};
  for (const c of CRITERIA) rows[c.id] = { ...emptyRow(), prefill: pre.passages.get(c.id) ?? [] };
  return {
    meta: {
      productName: `${client.name} website`,
      productVersion: '',
      productUrl: '',
      description: '',
      contact: '',
      notes: '',
      evaluationMethods: '',
      testers: '',
      testDates: '',
      signedBy: '',
      signedOn: '',
    },
    rows,
    evidenceSource: pre.source,
    imports: [],
  };
}

/** What the portal is sent: the draft as stored, plus the criterion list and what still blocks issuing. */
function vpatOut(row, client, humanTesting) {
  if (!row) return null;
  const data = row.data;
  return {
    id: row.id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdByName: row.created_by_name || '',
    updatedByName: row.updated_by_name || '',
    issuedAt: iso(row.issued_at),
    issuedByName: row.issued_by_name || '',
    issuedFileId: row.issued_file_id ?? null,
    meta: data.meta,
    rows: data.rows,
    evidenceSource: data.evidenceSource ?? null,
    imports: data.imports ?? [],
    readiness: row.status === 'draft' ? readiness(data, { humanTesting }) : null,
    clientName: client?.name ?? '',
  };
}

/* ------------------------------------------------------------- readiness --- */

/**
 * What still stands between this draft and an issued VPAT. Every item names what to do.
 * ITI allows "Not Evaluated" only for Level AAA, so every A and AA row needs a level that a
 * person gave; a passage from the Evidence File alone is not an answer.
 */
export function readiness(data, { humanTesting }) {
  const blockers = [];
  const counts = { supports: 0, partially_supports: 0, does_not_support: 0, not_applicable: 0, open: 0, prefillOnly: 0 };
  if (!humanTesting) blockers.push({ text: 'Human testing is not switched on for this client. Turn it on in their Files tab first.' });
  const m = data.meta;
  for (const [key, label] of [['productName', 'name of the product'], ['description', 'product description'], ['contact', 'contact information'], ['evaluationMethods', 'evaluation methods'], ['testers', 'names of the testers'], ['testDates', 'test dates']]) {
    if (!String(m[key] ?? '').trim()) blockers.push({ field: key, text: `Add the ${label}.` });
  }
  if (!String(m.signedBy ?? '').trim()) blockers.push({ field: 'signedBy', text: 'Add the tester’s sign-off (from the Setup tab of their sheet).' });
  for (const c of CRITERIA) {
    const r = data.rows[c.id] ?? emptyRow();
    if (!r.level) {
      counts.open += 1;
      if (r.prefill?.length) counts.prefillOnly += 1;
      continue;
    }
    counts[r.level] += 1;
    if (!SOURCES.has(r.source) || r.source === 'evidence') blockers.push({ criterion: c.id, text: `${c.id} ${c.name}: the level has not been confirmed by human testing.` });
    if (r.level !== 'supports' && !String(r.remarks ?? '').trim()) {
      blockers.push({ criterion: c.id, text: `${c.id} ${c.name}: ${LEVELS[r.level]} needs a remark saying ${r.level === 'not_applicable' ? 'why it does not apply' : 'what fails and where'}.` });
    }
    if ((r.level === 'partially_supports' || r.level === 'does_not_support') && !String(r.evidence ?? '').trim()) {
      blockers.push({ criterion: c.id, text: `${c.id} ${c.name}: add the evidence (screenshot or recording and time) for this result.` });
    }
  }
  if (counts.open) blockers.unshift({ text: `${counts.open} of ${CRITERIA.length} criteria have no level yet${counts.prefillOnly ? ` (${counts.prefillOnly} with Evidence File notes to start from)` : ''}. Import the testing results or fill them in.` });
  return { ready: blockers.length === 0, blockers, counts, total: CRITERIA.length };
}

/* ------------------------------------------------------------- the API --- */

const notFound = () => new PortalError('That client no longer exists.', { code: 'not_found', status: 404 });
const by = (session) => ({ byName: String(session.name ?? session.email ?? '').slice(0, 120), byEmail: String(session.email ?? '').slice(0, 254) });

async function clientOf(store, clientId) {
  if (!isUuid(clientId)) throw notFound();
  try {
    return (await clientAcr(store, clientId)).client;
  } catch (e) {
    if (e.status === 404) throw notFound();
    throw e;
  }
}

/** The open draft (or null) and the issued VPATs, newest first. */
export async function clientVpat(store, clientId) {
  const client = await clientOf(store, clientId);
  const { humanTesting } = await clientServices(store, clientId);
  const rows = await repoFor(store).list(clientId);
  const draft = rows.find((r) => r.status === 'draft') ?? null;
  const issued = rows.filter((r) => r.status === 'issued').map((r) => ({
    id: r.id, issuedAt: iso(r.issued_at), issuedByName: r.issued_by_name || '', issuedFileId: r.issued_file_id ?? null,
    productName: r.data?.meta?.productName ?? '', testDates: r.data?.meta?.testDates ?? '',
  }));
  return { client: { id: client.id, name: client.name, humanTesting }, draft: vpatOut(draft, client, humanTesting), issued, criteria: CRITERIA, levels: LEVELS, scanCheckable: [...SCAN_CHECKABLE] };
}

/**
 * Start a draft from the latest Evidence File. The report details of the last issued VPAT carry
 * over (product, contact, description), so a re-test starts where the last report left off.
 */
export async function startVpat(store, session, clientId) {
  const client = await clientOf(store, clientId);
  const repo = repoFor(store);
  const all = await repo.list(clientId);
  if (all.some((r) => r.status === 'draft')) throw new PortalError('This client already has a VPAT draft. Open it, or discard it first.', { code: 'vpat_draft_exists', status: 409 });
  const pre = await prefillFor(store, clientId);
  const data = freshData(client, pre);
  const last = all.find((r) => r.status === 'issued');
  if (last) for (const k of ['productName', 'productUrl', 'description', 'contact']) data.meta[k] = last.data.meta[k] ?? data.meta[k];
  try {
    await repo.insert({ clientId, data, ...by(session) });
  } catch (e) {
    if (e.code === '23505') throw new PortalError('This client already has a VPAT draft.', { code: 'vpat_draft_exists', status: 409 });
    throw e;
  }
  return clientVpat(store, clientId);
}

async function draftOrThrow(store, clientId) {
  await clientOf(store, clientId);
  const draft = (await repoFor(store).list(clientId)).find((r) => r.status === 'draft');
  if (!draft) throw new PortalError('This client has no VPAT draft. Start one first.', { code: 'vpat_no_draft', status: 404 });
  return draft;
}

/** Re-read the Evidence File into every row's starting notes. Answers already given are left alone. */
export async function refreshPrefill(store, session, clientId) {
  const draft = await draftOrThrow(store, clientId);
  const pre = await prefillFor(store, clientId);
  for (const c of CRITERIA) {
    draft.data.rows[c.id] ??= emptyRow();
    draft.data.rows[c.id].prefill = pre.passages.get(c.id) ?? [];
  }
  draft.data.evidenceSource = pre.source;
  await repoFor(store).save(draft.id, draft.data, by(session).byName);
  return clientVpat(store, clientId);
}

/**
 * Save the team's edits: { meta: {...}, rows: { '1.1.1': { level, remarks, evidence, flow } } }.
 * A row the team changes is marked as answered by the team.
 */
export async function saveVpat(store, session, clientId, input = {}) {
  const draft = await draftOrThrow(store, clientId);
  const data = draft.data;
  for (const [key, { max }] of Object.entries(META_FIELDS)) {
    if (input.meta && key in input.meta) data.meta[key] = cleanText(input.meta[key] ?? '', max);
  }
  const bad = [];
  for (const [id, change] of Object.entries(input.rows ?? {})) {
    if (!BY_ID.has(id) || !change || typeof change !== 'object') continue;
    const row = data.rows[id] ?? (data.rows[id] = emptyRow());
    // Only a change to the level or the remarks makes it the team's answer; an evidence pointer or flow note does not.
    const before = JSON.stringify([row.level, row.remarks]);
    if ('level' in change) {
      const level = change.level === '' ? '' : normalizeLevel(change.level);
      if (level !== '' && !LEVELS[level]) { bad.push(id); continue; }
      row.level = level;
    }
    for (const k of ['remarks', 'evidence', 'flow']) if (k in change) row[k] = cleanText(change[k] ?? '', k === 'remarks' ? 2000 : 400);
    if (JSON.stringify([row.level, row.remarks]) !== before) row.source = row.level || row.remarks ? 'team' : '';
  }
  if (bad.length) {
    throw new PortalError(`Choose Supports, Partially Supports, Does Not Support or Not Applicable for ${bad.join(', ')}. "Not Evaluated" is only allowed for Level AAA.`, { code: 'bad_level', status: 400 });
  }
  await repoFor(store).save(draft.id, data, by(session).byName);
  return clientVpat(store, clientId);
}

/* ------------------------------------------------- vendor results import --- */

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Find the Results table in a workbook's sheets (or CSV rows): the header row has "Criterion" and "Conformance level". */
function findResults(sheets) {
  const ordered = [...sheets].sort((a, b) => (norm(a.name) === 'results' ? -1 : norm(b.name) === 'results' ? 1 : 0));
  for (const sheet of ordered) {
    const hi = sheet.rows.findIndex((r) => r.some((c) => norm(c) === 'criterion') && r.some((c) => norm(c).startsWith('conformance')));
    if (hi < 0) continue;
    const head = sheet.rows[hi].map(norm);
    const col = (test) => head.findIndex(test);
    return {
      rows: sheet.rows.slice(hi + 1),
      at: {
        criterion: col((h) => h === 'criterion'),
        level: col((h) => h.startsWith('conformance')),
        remarks: col((h) => h.startsWith('remarks')),
        flow: col((h) => h.startsWith('flow')),
        evidence: col((h) => h.startsWith('evidence')),
        testedWith: col((h) => h.startsWith('tested with')),
        tester: col((h) => h === 'tester' || h === 'tested by'),
        testedOn: col((h) => h.startsWith('date')),
      },
      firstRow: hi + 2,
    };
  }
  return null;
}

/** The Setup tab: two columns, a label and its value. Returns the values the report uses. */
function findSetup(sheets) {
  const sheet = sheets.find((s) => norm(s.name) === 'setup');
  if (!sheet) return {};
  const get = (test) => {
    const row = sheet.rows.find((r) => test(norm(r[0])));
    return row ? String(row[1] ?? '').trim() : '';
  };
  const devices = [
    ['Computer', get((l) => l.startsWith('computer'))],
    ['Browser', get((l) => l.startsWith('browser'))],
    ['Screen readers on computer', get((l) => l.startsWith('screen reader'))],
    ['Phone', get((l) => l.startsWith('phone'))],
    ['Other tools', get((l) => l.startsWith('other tools'))],
  ].filter(([, v]) => v);
  return {
    testDates: get((l) => l.startsWith('test dates')),
    testers: get((l) => l.startsWith('tester name')),
    // "Evaluation methods" in the first template; "Methods and limitations" since Nov 18.
    evaluationMethods: get((l) => l.startsWith('evaluation methods') || l.startsWith('methods')),
    signedBy: get((l) => l.startsWith('signed by')),
    signedOn: excelDate(get((l) => l.startsWith('date signed'))),
    devices,
  };
}

/**
 * Read a vendor's results sheet and put each answered row into the draft. Rows the vendor left
 * blank keep what the draft had. Returns a summary: how many rows were filled, and any rows that
 * could not be used, with the reason.
 */
export async function importResults(store, session, clientId, { filename, data }) {
  const draft = await draftOrThrow(store, clientId);
  const name = String(filename ?? '').trim() || 'results';
  let sheets;
  try {
    if (/\.csv$/i.test(name)) sheets = [{ name: 'Results', rows: readCsv(data.toString('utf8')) }];
    else if (/\.xlsx$/i.test(name)) sheets = readXlsx(data).sheets;
    else throw new PortalError('Upload the results as an .xlsx workbook or a .csv file.', { code: 'bad_results_type', status: 415 });
  } catch (e) {
    if (e instanceof XlsxError) throw new PortalError(e.message, { code: 'bad_results_file', status: 400 });
    throw e;
  }
  const found = findResults(sheets);
  if (!found) throw new PortalError('No Results table found. The sheet needs a header row with "Criterion" and "Conformance level", as in the Accessrank results template.', { code: 'no_results_table', status: 400 });

  const rows = draft.data.rows;
  const skipped = [];
  let filled = 0;
  const seen = new Set();
  found.rows.forEach((cells, i) => {
    const cell = (k) => (found.at[k] >= 0 ? String(cells[found.at[k]] ?? '').trim() : '');
    const idMatch = cell('criterion').match(/^(\d\.\d{1,2}\.\d{1,2})/);
    if (!idMatch) return;
    const id = idMatch[1];
    const line = found.firstRow + i;
    if (!BY_ID.has(id)) {
      if (id !== '4.1.1') skipped.push({ row: line, criterion: id, reason: 'Not a WCAG 2.2 Level A or AA criterion.' });
      return;
    }
    if (seen.has(id)) { skipped.push({ row: line, criterion: id, reason: 'Listed twice; the first row was used.' }); return; }
    seen.add(id);
    const levelText = cell('level');
    const remarks = cell('remarks');
    if (!levelText && !remarks) return;
    const level = normalizeLevel(levelText);
    if (level === 'not_evaluated') { skipped.push({ row: line, criterion: id, reason: '"Not Evaluated" is only allowed for Level AAA. Ask the tester for a result.' }); return; }
    if (level === '?') { skipped.push({ row: line, criterion: id, reason: `"${levelText}" is not one of the four conformance levels.` }); return; }
    const row = rows[id] ?? (rows[id] = emptyRow());
    // A row with remarks but no level adds the remarks and keeps whatever level the draft had.
    // A column the sheet does not have leaves that field as it was.
    const has = (k) => found.at[k] >= 0;
    if (level) { row.level = level; row.source = 'vendor'; }
    if (has('remarks')) row.remarks = cleanText(remarks, 2000);
    if (has('flow')) row.flow = cleanText(cell('flow'), 400);
    if (has('evidence')) row.evidence = cleanText(cell('evidence'), 400);
    if (has('testedWith')) row.testedWith = cleanText(cell('testedWith'), 400);
    if (has('tester')) row.tester = cleanText(cell('tester'), 200);
    if (has('testedOn')) row.testedOn = excelDate(cell('testedOn')).slice(0, 40);
    filled += 1;
  });

  const setup = findSetup(sheets);
  const meta = draft.data.meta;
  for (const k of ['testDates', 'testers', 'evaluationMethods', 'signedBy', 'signedOn']) if (setup[k]) meta[k] = cleanText(setup[k], META_FIELDS[k].max);
  if (setup.devices?.length && !/Devices and software:/.test(meta.evaluationMethods)) {
    meta.evaluationMethods = cleanText(`${meta.evaluationMethods}${meta.evaluationMethods ? '\n\n' : ''}Devices and software: ${setup.devices.map(([k, v]) => `${k}: ${v}`).join('; ')}.`, META_FIELDS.evaluationMethods.max);
  }
  const summary = { at: new Date().toISOString(), byName: by(session).byName, filename: cleanText(name, 200), filled, skipped };
  draft.data.imports = [summary, ...(draft.data.imports ?? [])].slice(0, 20);
  await repoFor(store).save(draft.id, draft.data, by(session).byName);
  return { summary, vpat: await clientVpat(store, clientId) };
}

/** Throw away the open draft (issued VPATs are kept). */
export async function discardVpat(store, clientId) {
  const draft = await draftOrThrow(store, clientId);
  await repoFor(store).remove(draft.id);
  return clientVpat(store, clientId);
}

/* ---------------------------------------------------------------- report --- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const para = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const longDay = (d) => new Date(d).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/Los_Angeles' });

const VERSION_NOTE = { '2.0': '', '2.1': ' 2.1 and 2.2', '2.2': ' 2.2 only' };

/**
 * The report as a self-contained HTML page (inline CSS, no script, no outside requests),
 * following ITI's VPAT 2.5Rev WCAG edition: product details, evaluation methods, the standards
 * covered, the terms, Table 1 (Level A), Table 2 (Level AA), Table 3 (Level AAA, not included)
 * and the legal disclaimer. draft = true adds a DRAFT banner.
 */
export function renderVpatHtml(data, { clientName, reportDate = new Date(), draft = false }) {
  const m = data.meta;
  const row = (c) => {
    const r = data.rows[c.id] ?? emptyRow();
    const lvl = r.level ? LEVELS[r.level] : '<span class="missing">No result yet</span>';
    return `<tr><th scope="row">${esc(c.id)} ${esc(c.name)} (Level ${c.level}${VERSION_NOTE[c.since]})</th><td>${r.level ? esc(lvl) : lvl}</td><td>${para(r.remarks)}</td></tr>`;
  };
  const parsing = '<tr><th scope="row">4.1.1 Parsing (Level A)</th><td>Supports</td><td><p>WCAG 2.0 and 2.1: for content written in HTML, the W3C errata treat this criterion as always met. WCAG 2.2: obsolete and removed, so it does not apply.</p></td></tr>';
  const table = (level, title, extra = '') => `
<h3 id="t-${level.toLowerCase()}">${title}</h3>
<table><thead><tr><th scope="col">Criteria</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead>
<tbody>${CRITERIA.filter((c) => c.level === level).map(row).join('')}${extra}</tbody></table>`;
  const title = `${esc(clientName)} Accessibility Conformance Report`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: Letter; margin: 0.75in 0.75in 0.85in; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1A1D24; font-size: 10.5pt; line-height: 1.45; margin: 0; padding: 0.5in; }
  @media print { body { padding: 0; } }
  h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 4pt; }
  .sub { font-size: 12pt; margin: 0 0 2pt; }
  .based { margin: 0 0 18pt; color: #444A57; }
  h2 { font-size: 14pt; margin: 22pt 0 8pt; border-bottom: 1px solid #C9CDD6; padding-bottom: 3pt; }
  h3 { font-size: 12pt; margin: 18pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; }
  th, td { border: 1px solid #9AA0AC; padding: 5pt 6pt; vertical-align: top; text-align: left; }
  thead th { background: #EEF0F4; }
  tbody th { font-weight: normal; width: 34%; }
  td:nth-child(2) { width: 17%; white-space: nowrap; }
  td p, dd p { margin: 0 0 4pt; }
  td p:last-child { margin-bottom: 0; }
  dl.info { display: grid; grid-template-columns: 30% 1fr; gap: 4pt 12pt; margin: 0; }
  dl.info dt { font-weight: bold; }
  dl.info dd { margin: 0; }
  .terms li { margin-bottom: 4pt; }
  .missing { color: #B42318; font-weight: bold; }
  .draft { border: 2px solid #B42318; color: #B42318; padding: 6pt 10pt; font-weight: bold; margin-bottom: 14pt; }
  tr { break-inside: avoid; }
  .mark { color: #444A57; font-size: 9pt; margin-top: 18pt; }
</style></head>
<body>
${draft ? '<p class="draft">DRAFT for Accessrank review. Not issued. Do not send.</p>' : ''}
<h1>${title}</h1>
<p class="sub">WCAG Edition</p>
<p class="based">(Based on VPAT<sup>&reg;</sup> Version 2.5Rev)</p>

<dl class="info">
  <dt>Name of Product/Version</dt><dd>${esc(m.productName)}${m.productVersion ? `, ${esc(m.productVersion)}` : ''}${m.productUrl ? ` (${esc(m.productUrl)})` : ''}</dd>
  <dt>Report Date</dt><dd>${esc(longDay(reportDate))}</dd>
  <dt>Product Description</dt><dd>${para(m.description)}</dd>
  <dt>Contact Information</dt><dd>${para(m.contact)}</dd>
  <dt>Notes</dt><dd>${para(m.notes || 'This report covers the website as tested on the dates below. Pages and features not listed under evaluation methods were not tested. Platform-hosted checkout pages and third-party services are covered only where the remarks say so.')}</dd>
  <dt>Evaluation Methods Used</dt><dd>${para(m.evaluationMethods)}${m.testers ? `<p>Tested by: ${esc(m.testers)}${m.testDates ? `, ${esc(m.testDates)}` : ''}.</p>` : ''}<p>Automated testing and Accessrank&rsquo;s remediation records were used as supporting evidence. Every conformance level in this report was confirmed by hands-on testing.</p></dd>
</dl>

<h2>Applicable Standards/Guidelines</h2>
<p>This report covers the degree of conformance for the following accessibility standard/guidelines:</p>
<table><thead><tr><th scope="col">Standard/Guideline</th><th scope="col">Included In Report</th></tr></thead><tbody>
<tr><th scope="row">Web Content Accessibility Guidelines 2.0</th><td>Level A (Yes)<br>Level AA (Yes)<br>Level AAA (No)</td></tr>
<tr><th scope="row">Web Content Accessibility Guidelines 2.1</th><td>Level A (Yes)<br>Level AA (Yes)<br>Level AAA (No)</td></tr>
<tr><th scope="row">Web Content Accessibility Guidelines 2.2</th><td>Level A (Yes)<br>Level AA (Yes)<br>Level AAA (No)</td></tr>
</tbody></table>

<h2>Terms</h2>
<p>The terms used in the Conformance Level information are defined as follows:</p>
<ul class="terms">
  <li><b>Supports:</b> The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation.</li>
  <li><b>Partially Supports:</b> Some functionality of the product does not meet the criterion.</li>
  <li><b>Does Not Support:</b> The majority of product functionality does not meet the criterion.</li>
  <li><b>Not Applicable:</b> The criterion is not relevant to the product.</li>
  <li><b>Not Evaluated:</b> The product has not been evaluated against the criterion. This can only be used in WCAG Level AAA criteria.</li>
</ul>

<h2>WCAG 2.x Report</h2>
<p>Tables 1 and 2 cover WCAG 2.0, 2.1 and 2.2. Criteria added in WCAG 2.1 or 2.2 say so after their level. Level AAA (Table 3) is not included in this report.</p>
${table('A', 'Table 1: Success Criteria, Level A', parsing)}
${table('AA', 'Table 2: Success Criteria, Level AA')}
<h3>Table 3: Success Criteria, Level AAA</h3>
<p>Notes: Not evaluated. Level AAA is not included in this report.</p>

<h2>Legal Disclaimer</h2>
<p>This report describes how the website named above conformed to WCAG on the dates it was tested, as found by the testing described under Evaluation Methods Used. Websites change: content, themes and third-party apps added after testing are not covered. This report is not legal advice and does not guarantee the outcome of any claim. It was prepared by Accessrank, Inc. for ${esc(clientName)}.</p>
<p class="mark">&ldquo;Voluntary Product Accessibility Template&rdquo; and &ldquo;VPAT&rdquo; are registered service marks of the Information Technology Industry Council (ITI).</p>
</body></html>`;
}

/** Footer printed on every PDF page. */
export const vpatFooter = (clientName, dateText) => `<div style="font-size:8px;color:#6A6F7D;width:100%;padding:0 0.75in;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif">
  <span>${esc(clientName)} · Accessibility Conformance Report (VPAT&reg; 2.5Rev, WCAG) · ${esc(dateText)}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/** The draft as a preview page, marked DRAFT. Team only. */
export async function vpatPreview(store, clientId) {
  const draft = await draftOrThrow(store, clientId);
  const client = await clientOf(store, clientId);
  return renderVpatHtml(draft.data, { clientName: client.name, draft: true });
}

/**
 * Issue the draft. render(html, { footer }) prints the PDF (the route passes the Chromium
 * renderer; tests pass a stub). The PDF and the HTML go to the client's Compliance files, the
 * PDF becomes their VPAT, and the draft is closed as issued.
 */
export async function issueVpat(store, session, clientId, { render, now = new Date() }) {
  const draft = await draftOrThrow(store, clientId);
  const client = await clientOf(store, clientId);
  const { humanTesting } = await clientServices(store, clientId);
  const check = readiness(draft.data, { humanTesting });
  if (!check.ready) {
    throw new PortalError(`Not ready to issue: ${check.blockers.length} thing${check.blockers.length === 1 ? '' : 's'} still to do. ${check.blockers[0].text}`, { code: 'vpat_not_ready', status: 409 });
  }
  const html = renderVpatHtml(draft.data, { clientName: client.name, reportDate: now });
  const dateText = longDay(now);
  const pdf = await render(html, { footer: vpatFooter(client.name, dateText), clientName: client.name, dateText });
  const stamp = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }).replace(',', '');
  const base = `${client.name} VPAT Accessibility Conformance Report ${stamp}`;
  const file = await addFile(store, clientId, { filename: `${base}.pdf`, data: pdf, area: 'compliance' });
  const htmlFile = await addFile(store, clientId, { filename: `${base}.html`, data: Buffer.from(html, 'utf8'), area: 'compliance' });
  await setClientServices(store, clientId, { humanTesting: true, vpatFileId: file.id });
  await repoFor(store).issue(draft.id, { data: draft.data, byName: by(session).byName, fileId: file.id });
  return { file, htmlFile, vpat: await clientVpat(store, clientId) };
}

export default { CRITERIA, LEVELS, clientVpat, startVpat, refreshPrefill, saveVpat, importResults, discardVpat, vpatPreview, issueVpat, readiness, renderVpatHtml, evidencePassages };
