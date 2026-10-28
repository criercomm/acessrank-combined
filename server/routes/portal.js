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
  listClientFiles, addFile, getFile, deleteFile, setFileArea, contentDisposition, PASSWORD_MAX,
  addReport, listReports, getReport, deleteReport, saveApprovals, currentApprovals, adminApprovals, approvalHistory,
  setReportStatus, approvalsRecordCsv, loginClientId, isStaff, clientScope, canAccessClient, listOperators, createOperator, setOperatorRole, resetOperatorPassword,
  deleteOperator, setOperatorClients, changeOwnOperatorPassword,
} from '../lib/portal.js';
import { notifyApprovals } from '../lib/email.js';
import { reportCsp } from '../lib/reportCsp.js';

/**
 * Client portal API, mounted at /api/portal.
 *
 *   anyone          POST /login
 *   signed in       POST /logout · GET /me · GET /files/:id · POST /password
 *   client only     GET /reports · GET|POST /reports/:id/approvals
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
  // 'client' = a client login; 'staff' = the owner or any operator; 'master' = the
  // owner or a master operator. Anything else answers 404, not 403, so a client
  // login cannot confirm that the team API exists.
  const allowed = !role
    || (role === 'client' && session.role === 'client')
    || (role === 'staff' && isStaff(session))
    || (role === 'master' && isStaff(session) && session.isMaster);
  if (!allowed) {
    throw new PortalError('Not found.', { code: 'not_found', status: 404 });
  }
  req.portal = session;
  next();
});

/** An operator reaches only the clients assigned to them; anything else answers "not found". */
async function assertClient(req, clientId) {
  if (!(await canAccessClient(await getStore(), req.portal, clientId))) {
    throw new PortalError('That client no longer exists.', { code: 'not_found', status: 404 });
  }
}

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
  res.json({ ok: true, role: session.role, next: isStaff(session) ? '/portal/admin' : '/portal' });
}));

router.post('/logout', wrap(async (req, res) => {
  await signOut(await getStore(), req);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/me', requireSession(), wrap(async (req, res) => {
  const { portal } = req;
  if (isStaff(portal)) {
    return res.json({
      ok: true,
      role: portal.role,
      isMaster: Boolean(portal.isMaster),
      user: { email: portal.email, name: portal.name, passwordSetBy: portal.passwordSetBy ?? null },
    });
  }
  res.json({
    ok: true,
    role: 'client',
    user: { email: portal.email, name: portal.name, passwordSetBy: portal.passwordSetBy },
    client: { id: portal.clientId, name: portal.clientName },
    files: await listClientFiles(await getStore(), portal.clientId),
    reports: await listReports(await getStore(), portal.clientId),
  });
}));

router.post('/password', requireSession('client'), wrap(async (req, res) => {
  const input = parseOrThrow(passwordSchema, req.body);
  await changeOwnPassword(await getStore(), req.portal, input);
  log.info('portal client changed password', { userId: req.portal.userId });
  res.json({ ok: true });
}));

/* ----------------------------------------------------- reports (client) --- */

/** A client reaches its own client's reports only; anything else answers as "not found". */
async function ownReport(req) {
  const report = await getReport(await getStore(), req.params.id);
  if (!report || report.client_id !== req.portal.clientId) {
    throw new PortalError('That report is no longer available.', { code: 'not_found', status: 404 });
  }
  return report;
}

const approvalsSchema = z.object({
  name: z.string().trim().max(120),
  items: z.array(z.object({
    key: z.string().max(40),
    title: z.string().max(300).optional(),
    decision: z.string().max(20),
    choice: z.string().max(300).optional(),
    comment: z.string().max(6000).optional(),
    decidedAt: z.string().max(40).optional().nullable(),
  })).max(40),
});

router.get('/reports', requireSession('client'), wrap(async (req, res) => {
  res.json({ ok: true, reports: await listReports(await getStore(), req.portal.clientId) });
}));

