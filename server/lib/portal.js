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
  createdAt: iso(row.created_at),
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

    async insertSession({ tokenHash, role, userId, expiresAt, ipHash }) {
      await q(
        'INSERT INTO portal_sessions (token_hash, role, user_id, expires_at, ip_hash) VALUES ($1, $2, $3, $4, $5)',
        [tokenHash, role, userId ?? null, expiresAt, ipHash ?? null],
      );
    },
    async getSession(tokenHash) {
      const { rows } = await q(
        `SELECT s.role, s.user_id, s.expires_at,
                u.email, u.name AS user_name, u.client_id, u.password_set_by,
                c.name AS client_name
           FROM portal_sessions s
           LEFT JOIN portal_users u   ON u.id = s.user_id
           LEFT JOIN portal_clients c ON c.id = u.client_id
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
      const cols = 'id, client_id, filename, size_bytes, created_at';
      return clientId
        ? (await q(`SELECT ${cols} FROM portal_files WHERE client_id = $1 ORDER BY created_at DESC`, [clientId])).rows
        : (await q(`SELECT ${cols} FROM portal_files ORDER BY created_at DESC`)).rows;
    },
    async insertFile({ clientId, filename, contentType, data }) {
      return (await q(
        `INSERT INTO portal_files (client_id, filename, content_type, size_bytes, data)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, client_id, filename, size_bytes, created_at`,
        [clientId, filename, contentType, data.length, data],
      )).rows[0];
    },
    async getFile(id) {
      return (await q('SELECT * FROM portal_files WHERE id = $1', [id])).rows[0] ?? null;
    },
    async deleteFile(id) {
      return (await q('DELETE FROM portal_files WHERE id = $1', [id])).rowCount > 0;
    },
  };
}

/** In-memory implementation, for development and tests. Same contract as pgRepo. */
function memRepo(store) {
  store._portal ??= { clients: new Map(), users: new Map(), sessions: new Map(), files: new Map() };
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

    async insertSession({ tokenHash, role, userId, expiresAt, ipHash }) {
      db.sessions.set(tokenHash, { role, user_id: userId ?? null, expires_at: expiresAt, ip_hash: ipHash ?? null });
    },
    async getSession(tokenHash) {
      const session = db.sessions.get(tokenHash);
      if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
      const user = session.user_id ? db.users.get(session.user_id) : null;
      const client = user ? db.clients.get(user.client_id) : null;
      return {
        role: session.role, user_id: session.user_id, expires_at: session.expires_at,
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
    async insertFile({ clientId, filename, contentType, data }) {
      const row = {
        id: crypto.randomUUID(), created_at: now(), client_id: clientId,
        filename, content_type: contentType, size_bytes: data.length, data,
      };
      db.files.set(row.id, row);
      return row;
    },
    async getFile(id) { return db.files.get(id) ?? null; },
    async deleteFile(id) { return db.files.delete(id); },
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

async function openSession(store, { role, userId = null, ipHash }) {
  const repo = repoFor(store);
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAgeSeconds = role === 'admin'
    ? config.portal.adminSessionHours * 3600
    : config.portal.clientSessionDays * 86_400;
  await repo.insertSession({
    tokenHash: hashToken(token),
    role,
    userId,
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
    return { role: 'admin', tokenHash, email: config.portal.adminEmail, name: 'Accessrank team' };
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
export async function adminOverview(store) {
  const repo = repoFor(store);
  const [clients, users, files] = await Promise.all([repo.listClients(), repo.listUsers(), repo.listFiles()]);
  return clients.map((client) => ({
    ...clientOut(client),
    users: users.filter((u) => u.client_id === client.id).map(userOut),
    files: files.filter((f) => f.client_id === client.id).map(fileOut),
  }));
}

export async function createClient(store, rawName) {
  return { ...clientOut(await repoFor(store).insertClient(cleanClientName(rawName))), users: [], files: [] };
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

/* ================================================================ files === */

export async function listClientFiles(store, clientId) {
  return (await repoFor(store).listFiles(clientId)).map(fileOut);
}

export async function addFile(store, clientId, { filename, data }) {
  const repo = repoFor(store);
  if (!isUuid(clientId) || !(await repo.getClient(clientId))) throw notFound('client');
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new PortalError('That file is empty.', { code: 'file_empty' });
  }
  const name = sanitizeFilename(filename);
  return fileOut(await repo.insertFile({ clientId, filename: name, contentType: contentTypeFor(name), data }));
}

/** The file row including its bytes, or null. The caller decides who may have it. */
export async function getFile(store, id) {
  if (!isUuid(id)) return null;
  return repoFor(store).getFile(id);
}

export async function deleteFile(store, id) {
  if (!isUuid(id) || !(await repoFor(store).deleteFile(id))) throw notFound('file');
}

export default {
  PortalError, hashPassword, verifyPassword, generatePassword,
  signIn, signOut, sessionFor, setSessionCookie, clearSessionCookie,
  adminOverview, createClient, renameClient, deleteClient,
  createLogin, resetLoginPassword, deleteLogin, changeOwnPassword,
  listClientFiles, addFile, getFile, deleteFile,
};
