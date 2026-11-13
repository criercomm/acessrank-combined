/**
 * The activity log: one running, append-only record per client of what was done and when.
 *
 * Operators, agents and the portal itself all write to it at the moment a thing happens, so the
 * Accessibility Compliance Record can be put together from it instead of from memory. Nothing here
 * edits or deletes a row: a mistake is corrected by a new 'correction' entry that points at the
 * one it corrects.
 */
import crypto from 'node:crypto';
import { cleanText } from './identity.js';
import { isUuid } from './store.js';
import { PortalError, sanitizeFilename, contentTypeFor } from './portal.js';

/** What each kind is called on screen and in exports. */
export const ACTIVITY_KINDS = {
  scan: 'Scan',
  fix: 'Fix',
  publish: 'Theme published',
  verify: 'Re-test',
  manual_test: 'Manual test',
  note: 'Note',
  correction: 'Correction',
  packet: 'Approval packet',
  approval: 'Client approval',
  work: 'Change marked live',
  acr: 'Compliance record',
};
/** Kinds only the portal writes, when the thing itself happens in the portal. */
const PORTAL_KINDS = new Set(['packet', 'approval', 'work', 'acr']);
/** Kinds a person or an agent may add. */
export const WRITABLE_KINDS = Object.keys(ACTIVITY_KINDS).filter((k) => !PORTAL_KINDS.has(k));

const TZ = 'America/Los_Angeles';
const today = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/* ---------------------------------------------------------------- storage --- */

// Lists never select the file's bytes, only what describes it.
const COLS = "id, created_at, client_id, kind, source, agent, to_char(happened_on, 'YYYY-MM-DD') AS happened_on, title, details, data, corrects_id, author_name, author_email, file_name, file_type, file_size, file_added_at, file_added_by";

function pgRepo(store) {
  const q = (text, params) => store.query(text, params);
  return {
    async list(clientId) {
      return (await q(`SELECT ${COLS} FROM portal_activity WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5000`, [clientId])).rows;
    },
    async get(id) {
      return (await q(`SELECT ${COLS} FROM portal_activity WHERE id = $1`, [id])).rows[0] ?? null;
    },
    /** Null when the client no longer exists. */
    async insert(e) {
      return (await q(
        `INSERT INTO portal_activity (client_id, kind, source, agent, happened_on, title, details, data, corrects_id, author_name, author_email)
         SELECT $1::uuid, $2, $3, $4, $5::date, $6, $7, $8::jsonb, $9::uuid, $10, $11
          WHERE EXISTS (SELECT 1 FROM portal_clients WHERE id = $1::uuid)
         RETURNING ${COLS}`,
        [e.clientId, e.kind, e.source, e.agent, e.happenedOn, e.title, e.details, JSON.stringify(e.data), e.correctsId, e.authorName, e.authorEmail],
      )).rows[0] ?? null;
    },
    /** Attach the entry's one file. Null when the entry is gone or already has a file. */
    async attachFile(id, f) {
      return (await q(
        `UPDATE portal_activity SET file_name = $2, file_type = $3, file_size = $4, file_data = $5, file_added_at = now(), file_added_by = $6
          WHERE id = $1 AND file_name IS NULL RETURNING ${COLS}`,
        [id, f.name, f.type, f.data.length, f.data, f.by],
      )).rows[0] ?? null;
    },
    async getFile(id) {
      return (await q('SELECT id, client_id, file_name, file_type, file_data FROM portal_activity WHERE id = $1 AND file_name IS NOT NULL', [id])).rows[0] ?? null;
    },
  };
}