router.get('/reports/:id/approvals', requireSession(), wrap(async (req, res) => {
  // A client reads their own report's answers; the team reads them for the clients they work on.
  let report;
  if (isStaff(req.portal)) {
    report = await getReport(await getStore(), req.params.id);
    if (!report || !(await canAccessClient(await getStore(), req.portal, report.client_id))) {
      throw new PortalError('That report is no longer available.', { code: 'not_found', status: 404 });
    }
  } else {
    report = await ownReport(req);
  }
  res.json({ ok: true, closed: report.status === 'closed', items: await currentApprovals(await getStore(), report.id) });
}));

router.post('/reports/:id/approvals', requireSession('client'), wrap(async (req, res) => {
  const report = await ownReport(req);
  const input = parseOrThrow(approvalsSchema, req.body);
  const store = await getStore();
  const result = await saveApprovals(store, req.portal, report, input);
  log.info('portal approvals saved', { reportId: report.id, clientId: report.client_id, userId: req.portal.userId, saved: result.saved, unchanged: result.unchanged });
  if (result.saved > 0) {
    // Told in the background: the client's answers are already saved, and a mail
    // problem must never turn that into an error on their screen.
    void notifyApprovals({
      clientName: req.portal.clientName, reportTitle: report.title, reportId: report.id,
      signerName: result.signerName, email: req.portal.email, changes: result.changes,
    });
  }
  res.status(201).json({ ok: true, saved: result.saved, unchanged: result.unchanged, savedAt: new Date().toISOString(), items: await currentApprovals(store, report.id) });
}));

/**
 * The permanent record of a report as a spreadsheet: every answer ever saved,
 * who gave it and when. The owning client and the team (for their clients) may
 * download it, whether the report is open or closed.
 */
router.get('/reports/:id/record', requireSession(), wrap(async (req, res) => {
  const store = await getStore();
  const report = await getReport(store, req.params.id);
  const allowed = report && (isStaff(req.portal)
    ? await canAccessClient(store, req.portal, report.client_id)
    : report.client_id === req.portal.clientId);
  if (!allowed) throw new PortalError('That report is no longer available.', { code: 'not_found', status: 404 });
  const csv = await approvalsRecordCsv(store, report);
  const slug = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'report';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`Approvals-record-${slug}.csv`));
  res.send(csv);
}));

/**
 * Download. Admins may fetch any file; a client only its own client's. A file
 * that belongs to someone else answers exactly like one that does not exist.
 */
