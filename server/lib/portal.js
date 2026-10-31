import crypto from 'node:crypto';
import { promisify } from 'node:util';
import config from './config.js';
import { log } from './logger.js';
import { cleanText } from './identity.js';
import { isUuid } from './store.js';

/**
 * Client portal: passwords, sessions, and the storage behind /portal.
 *
 * What lives here, and the rule each part exists to keep:
 *
 *   passwords   scrypt with a per-login salt. Nothing in the system can read a
 *               password back — the admin page shows a generated one exactly
 *               once, then only its hash exists.
 *   sessions    a random token in an HttpOnly cookie; the database holds only
 *               the token's SHA-256, so a leaked table is not a set of logins.
 *   sign-in     one generic failure message, the same work done whether or not
 *               the email exists, and a rolling-window lockout per email and
 *               per address.
 *   storage     one interface over Postgres and the in-memory store, so the
 *               integration tests exercise the same code paths as production.
 *
 * Authorisation is NOT decided here. Every function takes ids it is handed; the
 * routes (server/routes/portal.js) are what check that a client session may only
 * ever reach its own client's rows.
 */

const scrypt = promisify(crypto.scrypt);

export class PortalError extends Error {
  constructor(message, { code = 'portal_error', status = 400, field = null } = {}) {
    super(message);
    this.name = 'PortalError';
    this.code = code;
    this.status = status;
    this.field = field;
    this.public = true;
  }
}

/* ============================================================ passwords === */

// N = 2^15 costs ~32 MB and roughly 80 ms per attempt — invisible on a real
// sign-in, expensive for anyone guessing offline against a stolen hash.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText, 'base64url');
  if (!expected.length) return false;
  let actual;
  try {
    actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltText, 'base64url'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
  } catch {
    return false; // parameters we cannot or will not compute
  }
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * A hash to verify against when the email is unknown, so "no such login" takes
 * as long as "wrong password" and the response time says nothing about which
 * addresses have accounts.
 */
let dummyHash = null;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(24).toString('base64url')));

// No 0/o, 1/l/i: a generated password gets read aloud and retyped from an email.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** e.g. "k7fm-q2xd-9rpw-t4hn" — 16 symbols from 31, about 79 bits. */
export function generatePassword() {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i && i % 4 === 0) out += '-';
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