function memRepo(store) {
  store._activity ??= [];
  let last = 0;
  const now = () => new Date(last = Math.max(Date.now(), last + 1)).toISOString();
  const clientExists = (id) => !store._portal || !store._portal.clients || store._portal.clients.has(id);
  return {
    async list(clientId) {
      return store._activity.filter((e) => e.client_id === clientId && clientExists(clientId))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    },
    async get(id) {
      const row = store._activity.find((e) => e.id === id);
      return row && clientExists(row.client_id) ? row : null;
    },
    async insert(e) {
      if (!clientExists(e.clientId)) return null;
      const row = {
        id: crypto.randomUUID(), created_at: now(), client_id: e.clientId, kind: e.kind, source: e.source, agent: e.agent,
        happened_on: e.happenedOn, title: e.title, details: e.details, data: JSON.parse(JSON.stringify(e.data)),
        corrects_id: e.correctsId, author_name: e.authorName, author_email: e.authorEmail,
        file_name: null, file_type: null, file_size: null, file_data: null, file_added_at: null, file_added_by: null,
      };
      store._activity.push(row);
      return row;
    },
    async attachFile(id, f) {
      const row = store._activity.find((e) => e.id === id);
      if (!row || row.file_name || !clientExists(row.client_id)) return null;
      Object.assign(row, { file_name: f.name, file_type: f.type, file_size: f.data.length, file_data: Buffer.from(f.data), file_added_at: now(), file_added_by: f.by });
      return row;
    },
    async getFile(id) {
      const row = store._activity.find((e) => e.id === id);
      return row && row.file_name && clientExists(row.client_id) ? row : null;
    },
  };
}

const repos = new WeakMap();
function repoFor(store) {
  let repo = repos.get(store);
  if (!repo) {
    repo = store.kind === 'postgres' ? pgRepo(store) : memRepo(store);
    repos.set(store, repo);
  }
  return repo;
}

/* ----------------------------------------------------------------- shape --- */

const out = (row) => ({
  id: row.id,
  clientId: row.client_id,
  kind: row.kind,
  kindLabel: ACTIVITY_KINDS[row.kind] || row.kind,
  source: row.source,
  agent: row.agent || '',
  happenedOn: dateOnly(row.happened_on),
  title: row.title,
  details: row.details || '',
  data: row.data && typeof row.data === 'object' ? row.data : {},
  correctsId: row.corrects_id || null,
  authorName: row.author_name || '',
  createdAt: iso(row.created_at),
  file: row.file_name ? { name: row.file_name, size: row.file_size, addedAt: iso(row.file_added_at), addedBy: row.file_added_by || '' } : null,
});

/**
 * The structured part of an entry: flat and small. Text, numbers, true/false and short lists of
 * text only, so what agents send can always be shown and exported as it is.
 */
function cleanData(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PortalError('The entry’s data must be a set of named values.', { code: 'activity_data', field: 'data' });
  }
  const data = {};
  for (const [key, value] of Object.entries(raw).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') data[key] = cleanText(value, 1000);
    else if (typeof value === 'number' && Number.isFinite(value)) data[key] = value;
    else if (typeof value === 'boolean') data[key] = value;
    else if (Array.isArray(value)) data[key] = value.filter((v) => typeof v === 'string' || typeof v === 'number').slice(0, 100).map((v) => cleanText(String(v), 300));
  }
  if (JSON.stringify(data).length > 12000) {
    throw new PortalError('That entry carries too much data. Put the detail in a file and name the file here.', { code: 'activity_data_long', field: 'data' });
  }
  return data;
}

function cleanDay(raw, now) {
  if (raw == null || raw === '') return today(now);
  const day = String(raw);
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) {
    throw new PortalError('Enter the date as YYYY-MM-DD.', { code: 'activity_date', field: 'happenedOn' });
  }
  if (day > today(new Date(now.getTime() + 36 * 3600 * 1000))) {
    throw new PortalError('That date is in the future. Log a thing on the day it happens.', { code: 'activity_date_future', field: 'happenedOn' });
  }
  return day;
}

/* ------------------------------------------------------------------- api --- */

/** A client's log, newest first. */
export async function listActivity(store, clientId) {
  if (!isUuid(clientId)) return [];
  return (await repoFor(store).list(clientId)).map(out);
}

/**
 * Add one entry. The author is the signed-in session, never anything the browser sends. An agent
 * working through an operator's session says so with `source: 'agent'` and its own name.
 */