router.get('/files/:id', requireSession(), wrap(async (req, res) => {
  const file = await getFile(await getStore(), req.params.id);
  const mine = file && (isStaff(req.portal)
    ? await canAccessClient(await getStore(), req.portal, file.client_id)
    : file.client_id === req.portal.clientId);
  if (!mine) {
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
admin.use(requireSession('staff'));

admin.get('/clients', wrap(async (req, res) => {
  res.json({
    ok: true,
    maxFileBytes: config.portal.maxFileMb * 1024 * 1024,
    clients: await adminOverview(await getStore(), await clientScope(await getStore(), req.portal)),
  });
}));

admin.post('/clients', requireSession('master'), wrap(async (req, res) => {
  const { name } = parseOrThrow(clientSchema, req.body);
  const client = await createClient(await getStore(), name);
  log.info('portal client created', { clientId: client.id });
  res.status(201).json({ ok: true, client });
}));

admin.patch('/clients/:id', requireSession('master'), wrap(async (req, res) => {
  const { name } = parseOrThrow(clientSchema, req.body);
  res.json({ ok: true, client: await renameClient(await getStore(), req.params.id, name) });
}));

admin.delete('/clients/:id', requireSession('master'), wrap(async (req, res) => {
  await deleteClient(await getStore(), req.params.id);
  log.info('portal client deleted', { clientId: req.params.id });
  res.json({ ok: true });
}));

admin.post('/clients/:id/logins', wrap(async (req, res) => {
  await assertClient(req, req.params.id);
  const input = parseOrThrow(loginCreateSchema, req.body);
  const created = await createLogin(await getStore(), req.params.id, input);
  log.info('portal login created', { userId: created.user.id, clientId: req.params.id });
  // The password is returned once, here, and is never retrievable again.
  res.status(201).json({ ok: true, ...created });
}));

admin.post('/logins/:id/reset', wrap(async (req, res) => {
  await assertClient(req, await loginClientId(await getStore(), req.params.id));
  const reset = await resetLoginPassword(await getStore(), req.params.id);
  log.info('portal login password reset', { userId: req.params.id });
  res.json({ ok: true, ...reset });
}));

admin.delete('/logins/:id', wrap(async (req, res) => {
  await assertClient(req, await loginClientId(await getStore(), req.params.id));
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
    await assertClient(req, req.params.id);
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
      area: req.query.area === 'compliance' ? 'compliance' : 'files',
    });
    log.info('portal file uploaded', { fileId: file.id, clientId: req.params.id, bytes: file.size });
    res.status(201).json({ ok: true, file });
  }),
);

/** Publish a report page into a client's portal. The raw body is the HTML; the title rides in the query. */
admin.post(
  '/clients/:id/reports',
  express.raw({ type: 'application/octet-stream', limit: `${config.portal.maxFileMb}mb` }),
  wrap(async (req, res) => {
    await assertClient(req, req.params.id);
    if (!Buffer.isBuffer(req.body)) {
      throw new PortalError('That report is empty.', { code: 'file_empty' });
    }
    const report = await addReport(await getStore(), req.params.id, {
      title: typeof req.query.title === 'string' ? req.query.title : '',
      html: req.body.toString('utf8'),
    });
    log.info('portal report published', { reportId: report.id, clientId: req.params.id, bytes: report.size });
    res.status(201).json({ ok: true, report });
  }),
);

const statusSchema = z.object({ status: z.enum(['open', 'closed']) });

/** Close a report (it moves to Past approvals and stops taking answers) or reopen it. */
admin.patch('/reports/:id', wrap(async (req, res) => {
  const { status } = parseOrThrow(statusSchema, req.body);
  const found = await getReport(await getStore(), req.params.id);
  await assertClient(req, found ? found.client_id : null);
  const report = await setReportStatus(await getStore(), req.portal, req.params.id, status);
  log.info('portal report status changed', { reportId: report.id, status, by: req.portal.email });
  res.json({ ok: true, report });
}));

admin.delete('/reports/:id', wrap(async (req, res) => {
  const found = await getReport(await getStore(), req.params.id);
  await assertClient(req, found ? found.client_id : null);
  await deleteReport(await getStore(), req.params.id);
  log.info('portal report deleted', { reportId: req.params.id });
  res.json({ ok: true });
}));

/** Every report's current answers, newest activity first. */
admin.get('/approvals', wrap(async (req, res) => {
  res.json({ ok: true, reports: await adminApprovals(await getStore(), await clientScope(await getStore(), req.portal)) });
}));

admin.get('/reports/:id/history', wrap(async (req, res) => {
  const found = await getReport(await getStore(), req.params.id);
  await assertClient(req, found ? found.client_id : null);
  res.json({ ok: true, history: await approvalHistory(await getStore(), req.params.id) });
}));

admin.patch('/files/:id', wrap(async (req, res) => {
  const found = await getFile(await getStore(), req.params.id);
  await assertClient(req, found ? found.client_id : null);
  const row = await setFileArea(await getStore(), req.params.id, req.body && req.body.area);
  log.info('portal file moved', { fileId: req.params.id, area: row.area });
  res.json({ ok: true, file: { id: row.id, area: row.area } });
}));

admin.delete('/files/:id', wrap(async (req, res) => {
  const found = await getFile(await getStore(), req.params.id);
  await assertClient(req, found ? found.client_id : null);
  await deleteFile(await getStore(), req.params.id);
  log.info('portal file deleted', { fileId: req.params.id });
  res.json({ ok: true });
}));


/* ------------------------------------------------------------ operators --- */

const operatorSchema = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().min(3, 'Enter the email address this operator will sign in with.').max(254),
  role: z.enum(['master', 'operator']).default('operator'),
});
const roleSchema = z.object({ role: z.enum(['master', 'operator']) });
const assignSchema = z.object({ clientIds: z.array(z.string().max(64)).max(500) });