/** Compare two secrets without leaking where they first differ, or their length. */
function secretsMatch(a, b) {
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/* ============================================================== cookies === */

export const SESSION_COOKIE = 'ar_session';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function readSessionToken(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
      const value = part.slice(index + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * HttpOnly keeps the token away from any script on the page; SameSite=Lax means
 * another site cannot make a signed-in browser POST to us (the /api Origin check
 * in app.js is the second lock on that door). Secure is added in production —
 * it cannot be set on http://localhost, which is the only reason it is
 * conditional.
 */
function cookieAttributes(maxAgeSeconds) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function setSessionCookie(res, token, maxAgeSeconds) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttributes(maxAgeSeconds)}`);
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

/* ================================================================ input === */

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export function normalizeLoginEmail(raw) {
  const email = String(raw ?? '').normalize('NFKC').trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new PortalError('Enter a valid email address.', { code: 'email_invalid', field: 'email' });
  }
  return { email, key: email.toLowerCase() };
}

/** Keep the name a person recognises; drop any path and anything unprintable. */
export function sanitizeFilename(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop();
  const clean = cleanText(base, 180).replace(/^\.+/, '');
  return clean || 'file';
}

/**
 * The Content-Type a download is served with comes from this list, never from
 * what the uploader's browser claimed. Every download is also sent as an
 * attachment (see the route), so nothing uploaded is ever rendered on our origin.
 */
const TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  zip: 'application/zip',
};

export function contentTypeFor(filename) {
  const ext = String(filename).toLowerCase().split('.').pop();
  return TYPES[ext] ?? 'application/octet-stream';
}

/** RFC 6266: a plain-ASCII fallback plus the real name, percent-encoded. */
export function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/* ============================================================== storage === */

const iso = (value) => (value == null ? null : new Date(value).toISOString());

const clientOut = (row) => ({ id: row.id, name: row.name, createdAt: iso(row.created_at) });
const userOut = (row) => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name ?? '',
  email: row.email,
  passwordSetBy: row.password_set_by,
  lastLoginAt: iso(row.last_login_at),
  createdAt: iso(row.created_at),
});
const fileOut = (row) => ({
  id: row.id,
  clientId: row.client_id,
  name: row.filename,
  size: row.size_bytes,
  area: row.area ?? 'files',
  createdAt: iso(row.created_at),
});

const reportOut = (row) => ({
  id: row.id,
  clientId: row.client_id,
  title: row.title,
  size: row.size_bytes,
  status: row.status ?? 'open',
  closedAt: iso(row.closed_at),
  closedBy: row.closed_by ?? null,
  createdAt: iso(row.created_at),
});
const approvalOut = (row) => ({
  id: row.id,
  reportId: row.report_id,
  clientId: row.client_id,
  key: row.item_key,
  title: row.item_title,
  decision: row.decision,
  choice: row.choice,
  comment: row.comment,
  signerName: row.signer_name,
  email: row.user_email,
  decidedAt: iso(row.decided_at),
  savedAt: iso(row.created_at),
});

/** Postgres implementation. */
function pgRepo(store) {
  const q = (text, params) => store.query(text, params);
  return {
    async listClients() {
      return (await q('SELECT id, name, created_at FROM portal_clients ORDER BY lower(name), created_at')).rows;
    },
    async getClient(id) {
      return (await q('SELECT id, name, created_at FROM portal_clients WHERE id = $1', [id])).rows[0] ?? null;
    },
    async insertClient(name) {
      return (await q('INSERT INTO portal_clients (name) VALUES ($1) RETURNING id, name, created_at', [name])).rows[0];
    },
    async renameClient(id, name) {
      return (await q('UPDATE portal_clients SET name = $2 WHERE id = $1 RETURNING id, name, created_at', [id, name])).rows[0] ?? null;
    },
    async deleteClient(id) {
      return (await q('DELETE FROM portal_clients WHERE id = $1', [id])).rowCount > 0;
    },

    async listUsers(clientId = null) {
      const cols = 'id, client_id, name, email, password_set_by, last_login_at, created_at';
      return clientId
        ? (await q(`SELECT ${cols} FROM portal_users WHERE client_id = $1 ORDER BY created_at`, [clientId])).rows
        : (await q(`SELECT ${cols} FROM portal_users ORDER BY created_at`)).rows;
    },
    async getUser(id) {
      return (await q('SELECT * FROM portal_users WHERE id = $1', [id])).rows[0] ?? null;
    },
    async findUserByEmailKey(key) {
      return (await q('SELECT * FROM portal_users WHERE email_key = $1', [key])).rows[0] ?? null;
    },
    async insertUser({ clientId, name, email, emailKey, passwordHash }) {
      try {
        return (await q(
          `INSERT INTO portal_users (client_id, name, email, email_key, password_hash)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [clientId, name || null, email, emailKey, passwordHash],
        )).rows[0];
      } catch (err) {
        if (err.code === '23505') return null; // unique_violation on email_key
        throw err;
      }
    },
    async setPassword(id, passwordHash, setBy) {
      return (await q(
        'UPDATE portal_users SET password_hash = $2, password_set_by = $3 WHERE id = $1',
        [id, passwordHash, setBy],
      )).rowCount > 0;
    },
    async touchLogin(id) {
      await q('UPDATE portal_users SET last_login_at = now() WHERE id = $1', [id]);
    },
    async deleteUser(id) {
      return (await q('DELETE FROM portal_users WHERE id = $1', [id])).rowCount > 0;
    },

    async insertSession({ tokenHash, role, userId, operatorId, expiresAt, ipHash }) {
      await q(
        'INSERT INTO portal_sessions (token_hash, role, user_id, operator_id, expires_at, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)',
        [tokenHash, role, userId ?? null, operatorId ?? null, expiresAt, ipHash ?? null],
      );
    },
    async getSession(tokenHash) {
      const { rows } = await q(
        `SELECT s.role, s.user_id, s.operator_id, s.expires_at,
                u.email, u.name AS user_name, u.client_id, u.password_set_by,
                c.name AS client_name,
                o.email AS op_email, o.name AS op_name, o.role AS op_role, o.password_set_by AS op_password_set_by
           FROM portal_sessions s
           LEFT JOIN portal_users u     ON u.id = s.user_id
           LEFT JOIN portal_clients c   ON c.id = u.client_id
           LEFT JOIN portal_operators o ON o.id = s.operator_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [tokenHash],
      );
      return rows[0] ?? null;
    },
    async deleteSession(tokenHash) {
      await q('DELETE FROM portal_sessions WHERE token_hash = $1', [tokenHash]);
    },
    async deleteUserSessions(userId, exceptTokenHash = null) {
      await q(
        'DELETE FROM portal_sessions WHERE user_id = $1 AND token_hash <> $2',
        [userId, exceptTokenHash ?? ''],
      );
    },
    async purgeExpiredSessions() {
      await q('DELETE FROM portal_sessions WHERE expires_at <= now()');
    },

    async listFiles(clientId = null) {
      const cols = 'id, client_id, filename, size_bytes, area, created_at';
      return clientId
        ? (await q(`SELECT ${cols} FROM portal_files WHERE client_id = $1 ORDER BY created_at DESC`, [clientId])).rows
        : (await q(`SELECT ${cols} FROM portal_files ORDER BY created_at DESC`)).rows;
    },
    async insertFile({ clientId, filename, contentType, data, area = 'files' }) {
      return (await q(
        `INSERT INTO portal_files (client_id, filename, content_type, size_bytes, data, area)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, client_id, filename, size_bytes, area, created_at`,
        [clientId, filename, contentType, data.length, data, area],
      )).rows[0];
    },
    async getFile(id) {
      return (await q('SELECT * FROM portal_files WHERE id = $1', [id])).rows[0] ?? null;
    },
    async deleteFile(id) {
      return (await q('DELETE FROM portal_files WHERE id = $1', [id])).rowCount > 0;
    },
    async setFileArea(id, area) {
      return (await q('UPDATE portal_files SET area = $2 WHERE id = $1 RETURNING id, client_id, filename, size_bytes, area, created_at', [id, area])).rows[0] ?? null;
    },

    async listTeamFiles() {
      return (await q('SELECT id, filename, size_bytes, added_by_name, added_by_email, created_at FROM portal_team_files ORDER BY created_at DESC')).rows;
    },
    async insertTeamFile({ filename, contentType, data, addedByName, addedByEmail }) {
      return (await q(
        `INSERT INTO portal_team_files (filename, content_type, size_bytes, data, added_by_name, added_by_email)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename, size_bytes, added_by_name, added_by_email, created_at`,
        [filename, contentType, data.length, data, addedByName, addedByEmail],
      )).rows[0];
    },
    async getTeamFile(id) {
      return (await q('SELECT * FROM portal_team_files WHERE id = $1', [id])).rows[0] ?? null;
    },
    async deleteTeamFile(id) {
      return (await q('DELETE FROM portal_team_files WHERE id = $1', [id])).rowCount > 0;
    },

    async listTeamNotes() {
      return (await q('SELECT id, file_id, task_id, body, author_name, author_email, created_at, updated_at FROM portal_team_notes WHERE file_id IS NOT NULL OR task_id IS NOT NULL ORDER BY created_at ASC LIMIT 4000')).rows;
    },
    /** Null when the file or task no longer exists. Exactly one of `fileId` / `taskId` is set. */
    async insertTeamNote({ fileId = null, taskId = null, body, authorName, authorEmail }) {
      return (await q(
        `INSERT INTO portal_team_notes (file_id, task_id, body, author_name, author_email)
         SELECT $1::uuid, $2::uuid, $3, $4, $5
          WHERE ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM portal_team_files WHERE id = $1::uuid))
             OR ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM portal_team_tasks WHERE id = $2::uuid))
         RETURNING id, file_id, task_id, body, author_name, author_email, created_at, updated_at`,
        [fileId, taskId, body, authorName, authorEmail],
      )).rows[0] ?? null;
    },
    async updateTeamNote(id, body) {
      return (await q(
        `UPDATE portal_team_notes SET body = $2, updated_at = now() WHERE id = $1 AND (file_id IS NOT NULL OR task_id IS NOT NULL)
         RETURNING id, file_id, task_id, body, author_name, author_email, created_at, updated_at`,
        [id, body],
      )).rows[0] ?? null;
    },
    async deleteTeamNote(id) {
      return (await q('DELETE FROM portal_team_notes WHERE id = $1 AND (file_id IS NOT NULL OR task_id IS NOT NULL)', [id])).rowCount > 0;
    },

    async listTeamTasks() {
      return (await q('SELECT id, text, done, done_at, author_name, author_email, created_at, updated_at FROM portal_team_tasks ORDER BY created_at ASC LIMIT 500')).rows;
    },
    async insertTeamTask({ text, authorName, authorEmail }) {
      return (await q(
        `INSERT INTO portal_team_tasks (text, author_name, author_email) VALUES ($1, $2, $3)
         RETURNING id, text, done, done_at, author_name, author_email, created_at, updated_at`,
        [text, authorName, authorEmail],
      )).rows[0];
    },
    /** `text` and `done` are each null when unchanged. */
    async updateTeamTask(id, { text, done }) {
      return (await q(
        `UPDATE portal_team_tasks
            SET text = COALESCE($2::text, text),
                done = COALESCE($3::boolean, done),
                done_at = CASE WHEN $3::boolean IS NULL THEN done_at WHEN $3::boolean THEN COALESCE(done_at, now()) ELSE NULL END,
                updated_at = CASE WHEN $2::text IS NULL THEN updated_at ELSE now() END
          WHERE id = $1
         RETURNING id, text, done, done_at, author_name, author_email, created_at, updated_at`,
        [id, text, done],
      )).rows[0] ?? null;
    },
    async deleteTeamTask(id) {
      return (await q('DELETE FROM portal_team_tasks WHERE id = $1', [id])).rowCount > 0;
    },

    async listOperators() {
      return (await q('SELECT id, name, email, role, password_set_by, last_login_at, created_at FROM portal_operators ORDER BY lower(name), created_at')).rows;
    },
    async getOperator(id) {
      return (await q('SELECT * FROM portal_operators WHERE id = $1', [id])).rows[0] ?? null;
    },
    async findOperatorByEmailKey(key) {
      return (await q('SELECT * FROM portal_operators WHERE email_key = $1', [key])).rows[0] ?? null;
    },
    async insertOperator({ name, email, emailKey, passwordHash, role }) {
      try {
        return (await q(
          `INSERT INTO portal_operators (name, email, email_key, password_hash, role)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [name, email, emailKey, passwordHash, role],
        )).rows[0];
      } catch (err) {
        if (err.code === '23505') return null;
        throw err;
      }
    },
    async setOperatorRole(id, role) {
      return (await q('UPDATE portal_operators SET role = $2 WHERE id = $1', [id, role])).rowCount > 0;
    },
    async setOperatorPassword(id, passwordHash, setBy) {
      return (await q('UPDATE portal_operators SET password_hash = $2, password_set_by = $3 WHERE id = $1', [id, passwordHash, setBy])).rowCount > 0;
    },
    async touchOperatorLogin(id) {
      await q('UPDATE portal_operators SET last_login_at = now() WHERE id = $1', [id]);
    },
    async deleteOperator(id) {
      return (await q('DELETE FROM portal_operators WHERE id = $1', [id])).rowCount > 0;
    },
    async countMasters() {
      return Number((await q("SELECT count(*) AS n FROM portal_operators WHERE role = 'master'")).rows[0].n);
    },
    async deleteOperatorSessions(operatorId, exceptTokenHash = null) {
      await q('DELETE FROM portal_sessions WHERE operator_id = $1 AND token_hash <> $2', [operatorId, exceptTokenHash ?? '']);
    },
    async listAssignments() {
      return (await q('SELECT operator_id, client_id FROM portal_operator_clients')).rows;
    },
    async assignedClientIds(operatorId) {
      return (await q('SELECT client_id FROM portal_operator_clients WHERE operator_id = $1', [operatorId])).rows.map((r) => r.client_id);
    },
    async setAssignments(operatorId, clientIds) {
      await q('DELETE FROM portal_operator_clients WHERE operator_id = $1', [operatorId]);
      for (const clientId of clientIds) {
        await q('INSERT INTO portal_operator_clients (operator_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [operatorId, clientId]);
      }
    },

    async listReports(clientId = null) {
      const cols = 'id, client_id, title, size_bytes, status, closed_at, closed_by, created_at';
      return clientId
        ? (await q(`SELECT ${cols} FROM portal_reports WHERE client_id = $1 ORDER BY created_at DESC`, [clientId])).rows
        : (await q(`SELECT ${cols} FROM portal_reports ORDER BY created_at DESC`)).rows;
    },
    async insertReport({ clientId, title, html }) {
      return (await q(
        `INSERT INTO portal_reports (client_id, title, size_bytes, html)
         VALUES ($1, $2, $3, $4) RETURNING id, client_id, title, size_bytes, status, closed_at, closed_by, created_at`,
        [clientId, title, Buffer.byteLength(html, 'utf8'), html],
      )).rows[0];
    },
    async setReportStatus(id, status, closedBy) {
      return (await q(
        `UPDATE portal_reports
            SET status = $2,
                closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
                closed_by = CASE WHEN $2 = 'closed' THEN $3 ELSE NULL END
          WHERE id = $1
        RETURNING id, client_id, title, size_bytes, status, closed_at, closed_by, created_at`,
        [id, status, closedBy ?? null],
      )).rows[0] ?? null;
    },
    async getReport(id) {
      return (await q('SELECT * FROM portal_reports WHERE id = $1', [id])).rows[0] ?? null;
    },
    async deleteReport(id) {
      return (await q('DELETE FROM portal_reports WHERE id = $1', [id])).rowCount > 0;
    },

    async insertApprovals(rows) {
      const out = [];
      for (const r of rows) {
        out.push((await q(
          `INSERT INTO portal_approvals
             (report_id, client_id, user_id, user_email, signer_name, item_key, item_title, decision, choice, comment, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [r.reportId, r.clientId, r.userId, r.userEmail, r.signerName, r.key, r.title, r.decision, r.choice, r.comment, r.decidedAt],
        )).rows[0]);
      }
      return out;
    },
    /** The newest row for each item. One report, or every report when none is named. */
    async latestApprovals(reportId = null) {
      const where = reportId ? 'WHERE report_id = $1' : '';
      return (await q(
        `SELECT DISTINCT ON (report_id, item_key) *
           FROM portal_approvals ${where}
          ORDER BY report_id, item_key, created_at DESC, id DESC`,
        reportId ? [reportId] : [],
      )).rows;
    },
    async approvalHistory(reportId) {
      return (await q('SELECT * FROM portal_approvals WHERE report_id = $1 ORDER BY created_at DESC, id DESC', [reportId])).rows;
    },
  };
}

/** In-memory implementation, for development and tests. Same contract as pgRepo. */
function memRepo(store) {
  store._portal ??= { clients: new Map(), users: new Map(), sessions: new Map(), files: new Map(), reports: new Map(), approvals: [], operators: new Map(), assignments: [] };
  store._portal.operators ??= new Map();
  store._portal.assignments ??= [];
  store._portal.reports ??= new Map();
  store._portal.approvals ??= [];
  store._portal.teamFiles ??= new Map();
  store._portal.teamNotes ??= [];
  store._portal.teamTasks ??= [];
  const db = store._portal;
  let last = 0;
  // Strictly increasing, so "newest first" is stable for rows made in the same millisecond.
  const now = () => new Date(last = Math.max(Date.now(), last + 1)).toISOString();
  const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

  const dropUser = (id) => {
    db.users.delete(id);
    for (const [key, session] of db.sessions) if (session.user_id === id) db.sessions.delete(key);
  };

  return {
    async listClients() {
      return [...db.clients.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || byCreated(a, b));
    },
    async getClient(id) { return db.clients.get(id) ?? null; },
    async insertClient(name) {
      const row = { id: crypto.randomUUID(), name, created_at: now() };
      db.clients.set(row.id, row);
      return row;
    },
    async renameClient(id, name) {
      const row = db.clients.get(id);
      if (!row) return null;
      row.name = name;
      return row;
    },
    async deleteClient(id) {
      if (!db.clients.delete(id)) return false;
      for (const user of [...db.users.values()]) if (user.client_id === id) dropUser(user.id);
      for (const [key, file] of db.files) if (file.client_id === id) db.files.delete(key);
      for (const [key, report] of db.reports) if (report.client_id === id) db.reports.delete(key);
      db.assignments = db.assignments.filter((a) => a.client_id !== id);
      db.approvals = db.approvals.filter((a) => a.client_id !== id);
      return true;
    },

    async listUsers(clientId = null) {
      return [...db.users.values()].filter((u) => !clientId || u.client_id === clientId).sort(byCreated);
    },
    async getUser(id) { return db.users.get(id) ?? null; },
    async findUserByEmailKey(key) {
      return [...db.users.values()].find((u) => u.email_key === key) ?? null;
    },
    async insertUser({ clientId, name, email, emailKey, passwordHash }) {
      if ([...db.users.values()].some((u) => u.email_key === emailKey)) return null;
      const row = {
        id: crypto.randomUUID(), created_at: now(), client_id: clientId,
        name: name || null, email, email_key: emailKey,
        password_hash: passwordHash, password_set_by: 'admin', last_login_at: null,
      };
      db.users.set(row.id, row);
      return row;
    },
    async setPassword(id, passwordHash, setBy) {
      const row = db.users.get(id);
      if (!row) return false;
      row.password_hash = passwordHash;
      row.password_set_by = setBy;
      return true;
    },
    async touchLogin(id) {
      const row = db.users.get(id);
      if (row) row.last_login_at = new Date().toISOString();
    },
    async deleteUser(id) {
      if (!db.users.has(id)) return false;
      dropUser(id);
      return true;
    },

    async insertSession({ tokenHash, role, userId, operatorId, expiresAt, ipHash }) {
      db.sessions.set(tokenHash, { role, user_id: userId ?? null, operator_id: operatorId ?? null, expires_at: expiresAt, ip_hash: ipHash ?? null });
    },
    async getSession(tokenHash) {
      const session = db.sessions.get(tokenHash);
      if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
      const user = session.user_id ? db.users.get(session.user_id) : null;
      const client = user ? db.clients.get(user.client_id) : null;
      const op = session.operator_id ? db.operators.get(session.operator_id) : null;
      return {
        role: session.role, user_id: session.user_id, operator_id: session.operator_id ?? null, expires_at: session.expires_at,
        op_email: op?.email ?? null, op_name: op?.name ?? null, op_role: op?.role ?? null, op_password_set_by: op?.password_set_by ?? null,
        email: user?.email ?? null, user_name: user?.name ?? null, client_id: user?.client_id ?? null,
        password_set_by: user?.password_set_by ?? null, client_name: client?.name ?? null,
      };
    },
    async deleteSession(tokenHash) { db.sessions.delete(tokenHash); },
    async deleteUserSessions(userId, exceptTokenHash = null) {
      for (const [key, session] of db.sessions) {
        if (session.user_id === userId && key !== exceptTokenHash) db.sessions.delete(key);
      }
    },
    async purgeExpiredSessions() {
      for (const [key, session] of db.sessions) {
        if (new Date(session.expires_at).getTime() <= Date.now()) db.sessions.delete(key);
      }
    },

    async listFiles(clientId = null) {
      return [...db.files.values()]
        .filter((f) => !clientId || f.client_id === clientId)
        .sort((a, b) => byCreated(b, a));
    },
    async insertFile({ clientId, filename, contentType, data, area = 'files' }) {
      const row = {
        id: crypto.randomUUID(), created_at: now(), client_id: clientId,
        filename, content_type: contentType, size_bytes: data.length, data, area,
      };
      db.files.set(row.id, row);
      return row;
    },
    async getFile(id) { return db.files.get(id) ?? null; },
    async deleteFile(id) { return db.files.delete(id); },
    async setFileArea(id, area) {
      const row = db.files.get(id);
      if (!row) return null;
      row.area = area;
      return row;
    },

    async listTeamFiles() {
      return [...db.teamFiles.values()].sort((a, b) => byCreated(b, a));
    },
    async insertTeamFile({ filename, contentType, data, addedByName, addedByEmail }) {
      const row = {
        id: crypto.randomUUID(), created_at: now(), filename, content_type: contentType,
        size_bytes: data.length, data, added_by_name: addedByName, added_by_email: addedByEmail,
      };
      db.teamFiles.set(row.id, row);
      return row;
    },
    async getTeamFile(id) { return db.teamFiles.get(id) ?? null; },
    async deleteTeamFile(id) {
      const removed = db.teamFiles.delete(id);
      // Notes go with their file, as ON DELETE CASCADE does in Postgres.
      if (removed) for (let i = db.teamNotes.length - 1; i >= 0; i -= 1) if (db.teamNotes[i].file_id === id) db.teamNotes.splice(i, 1);
      return removed;
    },

    async listTeamNotes() { return db.teamNotes.filter((n) => n.file_id || n.task_id).sort((a, b) => byCreated(a, b)); },
    async insertTeamNote({ fileId = null, taskId = null, body, authorName, authorEmail }) {
      if (fileId ? !db.teamFiles.has(fileId) : !db.teamTasks.some((t) => t.id === taskId)) return null;
      const row = { id: crypto.randomUUID(), file_id: fileId, task_id: taskId, created_at: now(), updated_at: null, body, author_name: authorName, author_email: authorEmail };
      db.teamNotes.push(row);
      return row;
    },
    async updateTeamNote(id, body) {
      const row = db.teamNotes.find((n) => n.id === id && (n.file_id || n.task_id));
      if (!row) return null;
      row.body = body;
      row.updated_at = now();
      return row;
    },
    async deleteTeamNote(id) {
      const i = db.teamNotes.findIndex((n) => n.id === id && (n.file_id || n.task_id));
      if (i < 0) return false;
      db.teamNotes.splice(i, 1);
      return true;
    },

    async listTeamTasks() { return [...db.teamTasks].sort((a, b) => byCreated(a, b)); },
    async insertTeamTask({ text, authorName, authorEmail }) {
      const row = { id: crypto.randomUUID(), created_at: now(), updated_at: null, text, done: false, done_at: null, author_name: authorName, author_email: authorEmail };
      db.teamTasks.push(row);
      return row;
    },
    async updateTeamTask(id, { text, done }) {
      const row = db.teamTasks.find((t) => t.id === id);
      if (!row) return null;
      if (text !== null) { row.text = text; row.updated_at = now(); }
      if (done !== null) { row.done_at = done ? (row.done_at ?? now()) : null; row.done = done; }
      return row;
    },
    async deleteTeamTask(id) {
      const i = db.teamTasks.findIndex((t) => t.id === id);
      if (i < 0) return false;
      db.teamTasks.splice(i, 1);
      // Notes go with their task, as ON DELETE CASCADE does in Postgres.
      for (let n = db.teamNotes.length - 1; n >= 0; n -= 1) if (db.teamNotes[n].task_id === id) db.teamNotes.splice(n, 1);
      return true;
    },

    async listOperators() {
      return [...db.operators.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || byCreated(a, b));
    },
    async getOperator(id) { return db.operators.get(id) ?? null; },
    async findOperatorByEmailKey(key) {
      return [...db.operators.values()].find((o) => o.email_key === key) ?? null;
    },
    async insertOperator({ name, email, emailKey, passwordHash, role }) {
      if ([...db.operators.values()].some((o) => o.email_key === emailKey)) return null;
      const row = {
        id: crypto.randomUUID(), created_at: now(), name, email, email_key: emailKey,
        password_hash: passwordHash, password_set_by: 'admin', role, last_login_at: null,
      };
      db.operators.set(row.id, row);
      return row;
    },
    async setOperatorRole(id, role) {
      const row = db.operators.get(id);
      if (!row) return false;
      row.role = role;
      return true;
    },
    async setOperatorPassword(id, passwordHash, setBy) {
      const row = db.operators.get(id);
      if (!row) return false;
      row.password_hash = passwordHash;
      row.password_set_by = setBy;
      return true;
    },
    async touchOperatorLogin(id) {
      const row = db.operators.get(id);
      if (row) row.last_login_at = new Date().toISOString();
    },
    async deleteOperator(id) {
      if (!db.operators.delete(id)) return false;
      db.assignments = db.assignments.filter((a) => a.operator_id !== id);
      for (const [key, session] of db.sessions) if (session.operator_id === id) db.sessions.delete(key);
      return true;
    },
    async countMasters() {
      return [...db.operators.values()].filter((o) => o.role === 'master').length;
    },
    async deleteOperatorSessions(operatorId, exceptTokenHash = null) {
      for (const [key, session] of db.sessions) {
        if (session.operator_id === operatorId && key !== exceptTokenHash) db.sessions.delete(key);
      }
    },
    async listAssignments() { return db.assignments.map((a) => ({ ...a })); },
    async assignedClientIds(operatorId) {
      return db.assignments.filter((a) => a.operator_id === operatorId).map((a) => a.client_id);
    },
    async setAssignments(operatorId, clientIds) {
      db.assignments = db.assignments.filter((a) => a.operator_id !== operatorId);
      for (const clientId of clientIds) db.assignments.push({ operator_id: operatorId, client_id: clientId });
    },

    async listReports(clientId = null) {
      return [...db.reports.values()]
        .filter((r) => !clientId || r.client_id === clientId)
        .sort((a, b) => byCreated(b, a));
    },
    async insertReport({ clientId, title, html }) {
      const row = {
        id: crypto.randomUUID(), created_at: now(), client_id: clientId,
        title, size_bytes: Buffer.byteLength(html, 'utf8'), html,
        status: 'open', closed_at: null, closed_by: null,
      };
      db.reports.set(row.id, row);
      return row;
    },
    async setReportStatus(id, status, closedBy) {
      const row = db.reports.get(id);
      if (!row) return null;
      row.status = status;
      row.closed_at = status === 'closed' ? new Date().toISOString() : null;
      row.closed_by = status === 'closed' ? (closedBy ?? null) : null;
      return row;
    },
    async getReport(id) { return db.reports.get(id) ?? null; },
    async deleteReport(id) {
      if (!db.reports.delete(id)) return false;
      db.approvals = db.approvals.filter((a) => a.report_id !== id);
      return true;
    },

    async insertApprovals(rows) {
      return rows.map((r) => {
        const row = {
          id: crypto.randomUUID(), created_at: now(), report_id: r.reportId, client_id: r.clientId,
          user_id: r.userId, user_email: r.userEmail, signer_name: r.signerName,
          item_key: r.key, item_title: r.title, decision: r.decision, choice: r.choice,
          comment: r.comment, decided_at: r.decidedAt,
        };
        db.approvals.push(row);
        return row;
      });
    },
    async latestApprovals(reportId = null) {
      const newest = new Map();
      for (const a of db.approvals) {
        if (reportId && a.report_id !== reportId) continue;
        const k = `${a.report_id}\u0000${a.item_key}`;
        const have = newest.get(k);
        if (!have || a.created_at >= have.created_at) newest.set(k, a);
      }
      return [...newest.values()];
    },
    async approvalHistory(reportId) {
      return db.approvals.filter((a) => a.report_id === reportId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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

/* ============================================================== sign-in === */

const LOGIN_WINDOW_HOURS = 0.25;
const BAD_CREDENTIALS = "That email and password don't match. Check both and try again.";

// Rate-event subjects are hashed so a lockout log never holds a plain email.
const emailSubject = (key) => crypto.createHash('sha256').update(`portal:${key}`).digest('hex').slice(0, 32);

async function assertNotLockedOut(store, emailKey, ipHash) {
  const [byEmail, byIp] = await Promise.all([
    store.countRecent('portal_login_email', emailSubject(emailKey), LOGIN_WINDOW_HOURS),
    store.countRecent('portal_login_ip', ipHash, LOGIN_WINDOW_HOURS),
  ]);
  if (byEmail >= config.portal.loginAttemptsPerEmail || byIp >= config.portal.loginAttemptsPerIp) {
    throw new PortalError('Too many sign-in attempts. Wait 15 minutes and try again.', {
      code: 'too_many_attempts', status: 429,
    });
  }
}

async function recordFailure(store, emailKey, ipHash) {
  await Promise.all([
    store.recordRateEvent('portal_login_email', emailSubject(emailKey)),
    store.recordRateEvent('portal_login_ip', ipHash),
  ]);
}

async function openSession(store, { role, userId = null, operatorId = null, ipHash }) {
  const repo = repoFor(store);
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAgeSeconds = role === 'admin' || role === 'operator'
    ? config.portal.adminSessionHours * 3600
    : config.portal.clientSessionDays * 86_400;
  await repo.insertSession({
    tokenHash: hashToken(token),
    role,
    userId,
    operatorId,
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
    ipHash,
  });
  // Opportunistic: sign-ins are rare enough that this never needs its own job.
  repo.purgeExpiredSessions().catch((err) => log.warn('portal session purge failed', { err: err.message }));
  return { token, role, maxAgeSeconds };
}

/**
 * Check an email and password, and open a session if they are right.
 * Resolves with { token, role, maxAgeSeconds }; throws PortalError otherwise.
 */
export async function signIn(store, { email, password, ipHash }) {
  const { key } = normalizeLoginEmail(email);
  const repo = repoFor(store);

  await assertNotLockedOut(store, key, ipHash);

  if (config.portal.adminEnabled && key === config.portal.adminEmail) {
    if (!secretsMatch(password, config.portal.adminPassword)) {
      await recordFailure(store, key, ipHash);
      throw new PortalError(BAD_CREDENTIALS, { code: 'bad_credentials', status: 401 });
    }
    log.info('portal admin signed in', { ipHash });
    return openSession(store, { role: 'admin', ipHash });
  }

  const operator = await repo.findOperatorByEmailKey(key);
  if (operator) {
    if (!(await verifyPassword(password, operator.password_hash))) {
      await recordFailure(store, key, ipHash);
      throw new PortalError(BAD_CREDENTIALS, { code: 'bad_credentials', status: 401 });
    }
    await repo.touchOperatorLogin(operator.id);
    log.info('portal operator signed in', { operatorId: operator.id, role: operator.role });
    return openSession(store, { role: 'operator', operatorId: operator.id, ipHash });
  }

  const user = await repo.findUserByEmailKey(key);
  const ok = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
  if (!user || !ok) {
    await recordFailure(store, key, ipHash);
    throw new PortalError(BAD_CREDENTIALS, { code: 'bad_credentials', status: 401 });
  }

  await repo.touchLogin(user.id);
  log.info('portal client signed in', { userId: user.id, clientId: user.client_id });
  return openSession(store, { role: 'client', userId: user.id, ipHash });
}

/** The session behind this request, or null. Never throws for a bad cookie. */
export async function sessionFor(store, req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await repoFor(store).getSession(tokenHash);
  if (!row) return null;

  if (row.role === 'admin') {
    // Removing the admin secrets must end admin access at once, not in 12 hours.
    if (!config.portal.adminEnabled) return null;
    return { role: 'admin', isMaster: true, tokenHash, email: config.portal.adminEmail, name: 'Accessrank team' };
  }
  if (row.role === 'operator') {
    // The operator was removed out from under the session.
    if (!row.operator_id || !row.op_email) return null;
    return {
      role: 'operator',
      isMaster: row.op_role === 'master',
      tokenHash,
      operatorId: row.operator_id,
      email: row.op_email,
      name: row.op_name ?? '',
      passwordSetBy: row.op_password_set_by,
    };
  }
  // The join came back empty: the login was deleted out from under the session.
  if (!row.user_id || !row.client_id) return null;
  return {
    role: 'client',
    tokenHash,
    userId: row.user_id,
    email: row.email,
    name: row.user_name ?? '',
    clientId: row.client_id,
    clientName: row.client_name,
    passwordSetBy: row.password_set_by,
  };
}

export async function signOut(store, req) {
  const token = readSessionToken(req);
  if (token) await repoFor(store).deleteSession(hashToken(token));
}

/* ============================================================== clients === */

function cleanClientName(raw) {
  const name = cleanText(raw, 120);
  if (name.length < 2) {
    throw new PortalError('Enter the client\u2019s company name.', { code: 'name_required', field: 'name' });
  }
  return name;
}

const notFound = (what) => new PortalError(`That ${what} no longer exists.`, { code: 'not_found', status: 404 });

/** Everything the admin page shows, in one round trip. */
export async function adminOverview(store, scope = null) {
  const repo = repoFor(store);
  const [allClients, users, files, reports, latest] = await Promise.all([
    repo.listClients(), repo.listUsers(), repo.listFiles(), repo.listReports(), repo.latestApprovals(),
  ]);
  const byReport = new Map();
  for (const a of latest) (byReport.get(a.report_id) ?? byReport.set(a.report_id, []).get(a.report_id)).push(a);
  const clients = scope ? allClients.filter((c) => scope.has(c.id)) : allClients;
  return clients.map((client) => ({
    ...clientOut(client),
    users: users.filter((u) => u.client_id === client.id).map(userOut),
    files: files.filter((f) => f.client_id === client.id).map(fileOut),
    reports: reports.filter((r) => r.client_id === client.id).map((r) => ({ ...reportOut(r), progress: progressOf(byReport.get(r.id) ?? []) })),
  }));
}

export async function createClient(store, rawName) {
  return { ...clientOut(await repoFor(store).insertClient(cleanClientName(rawName))), users: [], files: [], reports: [] };
}

/**
 * Create a client portal in one step: the client, optionally its first login
 * (returned with its one-time password) and optionally the operators who work on
 * it. Everything that can be checked is checked before anything is written, and
 * if the login is refused the client is removed again, so a failed attempt
 * leaves nothing behind.
 */
export async function createClientWithSetup(store, { name, login = null, operatorIds = [] }) {
  const repo = repoFor(store);
  const cleanName = cleanClientName(name);

  const wanted = [...new Set((Array.isArray(operatorIds) ? operatorIds : []).map(String))];
  const operators = [];
  for (const id of wanted) operators.push(await operatorOrThrow(repo, id));

  if (login) {
    const identity = normalizeLoginEmail(login.email);
    if (identity.key === config.portal.adminEmail || (await repo.findOperatorByEmailKey(identity.key))) {
      throw new PortalError('That address belongs to an Accessrank login. Use a different email.', {
        code: 'email_reserved', field: 'email',
      });
    }
  }

  const client = await createClient(store, cleanName);
  let created = null;
  try {
    if (login) created = await createLogin(store, client.id, login);
  } catch (err) {
    await repo.deleteClient(client.id);
    throw err;
  }

  if (operators.length) {
    const all = await repo.listAssignments();
    for (const op of operators) {
      const ids = new Set(all.filter((a) => a.operator_id === op.id).map((a) => a.client_id));
      ids.add(client.id);
      await repo.setAssignments(op.id, [...ids]);
    }
  }

  return {
    client: { ...client, users: created ? [created.user] : [] },
    login: created,
  };
}

export async function renameClient(store, id, rawName) {
  if (!isUuid(id)) throw notFound('client');
  const row = await repoFor(store).renameClient(id, cleanClientName(rawName));
  if (!row) throw notFound('client');
  return clientOut(row);
}

export async function deleteClient(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteClient(id))) throw notFound('client');
}

/* =============================================================== logins === */

/**
 * Create a login for a client. Returns the login and its generated password —
 * the only moment that password exists in readable form.
 */
export async function createLogin(store, clientId, { name, email }) {
  const repo = repoFor(store);
  if (!isUuid(clientId) || !(await repo.getClient(clientId))) throw notFound('client');

  const identity = normalizeLoginEmail(email);
  if (identity.key === config.portal.adminEmail) {
    throw new PortalError('That address is the Accessrank admin login. Use a different email.', {
      code: 'email_reserved', field: 'email',
    });
  }

  if (await repo.findOperatorByEmailKey(identity.key)) {
    throw new PortalError('That address belongs to an Accessrank operator. Use a different email.', {
      code: 'email_reserved', field: 'email',
    });
  }

  const password = generatePassword();
  const row = await repo.insertUser({
    clientId,
    name: cleanText(name, 120),
    email: identity.email,
    emailKey: identity.key,
    passwordHash: await hashPassword(password),
  });
  if (!row) {
    throw new PortalError('That email already has a login. Reset its password instead.', {
      code: 'email_taken', status: 409, field: 'email',
    });
  }
  return { user: userOut(row), password };
}

/** Replace a login's password with a new generated one and sign that login out everywhere. */
export async function resetLoginPassword(store, userId) {
  const repo = repoFor(store);
  const user = isUuid(userId) ? await repo.getUser(userId) : null;
  if (!user) throw notFound('login');

  const password = generatePassword();
  await repo.setPassword(user.id, await hashPassword(password), 'admin');
  await repo.deleteUserSessions(user.id);
  return { user: userOut({ ...user, password_set_by: 'admin' }), password };
}

/** The client a login belongs to, or null. Used to check an operator may touch it. */
export async function loginClientId(store, userId) {
  const user = isUuid(userId) ? await repoFor(store).getUser(userId) : null;
  return user ? user.client_id : null;
}

export async function deleteLogin(store, userId) {
  if (!isUuid(userId) || !(await repoFor(store).deleteUser(userId))) throw notFound('login');
}

/** A signed-in client choosing their own password. Other devices are signed out. */
export async function changeOwnPassword(store, session, { current, next }) {
  const repo = repoFor(store);
  const user = await repo.getUser(session.userId);
  if (!user) throw notFound('login');

  if (!(await verifyPassword(current, user.password_hash))) {
    throw new PortalError('That is not your current password.', { code: 'bad_credentials', status: 400, field: 'current' });
  }
  const chosen = String(next ?? '');
  if (chosen.length < PASSWORD_MIN || chosen.length > PASSWORD_MAX) {
    throw new PortalError(`Choose a password of at least ${PASSWORD_MIN} characters.`, { code: 'password_weak', field: 'next' });
  }
  if (chosen === String(current)) {
    throw new PortalError('Choose a password that is different from your current one.', { code: 'password_same', field: 'next' });
  }
  await repo.setPassword(user.id, await hashPassword(chosen), 'user');
  await repo.deleteUserSessions(user.id, session.tokenHash);
}

/* ============================================================ operators === */

export const isStaff = (session) => Boolean(session) && (session.role === 'admin' || session.role === 'operator');

/**
 * Which clients a staff session may work on: null means all of them (masters and
 * the bootstrap owner), otherwise the set of assigned client ids.
 */
export async function clientScope(store, session) {
  if (!isStaff(session)) return new Set();
  if (session.isMaster) return null;
  return new Set(await repoFor(store).assignedClientIds(session.operatorId));
}

/** True when the session may work on this client. */
export async function canAccessClient(store, session, clientId) {
  const scope = await clientScope(store, session);
  return scope === null || scope.has(clientId);
}

const OPERATOR_ROLES = new Set(['master', 'operator']);

const operatorOut = (row, clientIds = []) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  passwordSetBy: row.password_set_by,
  lastLoginAt: iso(row.last_login_at),
  createdAt: iso(row.created_at),
  clientIds,
});

/** Everything the operators console shows, in one round trip. */
export async function listOperators(store) {
  const repo = repoFor(store);
  const [operators, assignments, clients] = await Promise.all([repo.listOperators(), repo.listAssignments(), repo.listClients()]);
  return {
    operators: operators.map((o) => operatorOut(o, assignments.filter((a) => a.operator_id === o.id).map((a) => a.client_id))),
    clients: clients.map(clientOut),
  };
}

export async function createOperator(store, { name, email, role }) {
  const repo = repoFor(store);
  const identity = normalizeLoginEmail(email);
  if (identity.key === config.portal.adminEmail) {
    throw new PortalError('That address is the Accessrank owner login. Use a different email.', { code: 'email_reserved', field: 'email' });
  }
  if (await repo.findUserByEmailKey(identity.key)) {
    throw new PortalError('That address already has a client login. Use a different email.', { code: 'email_taken', status: 409, field: 'email' });
  }
  const cleanName = cleanText(name, 120);
  if (cleanName.length < 2) throw new PortalError('Enter the operator\u2019s name.', { code: 'name_required', field: 'name' });
  const chosen = OPERATOR_ROLES.has(role) ? role : 'operator';

  const password = generatePassword();
  const row = await repo.insertOperator({
    name: cleanName, email: identity.email, emailKey: identity.key, passwordHash: await hashPassword(password), role: chosen,
  });
  if (!row) {
    throw new PortalError('That email is already an operator. Reset its password instead.', { code: 'email_taken', status: 409, field: 'email' });
  }
  return { operator: operatorOut(row), password };
}

async function operatorOrThrow(repo, id) {
  const op = isUuid(id) ? await repo.getOperator(id) : null;
  if (!op) throw notFound('operator');
  return op;
}

/** Change an operator's role. Nobody can demote themselves, and the last master stays a master. */
export async function setOperatorRole(store, session, id, role) {
  const repo = repoFor(store);
  const op = await operatorOrThrow(repo, id);
  if (!OPERATOR_ROLES.has(role)) throw new PortalError('Choose master or operator.', { code: 'bad_role', field: 'role' });
  if (op.role === role) return operatorOut(op, await repo.assignedClientIds(op.id));
  if (role === 'operator') {
    if (session.operatorId === op.id) {
      throw new PortalError('You cannot remove your own master access. Ask another master to do it.', { code: 'self_demote', status: 409 });
    }
    if (op.role === 'master' && (await repo.countMasters()) <= 1) {
      throw new PortalError('There must be at least one master operator.', { code: 'last_master', status: 409 });
    }
  }
  await repo.setOperatorRole(op.id, role);
  // The role is read from the row on every request, so this takes effect at once.
  return operatorOut({ ...op, role }, await repo.assignedClientIds(op.id));
}

export async function resetOperatorPassword(store, id) {
  const repo = repoFor(store);
  const op = await operatorOrThrow(repo, id);
  const password = generatePassword();
  await repo.setOperatorPassword(op.id, await hashPassword(password), 'admin');
  await repo.deleteOperatorSessions(op.id);
  return { operator: operatorOut({ ...op, password_set_by: 'admin' }), password };
}

export async function deleteOperator(store, session, id) {
  const repo = repoFor(store);
  const op = await operatorOrThrow(repo, id);
  if (session.operatorId === op.id) {
    throw new PortalError('You cannot remove your own operator login. Ask another master to do it.', { code: 'self_delete', status: 409 });
  }
  if (op.role === 'master' && (await repo.countMasters()) <= 1) {
    throw new PortalError('There must be at least one master operator.', { code: 'last_master', status: 409 });
  }
  await repo.deleteOperator(op.id);
}

/** Replace the set of clients an operator works on. */
export async function setOperatorClients(store, id, clientIds) {
  const repo = repoFor(store);
  const op = await operatorOrThrow(repo, id);
  const wanted = [...new Set((Array.isArray(clientIds) ? clientIds : []).map(String))];
  const known = new Set((await repo.listClients()).map((c) => c.id));
  if (wanted.some((c) => !known.has(c))) throw notFound('client');
  await repo.setAssignments(op.id, wanted);
  return operatorOut(op, wanted);
}

/** An operator choosing their own password. Their other sessions are signed out. */
export async function changeOwnOperatorPassword(store, session, { current, next }) {
  const repo = repoFor(store);
  const op = session.operatorId ? await repo.getOperator(session.operatorId) : null;
  if (!op) throw notFound('operator');
  if (!(await verifyPassword(current, op.password_hash))) {
    throw new PortalError('That is not your current password.', { code: 'bad_credentials', status: 400, field: 'current' });
  }
  const chosen = String(next ?? '');
  if (chosen.length < PASSWORD_MIN || chosen.length > PASSWORD_MAX) {
    throw new PortalError(`Choose a password of at least ${PASSWORD_MIN} characters.`, { code: 'password_weak', field: 'next' });
  }
  if (chosen === String(current)) {
    throw new PortalError('Choose a password that is different from your current one.', { code: 'password_same', field: 'next' });
  }
  await repo.setOperatorPassword(op.id, await hashPassword(chosen), 'user');
  await repo.deleteOperatorSessions(op.id, session.tokenHash);
}

/* ================================================================ files === */

export async function listClientFiles(store, clientId) {
  return (await repoFor(store).listFiles(clientId)).map(fileOut);
}

export const FILE_AREAS = new Set(['files', 'compliance', 'approvals']);

/* ===================================================== team repository === */

const teamFileOut = (row) => ({
  id: row.id,
  name: row.filename,
  size: row.size_bytes,
  addedByName: row.added_by_name || '',
  addedByEmail: row.added_by_email || '',
  createdAt: iso(row.created_at),
});

/** The shared drawer for master operators. Callers must already have checked the session is a master. */
export async function listTeamFiles(store) {
  return (await repoFor(store).listTeamFiles()).map(teamFileOut);
}

export async function addTeamFile(store, session, { filename, data }) {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new PortalError('That file is empty.', { code: 'file_empty' });
  }
  const name = sanitizeFilename(filename);
  return teamFileOut(await repoFor(store).insertTeamFile({
    filename: name,
    contentType: contentTypeFor(name),
    data,
    addedByName: String(session.name ?? '').slice(0, 120),
    addedByEmail: String(session.email ?? '').slice(0, 254),
  }));
}

const teamNoteOut = (row) => ({
  id: row.id,
  fileId: row.file_id ?? null,
  taskId: row.task_id ?? null,
  body: row.body,
  authorName: row.author_name || '',
  authorEmail: row.author_email || '',
  createdAt: iso(row.created_at),
  updatedAt: row.updated_at ? iso(row.updated_at) : null,
});

const teamTaskOut = (row) => ({
  id: row.id,
  text: row.text,
  done: Boolean(row.done),
  doneAt: row.done_at ? iso(row.done_at) : null,
  authorName: row.author_name || '',
  authorEmail: row.author_email || '',
  createdAt: iso(row.created_at),
  updatedAt: row.updated_at ? iso(row.updated_at) : null,
});

/** Every note that belongs to a file, oldest first; the page groups them by `fileId`. */
export async function listTeamNotes(store) {
  return (await repoFor(store).listTeamNotes()).map(teamNoteOut);
}

function cleanNoteBody(rawBody) {
  const body = String(rawBody ?? '').replace(/\r\n?/g, '\n').trim();
  if (!body) throw new PortalError('Write a note first.', { code: 'note_empty', field: 'body' });
  if (body.length > 2000) throw new PortalError('Keep a note to 2,000 characters.', { code: 'note_long', field: 'body' });
  return body;
}

/**
 * Add a note under a file or a task (`target` is `{ fileId }` or `{ taskId }`). The author is
 * always the signed-in session, never anything the browser sends.
 */
export async function addTeamNote(store, session, target, rawBody) {
  const body = cleanNoteBody(rawBody);
  const fileId = target.fileId || null;
  const taskId = target.taskId || null;
  if (Boolean(fileId) === Boolean(taskId)) throw new PortalError('A note belongs to one file or one task.', { code: 'note_target' });
  if (!isUuid(fileId ?? taskId)) throw notFound(fileId ? 'file' : 'task');
  const row = await repoFor(store).insertTeamNote({
    fileId,
    taskId,
    body,
    authorName: String(session.name ?? '').slice(0, 120),
    authorEmail: String(session.email ?? '').slice(0, 254),
  });
  if (!row) throw notFound(fileId ? 'file' : 'task');
  return teamNoteOut(row);
}

/** Change a note's text. The author and original time stay; `updatedAt` marks the edit. */
export async function updateTeamNote(store, id, rawBody) {
  const body = cleanNoteBody(rawBody);
  const row = isUuid(id) ? await repoFor(store).updateTeamNote(id, body) : null;
  if (!row) throw notFound('note');
  return teamNoteOut(row);
}

export async function deleteTeamNote(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteTeamNote(id))) throw notFound('note');
}

function cleanTaskText(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new PortalError('Write the task first.', { code: 'task_empty', field: 'text' });
  if (text.length > 300) throw new PortalError('Keep a task to 300 characters.', { code: 'task_long', field: 'text' });
  return text;
}

export async function listTeamTasks(store) {
  return (await repoFor(store).listTeamTasks()).map(teamTaskOut);
}

export async function addTeamTask(store, session, rawText) {
  return teamTaskOut(await repoFor(store).insertTeamTask({
    text: cleanTaskText(rawText),
    authorName: String(session.name ?? '').slice(0, 120),
    authorEmail: String(session.email ?? '').slice(0, 254),
  }));
}

/** `changes` may hold `text` and/or `done`; anything left out stays as it was. */
export async function updateTeamTask(store, id, changes) {
  const text = changes.text === undefined ? null : cleanTaskText(changes.text);
  const done = changes.done === undefined ? null : Boolean(changes.done);
  if (text === null && done === null) throw new PortalError('Nothing to change.', { code: 'task_nochange' });
  const row = isUuid(id) ? await repoFor(store).updateTeamTask(id, { text, done }) : null;
  if (!row) throw notFound('task');
  return teamTaskOut(row);
}

export async function deleteTeamTask(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteTeamTask(id))) throw notFound('task');
}

export async function getTeamFile(store, id) {
  if (!isUuid(id)) return null;
  return repoFor(store).getTeamFile(id);
}

export async function deleteTeamFile(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteTeamFile(id))) throw notFound('file');
}

export async function addFile(store, clientId, { filename, data, area = 'files' }) {
  const repo = repoFor(store);
  if (!isUuid(clientId) || !(await repo.getClient(clientId))) throw notFound('client');
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new PortalError('That file is empty.', { code: 'file_empty' });
  }
  const name = sanitizeFilename(filename);
  if (!FILE_AREAS.has(area)) throw new PortalError('Choose Files, Compliance files or Past approvals.', { code: 'bad_area', field: 'area' });
  return fileOut(await repo.insertFile({ clientId, filename: name, contentType: contentTypeFor(name), data, area }));
}

/* ============================================================== reports === */

export const REPORT_TITLE_MAX = 160;
const ITEM_KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const DECISIONS = new Set(['approve', 'changes', 'comment']);

/**
 * Publish a report page into one client's portal. The page is trusted content
 * written by the team (only an admin session reaches this), but it is still
 * required to look like a whole HTML document so a stray upload is caught early.
 */
export async function addReport(store, clientId, { title, html }) {
  const repo = repoFor(store);
  if (!isUuid(clientId) || !(await repo.getClient(clientId))) throw notFound('client');
  const text = typeof html === 'string' ? html : '';
  if (!text.trim()) throw new PortalError('That report is empty.', { code: 'file_empty' });
  if (!/<html[\s>]/i.test(text) || !/<\/html>/i.test(text)) {
    throw new PortalError('A report must be a complete HTML page.', { code: 'not_html', status: 415 });
  }
  const name = cleanText(title, REPORT_TITLE_MAX);
  if (name.length < 2) throw new PortalError('Give the report a title.', { code: 'title_required', field: 'title' });
  return reportOut(await repo.insertReport({ clientId, title: name, html: text }));
}

/** A client's reports, each with where its approvals stand. */
export async function listReports(store, clientId) {
  const repo = repoFor(store);
  const [reports, latest] = await Promise.all([repo.listReports(clientId), repo.latestApprovals()]);
  const mine = new Set(reports.map((r) => r.id));
  const byReport = new Map();
  for (const a of latest) if (mine.has(a.report_id)) (byReport.get(a.report_id) ?? byReport.set(a.report_id, []).get(a.report_id)).push(a);
  return reports.map((r) => ({ ...reportOut(r), progress: progressOf(byReport.get(r.id) ?? []) }));
}

/** A comment that was cleared is kept as history but is no longer an answer. */
const hasAnswer = (a) => !(a.decision === 'comment' && !a.comment);

function progressOf(rows) {
  const counts = { approved: 0, changes: 0, comments: 0 };
  let lastAt = null;
  for (const a of rows) {
    if (a.decision === 'approve') counts.approved += 1;
    else if (a.decision === 'changes') counts.changes += 1;
    else if (a.comment) counts.comments += 1;
    const at = iso(a.created_at);
    if (!lastAt || at > lastAt) lastAt = at;
  }
  return { ...counts, lastAt };
}

/** Close a report once the team has finished with it, or reopen it. Its answers are kept either way. */
export async function setReportStatus(store, session, id, status) {
  if (status !== 'open' && status !== 'closed') {
    throw new PortalError('Choose open or closed.', { code: 'bad_status', field: 'status' });
  }
  const row = isUuid(id)
    ? await repoFor(store).setReportStatus(id, status, session.name ? `${session.name} <${session.email}>` : session.email)
    : null;
  if (!row) throw notFound('report');
  return reportOut(row);
}

const csvCell = (value) => {
  let text = String(value ?? '');
  // A spreadsheet runs a cell that starts with these as a formula; a leading quote defuses it.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The permanent record of a report: every answer ever saved, newest first, with
 * who gave it and when, and whether it is still the current answer.
 */
export async function approvalsRecordCsv(store, report) {
  const repo = repoFor(store);
  const [history, client] = await Promise.all([repo.approvalHistory(report.id), repo.getClient(report.client_id)]);
  const latestId = new Map();
  for (const a of history) if (!latestId.has(a.item_key)) latestId.set(a.item_key, a.id); // history is newest first
  const head = ['Client', 'Report', 'Report status', 'Item', 'Decision', 'Option chosen', 'Comment', 'Answered by', 'Email', 'Decided at', 'Saved at', 'Current answer'];
  const rows = history.map((a) => [
    client?.name ?? '', report.title, report.status ?? 'open', a.item_title || a.item_key,
    DECISION_WORDS[a.decision] ?? a.decision, a.choice, a.comment, a.signer_name, a.user_email,
    iso(a.decided_at) ?? '', iso(a.created_at), latestId.get(a.item_key) === a.id ? 'yes' : 'no',
  ]);
  return `\uFEFF${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
const DECISION_WORDS = { approve: 'Approved', changes: 'Changes requested', comment: 'Comment' };

/** The report row including its HTML, or null. The caller decides who may have it. */
export async function getReport(store, id) {
  if (!isUuid(id)) return null;
  return repoFor(store).getReport(id);
}

export async function deleteReport(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteReport(id))) throw notFound('report');
}

/**
 * Record a client's answers. Only answers that differ from what is already on
 * file are written, so pressing Submit twice adds nothing, and a changed answer
 * adds one new row while the old one stays as history.
 */
export async function saveApprovals(store, session, report, { name, items }) {
  if (report.status === 'closed') {
    throw new PortalError('This approval is closed, so it no longer takes answers. Contact your Accessrank team to reopen it.', {
      code: 'report_closed', status: 409,
    });
  }
  const signerName = cleanText(name, 120);
  if (signerName.length < 2) {
    throw new PortalError('Enter your name. It is recorded with each approval.', { code: 'name_required', field: 'name' });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
    throw new PortalError('There is nothing to save yet.', { code: 'no_items' });
  }
  const repo = repoFor(store);
  const current = new Map((await repo.latestApprovals(report.id)).map((a) => [a.item_key, a]));
  const seen = new Set();
  const rows = [];
  let unchanged = 0;

  for (const raw of items) {
    const key = String(raw?.key ?? '');
    if (!ITEM_KEY_RE.test(key) || seen.has(key)) {
      throw new PortalError('One of the answers could not be read.', { code: 'bad_item', field: key || undefined });
    }
    seen.add(key);
    const decision = String(raw.decision ?? '');
    if (!DECISIONS.has(decision)) {
      throw new PortalError('One of the answers could not be read.', { code: 'bad_item', field: key });
    }
    const row = {
      reportId: report.id,
      clientId: report.client_id,
      userId: session.userId ?? null,
      userEmail: session.email,
      signerName,
      key,
      title: cleanText(raw.title, 200),
      decision,
      choice: cleanText(raw.choice, 200),
      comment: String(raw.comment ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 5000),
      decidedAt: validDate(raw.decidedAt),
    };
    const have = current.get(key);
    // An empty comment is not an answer, unless it clears one already saved: that
    // is recorded as a new, empty row so the old text stops being the current one.
    if (decision === 'comment' && !row.comment && !have?.comment) continue;
    if (have && have.decision === row.decision && have.choice === row.choice && have.comment === row.comment) {
      unchanged += 1;
      continue;
    }
    row.decidedAt = decidedAtFor(have, row, raw.decidedAt);
    rows.push(row);
  }
  if (rows.length) await repo.insertApprovals(rows);
  return {
    saved: rows.length,
    unchanged,
    changes: rows.map((r) => ({ key: r.key, title: r.title, decision: r.decision, choice: r.choice, comment: r.comment })),
    signerName,
  };
}

/**
 * When an answer was given. The page sends the time it stamped, but the server
 * does not let that carry an old time onto a new answer: if the decision or the
 * option changed, the stamp must be newer than the one it replaces, otherwise it
 * is the time of this save. A comment-only edit keeps the original time.
 */
function decidedAtFor(have, row, sent) {
  const claimed = validDate(sent);
  const before = have?.decided_at ? new Date(have.decided_at).toISOString() : null;
  if (have && have.decision === row.decision && have.choice === row.choice) return before ?? claimed;
  if (row.decision === 'comment') return claimed;
  if (claimed && (!before || claimed > before)) return claimed;
  return new Date().toISOString();
}

function validDate(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const t = Date.parse(value);
  // A client clock a day ahead or years behind is not worth storing.
  if (!Number.isFinite(t) || Math.abs(t - Date.now()) > 7 * 86_400_000) return null;
  return new Date(t).toISOString();
}

/** Each item's current answer for one report. */
export async function currentApprovals(store, reportId) {
  return (await repoFor(store).latestApprovals(reportId)).filter(hasAnswer).map(approvalOut)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * What the team sees: every report that has any answers, newest activity first,
 * with each item's current answer and who gave it.
 */
export async function adminApprovals(store, scope = null) {
  const repo = repoFor(store);
  const [allReports, clients, latest] = await Promise.all([repo.listReports(), repo.listClients(), repo.latestApprovals()]);
  const reports = scope ? allReports.filter((r) => scope.has(r.client_id)) : allReports;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const byReport = new Map();
  for (const a of latest) if (hasAnswer(a)) (byReport.get(a.report_id) ?? byReport.set(a.report_id, []).get(a.report_id)).push(a);
  return reports
    .map((r) => {
      const rows = byReport.get(r.id) ?? [];
      return {
        ...reportOut(r),
        clientName: clientName.get(r.client_id) ?? '',
        progress: progressOf(rows),
        items: rows.map(approvalOut).sort((a, b) => (a.key < b.key ? -1 : 1)),
      };
    })
    .sort((a, b) => String(b.progress.lastAt ?? b.createdAt).localeCompare(String(a.progress.lastAt ?? a.createdAt)));
}

/** Every answer ever recorded for one report, newest first. */
export async function approvalHistory(store, reportId) {
  if (!isUuid(reportId)) throw notFound('report');
  return (await repoFor(store).approvalHistory(reportId)).map(approvalOut);
}

/** The file row including its bytes, or null. The caller decides who may have it. */
export async function getFile(store, id) {
  if (!isUuid(id)) return null;
  return repoFor(store).getFile(id);
}

/** Move a file between the client's Compliance files and Other files. */
export async function setFileArea(store, id, rawArea) {
  const area = String(rawArea ?? '');
  if (!FILE_AREAS.has(area)) throw new PortalError('Choose Files, Compliance files or Past approvals.', { code: 'bad_area', field: 'area' });
  const row = isUuid(id) ? await repoFor(store).setFileArea(id, area) : null;
  if (!row) throw notFound('file');
  return row;
}

export async function deleteFile(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteFile(id))) throw notFound('file');
}

export default {
  PortalError, hashPassword, verifyPassword, generatePassword,
  signIn, signOut, sessionFor, setSessionCookie, clearSessionCookie,
  adminOverview, createClient, createClientWithSetup, renameClient, deleteClient,
  createLogin, resetLoginPassword, deleteLogin, changeOwnPassword,
  listClientFiles, addFile, getFile, deleteFile, setFileArea,
  listTeamFiles, addTeamFile, getTeamFile, deleteTeamFile, listTeamNotes, addTeamNote, updateTeamNote, deleteTeamNote,
  listTeamTasks, addTeamTask, updateTeamTask, deleteTeamTask,
  addReport, listReports, getReport, deleteReport, saveApprovals, currentApprovals, adminApprovals, approvalHistory,
  setReportStatus, approvalsRecordCsv, loginClientId, isStaff, clientScope, canAccessClient, listOperators, createOperator, setOperatorRole, resetOperatorPassword,
  deleteOperator, setOperatorClients, changeOwnOperatorPassword,
};