export async function addActivity(store, session, clientId, input = {}, now = new Date()) {
  const kind = String(input.kind ?? '');
  if (!WRITABLE_KINDS.includes(kind)) {
    throw new PortalError('Choose what kind of entry this is.', { code: 'activity_kind', field: 'kind' });
  }
  const repo = repoFor(store);
  const title = cleanText(input.title, 300);
  if (!title) throw new PortalError('Say what happened, in a line.', { code: 'activity_title', field: 'title' });
  const data = cleanData(input.data);

  // A correction names the entry it corrects. Any other entry may name one too: a fix logged again
  // with the right facts replaces the earlier fix, which stays in the log marked as corrected.
  let correctsId = null;
  if (kind === 'correction' || input.correctsId) {
    const target = isUuid(input.correctsId) ? await repo.get(input.correctsId) : null;
    if (!target || target.client_id !== clientId) {
      throw new PortalError('Choose the entry this corrects.', { code: 'activity_corrects', field: 'correctsId' });
    }
    correctsId = target.id;
  }
  if (kind === 'verify' || kind === 'manual_test') {
    // A re-test or a manual test names the fixes it covers; each must be a fix in this client's own log.
    const ids = Array.isArray(input.data?.fixIds) ? [...new Set(input.data.fixIds.map(String))] : [];
    for (const id of ids) {
      const fix = isUuid(id) ? await repo.get(id) : null;
      if (!fix || fix.client_id !== clientId || fix.kind !== 'fix') {
        throw new PortalError('A test can only name fixes from this client\u2019s log.', { code: 'activity_fix', field: 'data' });
      }
    }
    data.fixIds = ids;
    const results = kind === 'verify' ? ['pass', 'fail', 'manual_pending'] : ['pass', 'fail'];
    const needed = kind === 'verify' || ids.length > 0;
    if (needed && !results.includes(String(data.result ?? ''))) {
      throw new PortalError(kind === 'verify' ? 'A re-test needs a result: pass, fail or manual_pending.' : 'Say whether the test found problems.', { code: 'activity_result', field: 'data' });
    }
    if (!needed && data.result !== undefined && !results.includes(String(data.result))) delete data.result;
  }
  const agentMade = input.source === 'agent';
  const row = await repo.insert({
    clientId, kind,
    source: agentMade ? 'agent' : 'operator',
    agent: agentMade ? cleanText(input.agent, 80) : '',
    happenedOn: cleanDay(input.happenedOn, now),
    title,
    details: cleanText(String(input.details ?? '').replace(/\r\n?/g, '\n'), 4000),
    data, correctsId,
    authorName: String(session.name ?? '').slice(0, 120),
    authorEmail: String(session.email ?? '').slice(0, 254),
  });
  if (!row) throw new PortalError('That client no longer exists.', { code: 'not_found', status: 404 });
  return out(row);
}

/**
 * An entry the portal writes itself, when the event happens in the portal (a packet published, a
 * client's answers saved, an ACR published). Never throws: the log must not break the action.
 */
