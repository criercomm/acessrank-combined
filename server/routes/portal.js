import express from 'express';
import { z } from 'zod';
import config from '../lib/config.js';
import { log } from '../lib/logger.js';
import { getStore } from '../lib/store.js';
import { hashIp, clientIp } from '../lib/identity.js';
import { parseOrThrow } from '../lib/validate.js';
import {
  PortalError, signIn, signOut, sessionFor, setSessionCookie, clearSessionCookie,
  adminOverview, createClient, renameClient, deleteClient,
  createLogin, resetLoginPassword, deleteLogin, changeOwnPassword,
  listClientFiles, addFile, getFile, deleteFile, contentDisposition, PASSWORD_MAX,
} from '../lib/portal.js';

/**
 * Client portal API, mounted at /api/portal.
 *
 *   anyone          POST /login
 *   signed in       POST /logout · GET /me · GET /files/:id · POST /password
 *   admin only      everything under /admin
 *
 * The one rule that matters: a client session can reach its own client's rows
 * and nothing else. Every client-facing handler takes the client id from the
 * SESSION, never from the request, and the single route that accepts an id from
 * the URL (file download) compares it to the session before sending a byte.
 */

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Nothing here is ever safe for a shared cache or the back button after sign-out.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

/* -------------------------------------------------------------- guards --- */

const requireSession = (role = null) => wrap(async (req, res, next) => {
  const session = await sessionFor(await getStore(), req);
  if (!session) {
    throw new PortalError('Your session has ended. Sign in again.', { code: 'signed_out', status: 401 });
  }
  if (role && session.role !== role) {
    // 404, not 403: a client login should not be able to confirm the admin API exists.
    throw new PortalError('Not found.', { code: 'not_found', status: 404 });
  }
  req.portal = session;
  next();
});

/* ------------------------------------------------------------- schemas --- */

const loginSchema = z.object({
  email: z.string().trim().min(3, 'Enter your email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX),
});

const passwordSchema = z.object({
  current: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX),
  next: z.string().min(1, 'Enter a new password.').max(PASSWORD_MAX),
});

const clientSchema = z.object({
  name: z.string().trim().min(1, 'Enter the client\u2019s company name.').max(200),
});

const loginCreateSchema = z.object({
  name: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().min(3, 'Enter the email address this person will sign in with.').max(254),
});

/* ------------------------------------------------------------- session --- */

router.post('/login', wrap(async (req, res) => {
  const input = parseOrThrow(loginSchema, req.body);
  const store = await getStore();
  const session = await signIn(store, { ...input, ipHash: hashIp(clientIp(req)) });
  setSessionCookie(res, session.token, session.maxAgeSeconds);
  res.json({ ok: true, role: session.role, next: session.role === 'admin' ? '/portal/admin' : '/portal' });
}));

router.post('/logout', wrap(async (req, res) => {
  await signOut(await getStore(), req);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/me', requireSession(), wrap(async (req, res) => {
  const { portal } = req;
  if (portal.role === 'admin') {
    return res.json({ ok: true, role: 'admin', user: { email: portal.email, name: portal.name } });
  }
  res.json({
    ok: true,
    role: 'client',
    user: { email: portal.email, name: portal.name, passwordSetBy: portal.passwordSetBy },
    client: { id: portal.clientId, name: portal.clientName },
    files: await listClientFiles(await getStore(), portal.clientId),
  });
}));

router.post('/password', requireSession('client'), wrap(async (req, res) => {
  const input = parseOrThrow(passwordSchema, req.body);
  await changeOwnPassword(await getStore(), req.portal, input);
  log.info('portal client changed password', { userId: req.portal.userId });
  res.json({ ok: true });
}));

/**
 * Download. Admins may fetch any file; a client only its own client's. A file
 * that belongs to someone else answers exactly like one that does not exist.
 */
router.get('/files/:id', requireSession(), wrap(async (req, res) => {
  const file = await getFile(await getStore(), req.params.id);
  if (!file || (req.portal.role !== 'admin' && file.client_id !== req.portal.clientId)) {
    throw new PortalError('That file is no longer available.', { code: 'not_found', status: 404 });
  }
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  res.setHeader('Content-Type', file.content_type);
  res.setHeader('Content-Length', String(data.length));
  // Always an attachment: nothing a person uploads is ever rendered on this origin.
  res.setHeader('Content-Disposition', contentDisposition(file.filename));
  res.end(data);
}));

/* --------------------------------------------------------------- admin --- */

const admin = express.Router();
admin.use(requireSession('admin'));

admin.get('/clients', wrap(async (req, res) => {
  res.json({
    ok: true,
    maxFileBytes: config.portal.maxFileMb * 1024 * 1024,
    clients: await adminOverview(await getStore()),
  });
}));

admin.post('/clients', wrap(async (req, res) => {
  const { name } = parseOrThrow(clientSchema, req.body);
  const client = await createClient(await getStore(), name);
  log.info('portal client created', { clientId: client.id });
  res.status(201).json({ ok: true, client });
}));