/** Any operator may change their own password; the owner login has no password to change here. */
router.post('/operator/password', requireSession('staff'), wrap(async (req, res) => {
  if (req.portal.role !== 'operator') {
    throw new PortalError('The owner password is set in the server settings.', { code: 'not_operator', status: 400 });
  }
  const input = parseOrThrow(passwordSchema, req.body);
  await changeOwnOperatorPassword(await getStore(), req.portal, input);
  res.json({ ok: true });
}));

const operators = express.Router();
operators.use(requireSession('master'));

operators.get('/', wrap(async (req, res) => {
  res.json({ ok: true, ...(await listOperators(await getStore())) });
}));

operators.post('/', wrap(async (req, res) => {
  const input = parseOrThrow(operatorSchema, req.body);
  const created = await createOperator(await getStore(), input);
  log.info('portal operator created', { operatorId: created.operator.id, role: created.operator.role, by: req.portal.email });
  // The password is returned once, here, and is never retrievable again.
  res.status(201).json({ ok: true, ...created });
}));

operators.patch('/:id', wrap(async (req, res) => {
  const { role } = parseOrThrow(roleSchema, req.body);
  const operator = await setOperatorRole(await getStore(), req.portal, req.params.id, role);
  log.info('portal operator role changed', { operatorId: req.params.id, role, by: req.portal.email });
  res.json({ ok: true, operator });
}));

operators.post('/:id/reset', wrap(async (req, res) => {
  const reset = await resetOperatorPassword(await getStore(), req.params.id);
  log.info('portal operator password reset', { operatorId: req.params.id, by: req.portal.email });
  res.json({ ok: true, ...reset });
}));

operators.put('/:id/clients', wrap(async (req, res) => {
  const { clientIds } = parseOrThrow(assignSchema, req.body);
  const operator = await setOperatorClients(await getStore(), req.params.id, clientIds);
  log.info('portal operator clients assigned', { operatorId: req.params.id, count: operator.clientIds.length, by: req.portal.email });
  res.json({ ok: true, operator });
}));

operators.delete('/:id', wrap(async (req, res) => {
  await deleteOperator(await getStore(), req.portal, req.params.id);
  log.info('portal operator removed', { operatorId: req.params.id, by: req.portal.email });
  res.json({ ok: true });
}));

router.use('/operators', operators);

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

/* ------------------------------------------------------- report page --- */

/**
 * GET /portal/report/:id — the report itself, rendered in the browser.
 *
 * The owning client may open it, and so may the team. Anyone else, including a
 * client who guesses another client's id, gets the same 404 as a report that
 * does not exist. It is served from our origin so the page's own script can call
 * the portal API with the visitor's session; reportCsp() is what keeps that
 * script limited to the blocks that are in the document.
 */
export const reportPage = wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const session = await sessionFor(await getStore(), req);
  if (!session) return res.redirect(302, '/client-login');
  const report = await getReport(await getStore(), req.params.id);
  const allowed = report && (isStaff(session)
    ? await canAccessClient(await getStore(), session, report.client_id)
    : report.client_id === session.clientId);
  if (!allowed) {
    return res.status(404).type('text/plain').send('That report is no longer available.');
  }
  const base = res.getHeader('Content-Security-Policy');
  if (typeof base === 'string') res.setHeader('Content-Security-Policy', reportCsp(base, report.html));
  return res.type('text/html; charset=utf-8').send(report.html);
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
  const staffPage = /^\/(admin|operators|clients)(\/|$)/.test(req.path);
  if (staffPage && !isStaff(session)) return res.redirect(302, '/portal');
  if (!staffPage && isStaff(session)) return res.redirect(302, '/portal/admin');
  return next();
});

/** Someone already signed in who opens the sign-in page goes straight to their portal. */
export const loginPageGate = wrap(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const session = await sessionFor(await getStore(), req);
    if (session) return res.redirect(302, isStaff(session) ? '/portal/admin' : '/portal');
  } catch (err) {
    log.error('portal gate could not read the session', { err: err.message });
  }
  return next();
});

export default router;