export async function recordActivity(store, clientId, { kind, title, details = '', data = {}, by = {} }, now = new Date()) {
  try {
    if (!PORTAL_KINDS.has(kind) || !isUuid(clientId)) return null;
    const row = await repoFor(store).insert({
      clientId, kind, source: 'portal', agent: '', happenedOn: today(now),
      title: cleanText(title, 300) || ACTIVITY_KINDS[kind],
      details: cleanText(details, 4000), data: cleanData(data), correctsId: null,
      authorName: String(by.name ?? '').slice(0, 120), authorEmail: String(by.email ?? '').slice(0, 254),
    });
    return row ? out(row) : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- exports --- */

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // never let a spreadsheet run a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The whole log as a spreadsheet, oldest first, for the client's files or an exhibit. */
export function activityCsv(entries) {
  const head = ['Date', 'Kind', 'What happened', 'Details', 'Logged by', 'Source', 'Logged at (UTC)', 'Corrects entry', 'Evidence file', 'Data', 'Entry id'];
  const rows = [...entries].reverse().map((e) => [
    e.happenedOn, e.kindLabel, e.title, e.details,
    e.source === 'agent' ? `${e.agent || 'Agent'} (for ${e.authorName})` : e.authorName,
    e.source, e.createdAt, e.correctsId || '', e.file ? e.file.name : '',
    Object.keys(e.data).length ? JSON.stringify(e.data) : '', e.id,
  ]);
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** What each state of a fix is called on screen. */
export const FIX_STATES = {
  not_live: 'Built, not yet live',
  awaiting_retest: 'Live, awaiting re-test',
  manual_pending: 'Awaiting a manual check',
  failed: 'Test did not pass',
  passed: 'Passed',
  flagged: 'Corrected: check before issuing',
};

/**
 * Where each fix stands, worked out from the entries around it and never typed:
 *
 *   no theme publish on or after the fix's date        -> not_live
 *   published, no test naming it                        -> awaiting_retest
 *   the latest test naming it says pass                 -> passed
 *   ... says manual_pending                             -> manual_pending
 *   ... says fail                                       -> failed
 *   a plain correction points at the fix                -> flagged (a person must read it)
 *
 * A fix that another fix corrects is replaced by it and is left out. Corrected publishes and
 * tests are ignored. Returns a Map of fix id -> { state, live, test, correction }.
 */
export function fixStates(entries) {
  const oldestFirst = [...entries].reverse();
  const correctedBy = new Map();
  for (const e of oldestFirst) if (e.correctsId) correctedBy.set(e.correctsId, e);
  const stands = (e) => !correctedBy.has(e.id);
  const publishes = oldestFirst.filter((e) => e.kind === 'publish' && stands(e));
  const tests = oldestFirst.filter((e) => (e.kind === 'verify' || e.kind === 'manual_test') && stands(e));
  const states = new Map();
  for (const fix of oldestFirst) {
    if (fix.kind !== 'fix') continue;
    const correction = correctedBy.get(fix.id) || null;
    if (correction && correction.kind !== 'correction') continue;          // replaced by a newer entry
    const live = publishes.find((p) => p.happenedOn >= fix.happenedOn) || null;
    const test = [...tests].reverse().find((t) => (t.data.fixIds || []).includes(fix.id)) || null;
    let state;
    if (correction) state = 'flagged';
    else if (!live) state = 'not_live';
    else if (!test) state = 'awaiting_retest';
    else state = { pass: 'passed', manual_pending: 'manual_pending' }[test.data.result] || 'failed';
    states.set(fix.id, { state, live, test, correction });
  }
  return states;
}

/** The log with each standing fix's state attached, and the counts an operator needs at a glance. */
export function withStates(entries) {
  const states = fixStates(entries);
  const counts = { fixes: states.size, not_live: 0, awaiting_retest: 0, manual_pending: 0, failed: 0, passed: 0, flagged: 0 };
  for (const { state } of states.values()) counts[state] += 1;
  const corrected = new Set(entries.filter((e) => e.correctsId).map((e) => e.correctsId));
  const newest = (kind) => entries.find((e) => e.kind === kind && !corrected.has(e.id)) || null;
  const lastPublish = newest('publish');
  const lastScan = newest('scan');
  return {
    entries: entries.map((e) => {
      const st = states.get(e.id);
      return st ? { ...e, state: st.state, stateLabel: FIX_STATES[st.state] + (st.state === 'passed' ? ` ${st.test.happenedOn}` : '') } : e;
    }),
    summary: {
      ...counts,
      liveTheme: lastPublish ? { name: String(lastPublish.data.theme || lastPublish.title), on: lastPublish.happenedOn } : null,
      lastScan: lastScan ? { title: lastScan.title, on: lastScan.happenedOn } : null,
    },
  };
}

/**
 * The remediation log in the shape the ACR kit reads (rows.json): one six-field row per standing
 * fix, newest first: [date, finding, wcag, how_fixed, evidence, pages]. The evidence field carries
 * the fix's state in the kit's own words, so the kit prints the status from it.
 */
export function kitRows(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = [];
  for (const [id, { state, live, test, correction }] of fixStates(entries)) {
    const fix = byId.get(id);
    const detail = test ? [test.title, test.details].filter(Boolean).join('. ') : '';
    const evidence = {
      not_live: `NOT YET LIVE: built${fix.data.theme ? ` on ${fix.data.theme}` : ''}, awaiting publication`,
      awaiting_retest: 'MANUAL PENDING: live, re-test not yet logged',
      manual_pending: `MANUAL PENDING: ${detail}`,
      failed: `MANUAL PENDING: the test on ${test ? test.happenedOn : ''} did not pass. ${detail}`,
      passed: `Pass ${test ? test.happenedOn : ''}: ${detail}`,
      flagged: `MANUAL PENDING: corrected on ${correction ? correction.happenedOn : ''}: ${correction ? correction.title : ''}. Check this row before issuing`,
    }[state];
    rows.push([fix.happenedOn + fix.createdAt, [
      live ? live.happenedOn : fix.happenedOn,
      fix.title,
      String(fix.data.wcag ?? ''),
      String(fix.data.how ?? fix.details ?? ''),
      evidence,
      Array.isArray(fix.data.pages) ? fix.data.pages.join(', ') : String(fix.data.pages ?? ''),
    ]]);
  }
  // Newest live date first; fixes that went live together keep the order they were made in, newest first.
  return rows.sort((a, b) => (a[1][0] !== b[1][0] ? (a[1][0] < b[1][0] ? 1 : -1) : (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))).map((r) => r[1]);
}

/* ---------------------------------------------------------------- evidence --- */

/**
 * What may be attached to an entry as its evidence. Kept to formats that can be read back later:
 * a scan tool's own export (JSON is best, because it can be compared with the next scan), a
 * report (PDF or HTML), a screenshot, or a table. Downloads are always sent as attachments.
 */
export const EVIDENCE_TYPES = ['json', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'html', 'htm', 'csv', 'xlsx', 'txt'];

/** Attach one file to an entry. An entry takes one file, once. */
export async function attachEvidence(store, session, entryId, { filename, data }) {
  const repo = repoFor(store);
  const entry = isUuid(entryId) ? await repo.get(entryId) : null;
  if (!entry) throw new PortalError('That entry no longer exists.', { code: 'not_found', status: 404 });
  if (entry.file_name) {
    throw new PortalError('That entry already has a file. Entries are not changed: add a new entry for another file.', { code: 'activity_file_exists', status: 409 });
  }
  if (!Buffer.isBuffer(data) || data.length === 0) throw new PortalError('That file is empty.', { code: 'file_empty' });
  const name = sanitizeFilename(filename);
  const ext = name.toLowerCase().split('.').pop();
  if (!name.includes('.') || !EVIDENCE_TYPES.includes(ext)) {
    throw new PortalError('Attach a JSON, PDF, PNG, JPG, WebP, HTML, CSV, XLSX or TXT file. For a scan, the tool\u2019s JSON export is best.', { code: 'activity_file_type', status: 415 });
  }
  const row = await repo.attachFile(entry.id, { name, type: contentTypeFor(name), data, by: String(session.name ?? '').slice(0, 120) });
  if (!row) throw new PortalError('That entry already has a file.', { code: 'activity_file_exists', status: 409 });
  return out(row);
}

/** The client an entry belongs to, or null. Routes use it to check access before anything else. */
export async function activityClientId(store, entryId) {
  const entry = isUuid(entryId) ? await repoFor(store).get(entryId) : null;
  return entry ? entry.client_id : null;
}

/** An entry's file with its bytes, or null. */
export async function getEvidence(store, entryId) {
  const row = isUuid(entryId) ? await repoFor(store).getFile(entryId) : null;
  return row ? { clientId: row.client_id, name: row.file_name, type: row.file_type, data: Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data) } : null;
}

export default { ACTIVITY_KINDS, WRITABLE_KINDS, FIX_STATES, EVIDENCE_TYPES, listActivity, addActivity, recordActivity, activityCsv, kitRows, fixStates, withStates, attachEvidence, activityClientId, getEvidence };