admin.patch('/clients/:id', wrap(async (req, res) => {
  const { name } = parseOrThrow(clientSchema, req.body);
  res.json({ ok: true, client: await renameClient(await getStore(), req.params.id, name) });
}));

admin.delete('/clients/:id', wrap(async (req, res) => {
  await deleteClient(await getStore(), req.params.id);
  log.info('portal client deleted', { clientId: req.params.id });
  res.json({ ok: true });
}));

admin.post('/clients/:id/logins', wrap(async (req, res) => {
  const input = parseOrThrow(loginCreateSchema, req.body);
  const created = await createLogin(await getStore(), req.params.id, input);
  log.info('portal login created', { userId: created.user.id, clientId: req.params.id });
  // The password is returned once, here, and is never retrievable again.
  res.status(201).json({ ok: true, ...created });
}));

admin.post('/logins/:id/reset', wrap(async (req, res) => {
  const reset = await resetLoginPassword(await getStore(), req.params.id);
  log.info('portal login password reset', { userId: req.params.id });
  res.json({ ok: true, ...reset });
}));

admin.delete('/logins/:id', wrap(async (req, res) => {
  await deleteLogin(await getStore(), req.params.id);
  log.info('portal login deleted', { userId: req.params.id });
  res.json({ ok: true });
}));

/**
 * Upload one file: the raw bytes are the request body and the name rides in the
 * query string.
 *
 * Deliberately not multipart — that would need a parsing dependency for no gain,
 * since the admin page sends files one at a time anyway. The body is always
 * application/octet-stream so the global JSON parser (and its 100 kB ceiling)
 * never sees it, whatever kind of file it is.
 */
admin.post(
  '/clients/:id/files',
  express.raw({ type: 'application/octet-stream', limit: `${config.portal.maxFileMb}mb` }),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      // body-parser leaves an empty body unparsed, so "no Buffer" is either a
      // zero-byte file or a request that was not sent as octet-stream at all.
      if (req.is('application/octet-stream') !== false) {
        throw new PortalError('That file is empty.', { code: 'file_empty' });
      }
      throw new PortalError('Upload the file as application/octet-stream.', { code: 'bad_upload', status: 415 });
    }
    const file = await addFile(await getStore(), req.params.id, {
      filename: typeof req.query.name === 'string' ? req.query.name : '',
      data: req.body,
    });
    log.info('portal file uploaded', { fileId: file.id, clientId: req.params.id, bytes: file.size });
    res.status(201).json({ ok: true, file });
  }),
);

admin.delete('/files/:id', wrap(async (req, res) => {
  await deleteFile(await getStore(), req.params.id);
  log.info('portal file deleted', { fileId: req.params.id });
  res.json({ ok: true });
}));

router.use('/admin', admin);

/* -------------------------------------------------------------- errors --- */

router.use((req, res) => {
  res.status(404).json({ ok: false, code: 'not_found', error: 'Not found.' });
});

router.use((err, req, res, _next) => {
  let status = err.status ?? 500;
  let message = err.public === true ? err.message : 'Something went wrong on our side. Please try again.';
  let code = err.code ?? 'error';

  // body-parser's "too large" error carries no public flag of its own.
  if (err.type === 'entity.too.large') {
    status = 413;
    code = 'file_too_large';
    message = `That file is over the ${config.portal.maxFileMb} MB limit.`;
  }
  // An expired or revoked session: drop the dead cookie so the browser stops sending it.
  if (code === 'signed_out') clearSessionCookie(res);

  if (status >= 500) {
    log.error('portal api error', { err: err.message, code, path: req.path, stack: err.stack?.split('\n')[1] });
  } else {
    log.info('portal api rejected', { code, path: req.path, status });
  }

  res.status(status).json({ ok: false, code, field: err.field ?? undefined, error: message });
});

/* ---------------------------------------------------------- page gates --- */

/**
 * Guards the portal PAGES (not the API): /portal needs any session,
 * /portal/admin needs the admin one. Without it the visitor is sent to the
 * sign-in page rather than shown an empty shell.
 *
 * The pages hold no client data themselves — everything comes from the API
 * above, which checks the session again on every call — so this is about not
 * showing a broken page, and about keeping the admin screen's existence private.
 */
export const portalPageGate = wrap(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.setHeader('Cache-Control', 'private, no-store');

  let session = null;
  try {
    session = await sessionFor(await getStore(), req);
  } catch (err) {
    log.error('portal gate could not read the session', { err: err.message });
  }

  if (!session) return res.redirect(302, '/client-login');
  const wantsAdmin = req.path === '/admin' || req.path.startsWith('/admin/');
  if (wantsAdmin && session.role !== 'admin') return res.redirect(302, '/portal');
  if (!wantsAdmin && session.role === 'admin') return res.redirect(302, '/portal/admin');
  return next();
});

/** Someone already signed in who opens the sign-in page goes straight to their portal. */
export const loginPageGate = wrap(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const session = await sessionFor(await getStore(), req);
    if (session) return res.redirect(302, session.role === 'admin' ? '/portal/admin' : '/portal');
  } catch (err) {
    log.error('portal gate could not read the session', { err: err.message });
  }
  return next();
});

export default router;
