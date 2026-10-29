import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * End-to-end test of the client portal over real HTTP against the real app:
 *
 *   admin signs in -> creates a client -> creates a login -> uploads a file
 *   client signs in -> sees and downloads ONLY their own client's files
 *
 * The assertions that matter most are the negative ones: what a client login,
 * a stale session, or no session at all must never be able to reach.
 */

process.env.NODE_ENV = 'test';
process.env.IP_HASH_SALT = 'test-salt-that-is-long-enough-to-be-valid-32';
process.env.PORTAL_ADMIN_EMAIL = 'Team@Accessrank.test';
process.env.PORTAL_ADMIN_PASSWORD = 'admin-password-for-tests';
process.env.PORTAL_MAX_FILE_MB = '1';
process.env.PORTAL_LOGIN_ATTEMPTS_PER_EMAIL = '4';
// Transport-level burst guards would throttle the suite itself; the database
// lockout under test is left at the value set above.
process.env.LIMIT_API_BURST_PER_MIN = '5000';
process.env.LIMIT_PORTAL_LOGIN_BURST_PER_MIN = '5000';

const app = (await import('../../server/app.js')).default;
const { MemoryStore, _setStoreForTests } = await import('../../server/lib/store.js');
const { SESSION_COOKIE } = await import('../../server/lib/portal.js');

const ADMIN = { email: 'team@accessrank.test', password: 'admin-password-for-tests' };

let server;
let base;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  _setStoreForTests(await MemoryStore.create());
});

/* ------------------------------------------------------------- helpers --- */

/** A tiny cookie-holding client, one per signed-in person. */
function browser(ip = '203.0.113.20') {
  let cookie = '';
  const call = async (method, pathname, { json, raw, headers = {} } = {}) => {
    const response = await fetch(base + pathname, {
      method,
      redirect: 'manual',
      headers: {
        'X-Forwarded-For': ip,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(raw !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : raw,
    });
    for (const set of response.headers.getSetCookie()) {
      const [pair] = set.split(';');
      if (pair.startsWith(`${SESSION_COOKIE}=`)) cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, body };
  };
  return {
    get: (p, o) => call('GET', p, o),
    post: (p, json, o) => call('POST', p, { json: json ?? {}, ...o }),
    patch: (p, json) => call('PATCH', p, { json }),
    put: (p, json) => call('PUT', p, { json }),
    del: (p) => call('DELETE', p),
    upload: (p, raw, o) => call('POST', p, { raw, ...o }),
    login: (creds) => call('POST', '/api/portal/login', { json: creds }),
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
  };
}

async function adminBrowser() {
  const admin = browser('203.0.113.1');
  const { status } = await admin.login(ADMIN);
  assert.equal(status, 200);
  return admin;
}

/** Create a client with one login and return a browser signed in as that login. */
async function clientWithLogin(admin, name, email) {
  const created = await admin.post('/api/portal/admin/clients', { name });
  assert.equal(created.status, 201);
  const login = await admin.post(`/api/portal/admin/clients/${created.body.client.id}/logins`, { name: 'Jordan Rivera', email });
  assert.equal(login.status, 201);
  const person = browser('198.51.100.7');
  const signedIn = await person.login({ email, password: login.body.password });
  assert.equal(signedIn.status, 200);
  return { client: created.body.client, user: login.body.user, password: login.body.password, person };
}

const PDF = Buffer.from('%PDF-1.7 fake report bytes \u00e9\u00e8 \x00\x01\x02');

/* ------------------------------------------------------------- sign-in --- */

test('admin signs in with the configured credentials, case-insensitively on email', async () => {
  const admin = browser();
  const { status, body, headers } = await admin.login({ email: 'TEAM@accessrank.TEST', password: ADMIN.password });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, role: 'admin', next: '/portal/admin' });

  const cookie = headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.equal(headers.get('cache-control'), 'private, no-store');
});

test('a wrong password and an unknown email get the same answer', async () => {
  const admin = await adminBrowser();
  await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  const wrong = await browser().login({ email: 'jordan@harborpine.test', password: 'not-the-password' });
  const unknown = await browser().login({ email: 'nobody@harborpine.test', password: 'not-the-password' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  assert.equal(wrong.headers.getSetCookie().length, 0);
});

test('repeated failures lock an email out, even for the right password', async () => {
  const admin = await adminBrowser();
  const { password } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  for (let i = 0; i < 4; i += 1) {
    const attempt = await browser('192.0.2.50').login({ email: 'jordan@harborpine.test', password: 'guess' });
    assert.equal(attempt.status, 401);
  }
  const locked = await browser('192.0.2.51').login({ email: 'Jordan@HarborPine.test', password });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'too_many_attempts');
});

/* ---------------------------------------------------------- the funnel --- */

test('admin creates a client, a login and a file; the client signs in and downloads it', async () => {
  const admin = await adminBrowser();
  const { client, user, password, person } = await clientWithLogin(admin, 'Harbor & Pine', 'Jordan@HarborPine.test');

  assert.match(password, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  assert.equal(user.email, 'Jordan@HarborPine.test');
  assert.equal(user.passwordHash, undefined, 'a hash must never leave the server');

  const upload = await admin.upload(
    `/api/portal/admin/clients/${client.id}/files?name=${encodeURIComponent('../Audit report — Sept.pdf')}`,
    PDF,
  );
  assert.equal(upload.status, 201);
  assert.equal(upload.body.file.name, 'Audit report — Sept.pdf');
  assert.equal(upload.body.file.size, PDF.length);

  const me = await person.get('/api/portal/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'client');
  assert.equal(me.body.client.name, 'Harbor & Pine');
  assert.equal(me.body.user.passwordSetBy, 'admin');
  assert.equal(me.body.files.length, 1);
  assert.equal(me.body.files[0].data, undefined);

  const download = await person.get(`/api/portal/files/${me.body.files[0].id}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="Audit report _ Sept\.pdf"/);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(download.body.equals(PDF), 'bytes must round-trip exactly');

  const overview = await admin.get('/api/portal/admin/clients');
  assert.equal(overview.body.clients.length, 1);
  assert.equal(overview.body.clients[0].users.length, 1);
  assert.ok(overview.body.clients[0].users[0].lastLoginAt, 'sign-in is recorded');
  assert.equal(overview.body.clients[0].files.length, 1);
  assert.equal(overview.body.maxFileBytes, 1024 * 1024);
});

/* ------------------------------------------------------------ isolation --- */

test('a client can never see or download another client\u2019s files', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');
  const b = await clientWithLogin(admin, 'Larkspur Tea Co.', 'sam@larkspur.test');

  const theirs = await admin.upload(`/api/portal/admin/clients/${b.client.id}/files?name=secret.pdf`, PDF);
  assert.equal(theirs.status, 201);

  assert.equal((await a.person.get('/api/portal/me')).body.files.length, 0);

  const stolen = await a.person.get(`/api/portal/files/${theirs.body.file.id}`);
  const missing = await a.person.get('/api/portal/files/00000000-0000-4000-8000-000000000000');
  assert.equal(stolen.status, 404);
  assert.deepEqual(stolen.body, missing.body, 'someone else\u2019s file must look exactly like no file');

  assert.equal((await b.person.get(`/api/portal/files/${theirs.body.file.id}`)).status, 200);
});

test('a client login gets nothing from the admin API', async () => {
  const admin = await adminBrowser();
  const { client, user, person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  const attempts = await Promise.all([
    person.get('/api/portal/admin/clients'),
    person.post('/api/portal/admin/clients', { name: 'Mine Now' }),
    person.patch(`/api/portal/admin/clients/${client.id}`, { name: 'Renamed' }),
    person.del(`/api/portal/admin/clients/${client.id}`),
    person.post(`/api/portal/admin/clients/${client.id}/logins`, { email: 'friend@example.test' }),
    person.post(`/api/portal/admin/logins/${user.id}/reset`),
    person.upload(`/api/portal/admin/clients/${client.id}/files?name=x.pdf`, PDF),
  ]);
  for (const attempt of attempts) assert.equal(attempt.status, 404);

  const overview = await admin.get('/api/portal/admin/clients');
  assert.equal(overview.body.clients.length, 1);
  assert.equal(overview.body.clients[0].name, 'Harbor & Pine');
  assert.equal(overview.body.clients[0].files.length, 0);
});

test('without a session every portal endpoint refuses', async () => {
  const nobody = browser();
  for (const path of ['/api/portal/me', '/api/portal/admin/clients', '/api/portal/files/00000000-0000-4000-8000-000000000000']) {
    const { status, body } = await nobody.get(path);
    assert.equal(status, 401, path);
    assert.equal(body.code, 'signed_out');
  }
  nobody.cookie = `${SESSION_COOKIE}=${'z'.repeat(43)}`;
  assert.equal((await nobody.get('/api/portal/me')).status, 401, 'a made-up token is not a session');
});

/* ---------------------------------------------------------- credentials --- */

test('a client can change their password; the old one stops working', async () => {
  const admin = await adminBrowser();
  const { password, person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');
  const otherDevice = browser();
  await otherDevice.login({ email: 'jordan@harborpine.test', password });

  const wrong = await person.post('/api/portal/password', { current: 'nope', next: 'a-brand-new-password' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.field, 'current');

  const weak = await person.post('/api/portal/password', { current: password, next: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.field, 'next');

  const changed = await person.post('/api/portal/password', { current: password, next: 'a-brand-new-password' });
  assert.equal(changed.status, 200);

  assert.equal((await person.get('/api/portal/me')).status, 200, 'this device stays signed in');
  assert.equal((await person.get('/api/portal/me')).body.user.passwordSetBy, 'user');
  assert.equal((await otherDevice.get('/api/portal/me')).status, 401, 'other devices are signed out');
  assert.equal((await browser().login({ email: 'jordan@harborpine.test', password })).status, 401);
  assert.equal((await browser().login({ email: 'jordan@harborpine.test', password: 'a-brand-new-password' })).status, 200);
});

test('an admin reset issues a new password and ends the login\u2019s sessions', async () => {
  const admin = await adminBrowser();
  const { user, password, person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  const reset = await admin.post(`/api/portal/admin/logins/${user.id}/reset`);
  assert.equal(reset.status, 200);
  assert.notEqual(reset.body.password, password);

  assert.equal((await person.get('/api/portal/me')).status, 401);
  assert.equal((await browser().login({ email: user.email, password })).status, 401);
  assert.equal((await browser().login({ email: user.email, password: reset.body.password })).status, 200);
});

test('one email address can only have one login', async () => {
  const admin = await adminBrowser();
  const { client } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');
  const other = await admin.post('/api/portal/admin/clients', { name: 'Larkspur Tea Co.' });

  const dupe = await admin.post(`/api/portal/admin/clients/${other.body.client.id}/logins`, { email: 'JORDAN@harborpine.test' });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.field, 'email');

  const reserved = await admin.post(`/api/portal/admin/clients/${client.id}/logins`, { email: ADMIN.email });
  assert.equal(reserved.status, 400);
  assert.equal(reserved.body.code, 'email_reserved');
});

test('removing a login or deleting a client ends access immediately', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');
  const b = await clientWithLogin(admin, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const file = await admin.upload(`/api/portal/admin/clients/${b.client.id}/files?name=report.pdf`, PDF);

  assert.equal((await admin.del(`/api/portal/admin/logins/${a.user.id}`)).status, 200);
  assert.equal((await a.person.get('/api/portal/me')).status, 401);

  assert.equal((await admin.del(`/api/portal/admin/clients/${b.client.id}`)).status, 200);
  assert.equal((await b.person.get('/api/portal/me')).status, 401);
  assert.equal((await admin.get(`/api/portal/files/${file.body.file.id}`)).status, 404, 'files go with the client');
  assert.equal((await browser().login({ email: 'sam@larkspur.test', password: b.password })).status, 401);
});

test('signing out ends the session on the server, not just in the browser', async () => {
  const admin = await adminBrowser();
  const stolen = admin.cookie;
  assert.equal((await admin.post('/api/portal/logout')).status, 200);
  assert.equal(admin.cookie, '', 'the cookie is cleared');

  const replay = browser();
  replay.cookie = stolen;
  assert.equal((await replay.get('/api/portal/me')).status, 401);
});

/* -------------------------------------------------------------- uploads --- */

test('uploads are bounded and validated', async () => {
  const admin = await adminBrowser();
  const { client } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');
  const url = `/api/portal/admin/clients/${client.id}/files`;

  const tooBig = await admin.upload(`${url}?name=big.bin`, Buffer.alloc(1024 * 1024 + 1));
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error, /1 MB limit/);

  const empty = await admin.upload(`${url}?name=empty.pdf`, Buffer.alloc(0));
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'file_empty');

  const ghost = await admin.upload('/api/portal/admin/clients/00000000-0000-4000-8000-000000000000/files?name=a.pdf', PDF);
  assert.equal(ghost.status, 404);

  // A page-like file is stored, but only ever comes back as an opaque attachment.
  const html = await admin.upload(`${url}?name=page.html`, Buffer.from('<script>alert(1)</script>'));
  assert.equal(html.status, 201);
  const back = await admin.get(`/api/portal/files/${html.body.file.id}`);
  assert.equal(back.headers.get('content-type'), 'application/octet-stream');
  assert.match(back.headers.get('content-disposition'), /^attachment;/);

  assert.equal((await admin.del(`/api/portal/admin/files/${html.body.file.id}`)).status, 200);
  assert.equal((await admin.get(`/api/portal/files/${html.body.file.id}`)).status, 404);
});

/* ---------------------------------------------------------------- pages --- */

test('portal pages redirect to sign-in without a session, and to the right place with one', async () => {
  const nobody = browser();
  for (const path of ['/portal', '/portal/', '/portal/index.html', '/portal/admin', '/portal/admin/index.html', '/portal/clients']) {
    const { status, headers } = await nobody.get(path);
    assert.equal(status, 302, path);
    assert.equal(headers.get('location'), '/client-login', path);
    assert.equal(headers.get('cache-control'), 'private, no-store', path);
  }

  const admin = await adminBrowser();
  const { person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  assert.equal((await person.get('/portal/admin')).headers.get('location'), '/portal', 'a client never reaches the admin page');
  assert.equal((await person.get('/portal/clients')).headers.get('location'), '/portal', 'nor the team’s client view');
  assert.notEqual((await admin.get('/portal/clients')).status, 302, 'the team does');
  assert.equal((await admin.get('/portal')).headers.get('location'), '/portal/admin');
  assert.equal((await person.get('/client-login')).headers.get('location'), '/portal');
  assert.equal((await admin.get('/client-login')).headers.get('location'), '/portal/admin');

  // Signed in and in the right place: not a redirect (200 with a built dist/, the 404 page without).
  assert.notEqual((await person.get('/portal')).status, 302);
  assert.notEqual((await admin.get('/portal/admin')).status, 302);
  assert.notEqual((await nobody.get('/client-login')).status, 302);
});

test('cross-origin writes to the portal API are refused', async () => {
  const admin = await adminBrowser();
  const { status, body } = await admin.post('/api/portal/admin/clients', { name: 'From elsewhere' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'bad_origin');
});

/* -------------------------------------------------------------- reports --- */

const REPORT_HTML = '<!doctype html><html lang="en"><head><title>Status</title><style>body{margin:0}</style></head>'
  + '<body><p style="color:#222">Hello</p><script>window.__ran = true;</script></body></html>';

async function publish(admin, clientId, title = 'Status update', html = REPORT_HTML) {
  const res = await admin.upload(`/api/portal/admin/clients/${clientId}/reports?title=${encodeURIComponent(title)}`, Buffer.from(html, 'utf8'));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.report;
}

test('a client opens their own report in the browser; no one else can', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const b = await clientWithLogin(admin, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const report = await publish(admin, a.client.id);

  const listed = (await a.person.get('/api/portal/reports')).body.reports;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, 'Status update');
  assert.deepEqual((await b.person.get('/api/portal/reports')).body.reports, []);
  assert.equal((await a.person.get('/api/portal/me')).body.reports.length, 1);

  const page = await a.person.get(`/portal/report/${report.id}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(page.body.toString('utf8'), REPORT_HTML, 'the page is served exactly as published, not as a download');
  assert.equal(page.headers.get('content-disposition'), null);

  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'(;|$)/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp.split(';').find((d) => d.trim().startsWith('script-src ')), /unsafe-inline/);

  assert.equal((await b.person.get(`/portal/report/${report.id}`)).status, 404, 'another client');
  const signedOut = await browser().get(`/portal/report/${report.id}`);
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get('location'), '/client-login');
  assert.equal((await admin.get(`/portal/report/${report.id}`)).status, 200, 'the team can open it');
  assert.equal((await a.person.get('/portal/report/not-a-uuid')).status, 404);
});

test('only the team publishes reports, and only whole HTML pages', async () => {
  const admin = await adminBrowser();
  const { client, person } = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const url = `/api/portal/admin/clients/${client.id}/reports?title=X%20report`;

  assert.equal((await person.upload(url, Buffer.from(REPORT_HTML))).status, 404, 'a client login cannot publish');
  assert.equal((await browser().upload(url, Buffer.from(REPORT_HTML))).status, 401);

  const notHtml = await admin.upload(url, Buffer.from('just some text'));
  assert.equal(notHtml.status, 415);
  assert.equal(notHtml.body.code, 'not_html');
  assert.equal((await admin.upload(`/api/portal/admin/clients/${client.id}/reports?title=`, Buffer.from(REPORT_HTML))).body.code, 'title_required');
  assert.equal((await admin.upload(url, Buffer.alloc(1024 * 1024 + 1, 0x20))).status, 413);
  assert.equal((await person.get('/api/portal/reports')).body.reports.length, 0, 'nothing stored by the refused attempts');
});

test('approvals are saved against the report, deduplicated, and visible to the team', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const report = await publish(admin, a.client.id, 'Accessibility status update');
  const path = `/api/portal/reports/${report.id}/approvals`;

  const first = await a.person.post(path, {
    name: 'Jordan Rivera',
    items: [
      { key: 'd1', title: 'Visible keyboard outline', decision: 'approve', decidedAt: new Date().toISOString() },
      { key: 'd2', title: 'Slideshow', decision: 'changes', choice: 'Add a pause button', comment: 'Please make it larger.' },
      { key: 'c5', title: 'FAQ content', decision: 'comment', comment: 'We will email our FAQs.' },
      { key: 'c6', title: 'Nut-free', decision: 'comment', comment: '   ' },
    ],
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.saved, 3, 'an empty comment is not an answer');
  assert.equal(first.body.items.length, 3);

  const again = await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'd1', title: 'Visible keyboard outline', decision: 'approve' }] });
  assert.equal(again.body.saved, 0);
  assert.equal(again.body.unchanged, 1);

  const changed = await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'd2', title: 'Slideshow', decision: 'approve', choice: 'Add a pause button' }] });
  assert.equal(changed.body.saved, 1);

  const mine = (await a.person.get(path)).body.items;
  assert.equal(mine.find((i) => i.key === 'd2').decision, 'approve', 'the newest answer is the current one');
  assert.equal(mine.find((i) => i.key === 'd1').signerName, 'Jordan Rivera');
  assert.equal(mine.find((i) => i.key === 'd1').email, 'jordan@topseedz.test');

  const seen = (await admin.get('/api/portal/admin/approvals')).body.reports;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].clientName, 'Top Seedz');
  assert.equal(seen[0].title, 'Accessibility status update');
  assert.deepEqual({ approved: seen[0].progress.approved, changes: seen[0].progress.changes, comments: seen[0].progress.comments }, { approved: 2, changes: 0, comments: 1 });
  assert.equal((await a.person.get('/api/portal/reports')).body.reports[0].progress.approved, 2);

  const history = (await admin.get(`/api/portal/admin/reports/${report.id}/history`)).body.history;
  assert.equal(history.length, 4, 'the earlier answer is kept as history');
  assert.deepEqual(history.filter((h) => h.key === 'd2').map((h) => h.decision), ['approve', 'changes']);
});

test('a changed answer gets a new time, and a cleared comment really clears', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const report = await publish(admin, a.client.id, 'Accessibility status update');
  const path = `/api/portal/reports/${report.id}/approvals`;
  const name = 'Jordan Rivera';
  const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const item = (over) => ({ key: 'd1', title: 'Slideshow', decision: 'approve', choice: 'Add a pause button', decidedAt: earlier, ...over });
  const current = async () => (await a.person.get(path)).body.items.find((i) => i.key === 'd1');

  assert.equal((await a.person.post(path, { name, items: [item()] })).status, 201);
  assert.equal((await current()).decidedAt, earlier, 'a first answer keeps the time the page stamped');

  // The page sends the old stamp again with a different option: it must not stick.
  await a.person.post(path, { name, items: [item({ choice: 'Add a pause and a stop button' })] });
  assert.ok((await current()).decidedAt > earlier, 'a changed option is stamped with the time of the change');

  const stamped = (await current()).decidedAt;
  await a.person.post(path, { name, items: [item({ choice: 'Add a pause and a stop button', comment: 'Thanks.', decidedAt: null })] });
  assert.equal((await current()).decidedAt, stamped, 'a comment-only edit keeps the original time');

  await a.person.post(path, { name, items: [item({ decision: 'changes', choice: 'Add a pause and a stop button', comment: 'Thanks.' })] });
  assert.ok((await current()).decidedAt >= stamped && (await current()).decidedAt > earlier, 'a changed decision is restamped');

  // Comment-only items: write one, then clear it.
  const note = (comment) => ({ key: 'c5', title: 'FAQ content', decision: 'comment', comment });
  await a.person.post(path, { name, items: [note('We will email our FAQs.')] });
  assert.equal((await a.person.get(path)).body.items.find((i) => i.key === 'c5').comment, 'We will email our FAQs.');
  const cleared = await a.person.post(path, { name, items: [note('')] });
  assert.equal(cleared.body.saved, 1, 'clearing is saved, not skipped');
  assert.equal((await a.person.get(path)).body.items.find((i) => i.key === 'c5'), undefined, 'the cleared comment is gone');
  assert.equal((await admin.get('/api/portal/admin/approvals')).body.reports[0].items.find((i) => i.key === 'c5'), undefined, 'and gone for the team');
  const again = await a.person.post(path, { name, items: [note('')] });
  assert.equal(again.body.saved, 0, 'clearing twice stores nothing more');
  const history = (await admin.get(`/api/portal/admin/reports/${report.id}/history`)).body.history;
  assert.equal(history.filter((h) => h.key === 'c5').length, 2, 'the original comment stays in the record');
});

test('approvals are refused for strangers, other clients, bad input and other origins', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const b = await clientWithLogin(admin, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const report = await publish(admin, a.client.id);
  const path = `/api/portal/reports/${report.id}/approvals`;
  const ok = { name: 'Jordan Rivera', items: [{ key: 'd1', title: 'T', decision: 'approve' }] };

  assert.equal((await browser().post(path, ok)).status, 401, 'no session');
  assert.equal((await b.person.post(path, ok)).status, 404, 'another client');
  assert.equal((await b.person.get(path)).status, 404);
  assert.equal((await admin.post(path, ok)).status, 404, 'the team does not approve on a client’s behalf');
  assert.equal((await a.person.post(path, { ...ok, name: ' ' })).body.code, 'name_required');
  assert.equal((await a.person.post(path, { name: 'Jordan Rivera', items: [] })).body.code, 'no_items');
  assert.equal((await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'D1; DROP', decision: 'approve' }] })).body.code, 'bad_item');
  assert.equal((await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'd1', decision: 'maybe' }] })).body.code, 'bad_item');
  assert.equal((await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'd1', decision: 'approve' }, { key: 'd1', decision: 'changes' }] })).body.code, 'bad_item');
  assert.equal((await a.person.post(`/api/portal/reports/00000000-0000-4000-8000-000000000000/approvals`, ok)).status, 404);

  const foreign = await a.person.post(path, ok, { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.deepEqual((await a.person.get(path)).body.items, [], 'nothing was stored by the refused attempts');
  assert.equal((await a.person.get('/api/portal/admin/approvals')).status, 404, 'clients cannot see the team view');
});

test('deleting a report or a client removes its approvals too', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const r1 = await publish(admin, a.client.id, 'One');
  const r2 = await publish(admin, a.client.id, 'Two');
  const save = (r) => a.person.post(`/api/portal/reports/${r.id}/approvals`, { name: 'Jordan Rivera', items: [{ key: 'd1', title: 'T', decision: 'approve' }] });
  assert.equal((await save(r1)).status, 201);
  assert.equal((await save(r2)).status, 201);

  assert.equal((await admin.del(`/api/portal/admin/reports/${r1.id}`)).status, 200);
  assert.equal((await a.person.get(`/portal/report/${r1.id}`)).status, 404);
  const left = (await admin.get('/api/portal/admin/approvals')).body.reports;
  assert.deepEqual(left.map((r) => r.title), ['Two']);

  assert.equal((await admin.del(`/api/portal/admin/clients/${a.client.id}`)).status, 200);
  assert.deepEqual((await admin.get('/api/portal/admin/approvals')).body.reports, []);
});

/* ------------------------------------------------------------ operators --- */

const { _setTransportForTests } = await import('../../server/lib/email.js');

/** An operator created by the owner login, already signed in on their own browser. */
async function operatorWithLogin(admin, { name, email, role = 'operator' }, ip = '198.51.100.40') {
  const created = await admin.post('/api/portal/operators', { name, email, role });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const person = browser(ip);
  const signedIn = await person.login({ email, password: created.body.password });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  assert.equal(signedIn.body.next, '/portal/admin');
  return { operator: created.body.operator, password: created.body.password, person };
}

test('masters add operators, who sign in with a one-time password and see no clients until assigned', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson Dev', email: 'Emerson@Accessrank.test' });

  assert.equal(op.operator.role, 'operator');
  assert.equal(op.operator.email, 'Emerson@Accessrank.test');
  assert.ok(op.password.length >= 10);
  const me = (await op.person.get('/api/portal/me')).body;
  assert.equal(me.role, 'operator');
  assert.equal(me.isMaster, false);

  assert.deepEqual((await op.person.get('/api/portal/admin/clients')).body.clients, [], 'nothing assigned yet');

  const assigned = await owner.put?.(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [a.client.id] });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const seen = (await op.person.get('/api/portal/admin/clients')).body.clients;
  assert.deepEqual(seen.map((c) => c.name), ['Top Seedz']);

  const list = (await owner.get('/api/portal/operators')).body;
  assert.deepEqual(list.operators.find((o) => o.id === op.operator.id).clientIds, [a.client.id]);
  assert.equal(list.clients.length, 2);
  assert.ok(!JSON.stringify(list).includes(op.password), 'the password is never listed');
});

test('an operator reaches only assigned clients, in every part of the team API', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const theirs = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson Dev', email: 'emerson@accessrank.test' });
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [mine.client.id] });

  const myReport = await publish(owner, mine.client.id, 'Mine');
  const theirReport = await publish(owner, theirs.client.id, 'Theirs');
  const theirFile = (await owner.upload(`/api/portal/admin/clients/${theirs.client.id}/files?name=secret.pdf`, PDF)).body.file;
  await theirs.person.post(`/api/portal/reports/${theirReport.id}/approvals`, { name: 'Sam', items: [{ key: 'i1', title: 'T', decision: 'approve' }] });
  await mine.person.post(`/api/portal/reports/${myReport.id}/approvals`, { name: 'Jordan', items: [{ key: 'i1', title: 'T', decision: 'approve' }] });

  // What an operator can do on an assigned client.
  assert.equal((await op.person.upload(`/api/portal/admin/clients/${mine.client.id}/reports?title=Another`, Buffer.from(REPORT_HTML))).status, 201);
  assert.equal((await op.person.upload(`/api/portal/admin/clients/${mine.client.id}/files?name=ok.pdf`, PDF)).status, 201);
  assert.equal((await op.person.post(`/api/portal/admin/clients/${mine.client.id}/logins`, { email: 'new@topseedz.test' })).status, 201);
  assert.equal((await op.person.get(`/portal/report/${myReport.id}`)).status, 200);
  assert.deepEqual((await op.person.get('/api/portal/admin/approvals')).body.reports.map((r) => r.title).sort(), ['Another', 'Mine']);

  // What it cannot do on anyone else's.
  const other = theirs.client.id;
  assert.equal((await op.person.upload(`/api/portal/admin/clients/${other}/reports?title=X`, Buffer.from(REPORT_HTML))).status, 404);
  assert.equal((await op.person.upload(`/api/portal/admin/clients/${other}/files?name=x.pdf`, PDF)).status, 404);
  assert.equal((await op.person.post(`/api/portal/admin/clients/${other}/logins`, { email: 'x@larkspur.test' })).status, 404);
  assert.equal((await op.person.post(`/api/portal/admin/logins/${theirs.user.id}/reset`)).status, 404);
  assert.equal((await op.person.del(`/api/portal/admin/logins/${theirs.user.id}`)).status, 404);
  assert.equal((await op.person.del(`/api/portal/admin/reports/${theirReport.id}`)).status, 404);
  assert.equal((await op.person.get(`/api/portal/admin/reports/${theirReport.id}/history`)).status, 404);
  assert.equal((await op.person.del(`/api/portal/admin/files/${theirFile.id}`)).status, 404);
  assert.equal((await op.person.get(`/api/portal/files/${theirFile.id}`)).status, 404);
  assert.equal((await op.person.get(`/portal/report/${theirReport.id}`)).status, 404);
  assert.ok(!(await op.person.get('/api/portal/admin/approvals')).body.reports.some((r) => r.title === 'Theirs'));

  // Management is for masters.
  assert.equal((await op.person.post('/api/portal/admin/clients', { name: 'New Co' })).status, 404);
  assert.equal((await op.person.patch(`/api/portal/admin/clients/${mine.client.id}`, { name: 'Renamed' })).status, 404);
  assert.equal((await op.person.del(`/api/portal/admin/clients/${mine.client.id}`)).status, 404);
  assert.equal((await op.person.get('/api/portal/operators')).status, 404);
  assert.equal((await op.person.post('/api/portal/operators', { name: 'Sneaky', email: 's@x.test', role: 'master' })).status, 404);
  assert.equal((await op.person.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [other] })).status, 404, 'cannot assign themselves more clients');
  assert.equal((await mine.person.get('/api/portal/operators')).status, 404, 'client logins reach nothing here');
  assert.equal((await mine.person.get('/api/portal/admin/clients')).status, 404);

  // Unassigning takes effect on the next request.
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [] });
  assert.equal((await op.person.get(`/portal/report/${myReport.id}`)).status, 404);
  assert.deepEqual((await op.person.get('/api/portal/admin/clients')).body.clients, []);
});

test('master operators see every client and manage the team; role changes bite immediately', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const jp = await operatorWithLogin(owner, { name: 'JP Lincoln', email: 'jp@accessrank.test', role: 'master' }, '198.51.100.41');
  const carlos = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.42');

  assert.equal((await jp.person.get('/api/portal/me')).body.isMaster, true);
  assert.equal((await jp.person.get('/api/portal/admin/clients')).body.clients.length, 1, 'a master sees every client with none assigned');
  assert.equal((await jp.person.post('/api/portal/admin/clients', { name: 'New Co' })).status, 201);

  const added = await jp.person.post('/api/portal/operators', { name: 'Arturo', email: 'arturo@accessrank.test' });
  assert.equal(added.status, 201);
  const arturo = added.body.operator;

  assert.equal((await jp.person.patch(`/api/portal/operators/${jp.operator.id}`, { role: 'operator' })).body.code, 'self_demote');
  assert.equal((await jp.person.del(`/api/portal/operators/${jp.operator.id}`)).body.code, 'self_delete');

  const promoted = await jp.person.patch(`/api/portal/operators/${arturo.id}`, { role: 'master' });
  assert.equal(promoted.body.operator.role, 'master');
  const arturoBrowser = browser('198.51.100.43');
  await arturoBrowser.login({ email: 'arturo@accessrank.test', password: added.body.password });
  assert.equal((await arturoBrowser.get('/api/portal/operators')).status, 200);

  // Demoted while signed in: the very next request is an operator's.
  assert.equal((await carlos.person.patch(`/api/portal/operators/${arturo.id}`, { role: 'operator' })).status, 200);
  assert.equal((await arturoBrowser.get('/api/portal/operators')).status, 404);
  assert.deepEqual((await arturoBrowser.get('/api/portal/admin/clients')).body.clients, []);

  // Reset and removal sign the person out at once.
  const reset = await carlos.person.post(`/api/portal/operators/${arturo.id}/reset`);
  assert.equal(reset.status, 200);
  assert.equal((await arturoBrowser.get('/api/portal/me')).status, 401, 'old session ended');
  assert.equal((await browser().login({ email: 'arturo@accessrank.test', password: added.body.password })).status, 401, 'old password no longer works');
  const back = browser('198.51.100.44');
  assert.equal((await back.login({ email: 'arturo@accessrank.test', password: reset.body.password })).status, 200);
  assert.equal((await carlos.person.del(`/api/portal/operators/${arturo.id}`)).status, 200);
  assert.equal((await back.get('/api/portal/me')).status, 401);

  // Never zero masters: the last one cannot be demoted or removed, even by the owner.
  assert.equal((await owner.del(`/api/portal/operators/${carlos.operator.id}`)).status, 200);
  assert.equal((await owner.patch(`/api/portal/operators/${jp.operator.id}`, { role: 'operator' })).body.code, 'last_master');
  assert.equal((await owner.del(`/api/portal/operators/${jp.operator.id}`)).body.code, 'last_master');
  assert.equal(a.client.name, 'Top Seedz');
});

test('operator logins are kept apart from client logins and the owner', async () => {
  const owner = await adminBrowser();
  await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');

  assert.equal((await owner.post('/api/portal/operators', { name: 'Dup', email: 'jordan@topseedz.test' })).status, 409, 'a client login email');
  assert.equal((await owner.post('/api/portal/operators', { name: 'Dup', email: 'team@accessrank.test' })).body.code, 'email_reserved', 'the owner email');
  assert.equal((await owner.post('/api/portal/operators', { name: ' ', email: 'x@accessrank.test' })).body.code, 'name_required');
  assert.equal((await owner.post('/api/portal/operators', { name: 'Em', email: 'not-an-email' })).body.code, 'email_invalid');

  await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  assert.equal((await owner.post('/api/portal/operators', { name: 'Again', email: 'EMERSON@accessrank.test' })).status, 409);
  const client = await owner.post('/api/portal/admin/clients', { name: 'Other Co' });
  const clash = await owner.post(`/api/portal/admin/clients/${client.body.client.id}/logins`, { email: 'emerson@accessrank.test' });
  assert.equal(clash.body.code, 'email_reserved', 'a client login cannot reuse an operator email');

  assert.equal((await browser().post('/api/portal/operators', { name: 'X', email: 'x@y.test' })).status, 401);
  const foreign = await owner.post('/api/portal/operators', { name: 'X', email: 'x@y.test' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});

test('operators choose their own password, and the page gates send each kind of person home', async () => {
  const owner = await adminBrowser();
  const op = await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  const other = browser('198.51.100.60');
  await other.login({ email: 'emerson@accessrank.test', password: op.password });

  assert.equal((await op.person.post('/api/portal/operator/password', { current: 'wrong-password', next: 'a-brand-new-password' })).body.code, 'bad_credentials');
  assert.equal((await op.person.post('/api/portal/operator/password', { current: op.password, next: 'short' })).body.code, 'password_weak');
  assert.equal((await op.person.post('/api/portal/operator/password', { current: op.password, next: 'a-brand-new-password' })).status, 200);
  assert.equal((await other.get('/api/portal/me')).status, 401, 'other devices are signed out');
  assert.equal((await op.person.get('/api/portal/me')).status, 200, 'this one stays');
  assert.equal((await browser().login({ email: 'emerson@accessrank.test', password: 'a-brand-new-password' })).status, 200);
  assert.equal((await owner.post('/api/portal/operator/password', { current: 'x', next: 'another-long-password' })).status, 400, 'the owner password lives in server settings');

  const client = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  assert.equal((await op.person.get('/portal')).headers.get('location'), '/portal/admin');
  assert.equal((await op.person.get('/portal/operators')).status, 200, 'any operator may open their own account page');
  assert.equal((await client.person.get('/portal/operators')).headers.get('location'), '/portal');
  assert.equal((await client.person.get('/portal/admin')).headers.get('location'), '/portal');
  assert.equal((await browser().get('/portal/operators')).headers.get('location'), '/client-login');
});

/* -------------------------------------------------------- notifications --- */

function captureMail() {
  const sent = [];
  _setTransportForTests({ name: 'test', send: async (m) => { sent.push(m); return { id: 'x' }; } });
  return sent;
}
const settle = async (sent, n) => { for (let i = 0; i < 50 && sent.length < n; i += 1) await new Promise((r) => setTimeout(r, 10)); };

test('a client submitting answers emails info@accessrank.ai once, with what changed', async () => {
  const sent = captureMail();
  try {
    const owner = await adminBrowser();
    const a = await clientWithLogin(owner, 'Top Seedz & Co', 'jordan@topseedz.test');
    const report = await publish(owner, a.client.id, 'Accessibility status update');
    const path = `/api/portal/reports/${report.id}/approvals`;

    const first = await a.person.post(path, { name: 'Jordan Rivera', items: [
      { key: 'i1', title: '1. Keyboard outline', decision: 'approve' },
      { key: 'i3', title: '3. Overlay', decision: 'changes', comment: 'Keep it <script>x</script> until the audit.' },
    ] });
    assert.equal(first.status, 201);
    await settle(sent, 1);
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.equal(mail.to, 'info@accessrank.ai');
    assert.equal(mail.subject, 'Top Seedz & Co submitted approvals: Accessibility status update (2 answers)');
    assert.match(mail.html, /Top Seedz &amp; Co submitted answers/);
    assert.match(mail.text, /1\. Keyboard outline: Approved/);
    assert.match(mail.text, /3\. Overlay: Changes requested/);
    assert.match(mail.text, /Keep it <script>x<\/script> until the audit\./);
    assert.match(mail.text, /jordan@topseedz\.test/);
    assert.match(mail.html, /&lt;script&gt;x&lt;\/script&gt;/, 'client text is escaped in the HTML part');
    assert.doesNotMatch(mail.html, /<script>x/);
    assert.match(mail.html, new RegExp(`/portal/report/${report.id}`));

    // Pressing Submit again with nothing new, or a refused attempt, tells nobody.
    await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Keyboard outline', decision: 'approve' }] });
    await a.person.post(path, { name: ' ', items: [{ key: 'i1', decision: 'changes' }] });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(sent.length, 1);

    // A changed answer sends one more, listing only that answer.
    await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Keyboard outline', decision: 'changes', comment: 'Make it blue.' }] });
    await settle(sent, 2);
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /\(1 answer\)$/);
    assert.doesNotMatch(sent[1].text, /Overlay/);
  } finally {
    _setTransportForTests(null);
  }
});

test('a mail failure never fails the client’s save', async () => {
  _setTransportForTests({ name: 'broken', send: async () => { throw new Error('provider down'); } });
  try {
    const owner = await adminBrowser();
    const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
    const report = await publish(owner, a.client.id);
    const saved = await a.person.post(`/api/portal/reports/${report.id}/approvals`, { name: 'Jordan Rivera', items: [{ key: 'i1', title: 'T', decision: 'approve' }] });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.saved, 1);
    assert.equal((await a.person.get(`/api/portal/reports/${report.id}/approvals`)).body.items.length, 1);
  } finally {
    _setTransportForTests(null);
  }
});

/* --------------------------------------------- past approvals, compliance --- */

test('a closed report keeps its answers, stays readable, and stops taking changes; reopening restores it', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const report = await publish(owner, a.client.id, 'Status update');
  const path = `/api/portal/reports/${report.id}/approvals`;
  const answer = { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'approve' }] };
  assert.equal((await a.person.post(path, answer)).status, 201);

  assert.equal(report.status, 'open');
  const closed = await owner.patch(`/api/portal/admin/reports/${report.id}`, { status: 'closed' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.report.status, 'closed');
  assert.ok(closed.body.report.closedAt);
  assert.match(closed.body.report.closedBy, /team@accessrank\.test/);

  const mine = (await a.person.get('/api/portal/me')).body.reports;
  assert.equal(mine[0].status, 'closed');
  assert.equal(mine[0].progress.approved, 1);
  assert.equal((await a.person.get(`/portal/report/${report.id}`)).status, 200, 'still viewable');
  const read = (await a.person.get(path)).body;
  assert.equal(read.closed, true);
  assert.equal(read.items.length, 1);

  const refused = await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'changes' }] });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'report_closed');
  assert.equal((await a.person.get(path)).body.items[0].decision, 'approve', 'nothing changed');

  const past = (await owner.get('/api/portal/admin/approvals')).body.reports;
  assert.equal(past[0].status, 'closed');
  assert.equal(past[0].items.length, 1, 'the answers are still there');

  assert.equal((await a.person.patch(`/api/portal/admin/reports/${report.id}`, { status: 'open' })).status, 404, 'clients cannot reopen');
  assert.equal((await owner.patch(`/api/portal/admin/reports/${report.id}`, { status: 'archived' })).status, 400);
  assert.equal((await owner.patch(`/api/portal/admin/reports/${report.id}`, { status: 'open' })).body.report.status, 'open');
  assert.equal((await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'changes' }] })).status, 201);
});

test('operators close and reopen only their own clients’ reports', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const theirs = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [mine.client.id] });
  const r1 = await publish(owner, mine.client.id, 'Mine');
  const r2 = await publish(owner, theirs.client.id, 'Theirs');
  assert.equal((await op.person.patch(`/api/portal/admin/reports/${r1.id}`, { status: 'closed' })).status, 200);
  assert.equal((await op.person.patch(`/api/portal/admin/reports/${r2.id}`, { status: 'closed' })).status, 404);
  assert.equal((await owner.get('/api/portal/admin/approvals')).body.reports.find((r) => r.title === 'Theirs').status, 'open');
});

test('the approvals record downloads as a spreadsheet with full history, to the right people only', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const b = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const report = await publish(owner, a.client.id, 'Status, "Q4" update');
  const path = `/api/portal/reports/${report.id}/approvals`;
  await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'approve' }, { key: 'i3', title: '3. Overlay', decision: 'changes', comment: '=HYPERLINK("http://evil.example")\nsecond line, with comma' }] });
  await a.person.post(path, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'changes', comment: 'Make it blue.' }] });

  const url = `/api/portal/reports/${report.id}/record`;
  const res = await a.person.get(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /^attachment;.*Approvals-record-status-q4-update\.csv/);
  const csv = res.body.toString('utf8');
  assert.ok(csv.startsWith('﻿Client,Report,Report status,Item,Decision'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + 3, 'a header and every answer ever saved');
  assert.match(csv, /"Status, ""Q4"" update"/, 'commas and quotes are escaped');
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil\.example""\)\nsecond line, with comma"/, 'a formula is defused');
  assert.equal(lines.filter((l) => /,yes$/.test(l)).length, 2, 'one current answer per item');
  assert.match(csv, /Changes requested,,Make it blue\.,Jordan Rivera,jordan@topseedz\.test/);

  assert.equal((await owner.get(url)).status, 200);
  assert.equal((await b.person.get(url)).status, 404, 'another client');
  assert.equal((await browser().get(url)).status, 401);
});

test('files are kept in two areas, and the client sees them separately', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const base = `/api/portal/admin/clients/${a.client.id}/files`;
  const rec = await owner.upload(`${base}?name=Compliance-Record.pdf&area=compliance`, PDF);
  const plain = await owner.upload(`${base}?name=Notes.pdf`, PDF);
  const odd = await owner.upload(`${base}?name=Odd.pdf&area=../../etc`, PDF);
  assert.equal(rec.body.file.area, 'compliance');
  assert.equal(plain.body.file.area, 'files');
  assert.equal(odd.body.file.area, 'files', 'anything unexpected falls back to ordinary files');

  const files = (await a.person.get('/api/portal/me')).body.files;
  assert.deepEqual(files.filter((f) => f.area === 'compliance').map((f) => f.name), ['Compliance-Record.pdf']);
  assert.equal(files.filter((f) => f.area === 'files').length, 2);
  assert.equal((await a.person.get(`/api/portal/files/${rec.body.file.id}`)).status, 200);
  const overview = (await owner.get('/api/portal/admin/clients')).body.clients[0];
  assert.equal(overview.files.find((f) => f.name === 'Compliance-Record.pdf').area, 'compliance');
});

test('operators move a file between Compliance and Other files, within their own clients', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const theirs = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [mine.client.id] });
  const f1 = (await owner.upload(`/api/portal/admin/clients/${mine.client.id}/files?name=a.pdf`, PDF)).body.file;
  const f2 = (await owner.upload(`/api/portal/admin/clients/${theirs.client.id}/files?name=b.pdf`, PDF)).body.file;

  const moved = await op.person.patch(`/api/portal/admin/files/${f1.id}`, { area: 'compliance' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.file.area, 'compliance');
  assert.equal((await mine.person.get('/api/portal/me')).body.files.find((f) => f.id === f1.id).area, 'compliance');
  assert.equal((await op.person.patch(`/api/portal/admin/files/${f1.id}`, { area: 'files' })).body.file.area, 'files');
  assert.equal((await op.person.patch(`/api/portal/admin/files/${f1.id}`, { area: 'nope' })).status, 400);
  assert.equal((await op.person.patch(`/api/portal/admin/files/${f2.id}`, { area: 'compliance' })).status, 404, 'not their client');
  assert.equal((await mine.person.patch(`/api/portal/admin/files/${f1.id}`, { area: 'compliance' })).status, 404, 'clients cannot');
});


test('the team reads a client’s answers for the clients they work on, and cannot write them', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const theirs = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [mine.client.id] });
  const r1 = await publish(owner, mine.client.id, 'Mine');
  const r2 = await publish(owner, theirs.client.id, 'Theirs');
  await mine.person.post(`/api/portal/reports/${r1.id}/approvals`, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'approve' }] });

  const read = await op.person.get(`/api/portal/reports/${r1.id}/approvals`);
  assert.equal(read.status, 200);
  assert.equal(read.body.items[0].decision, 'approve');
  assert.equal((await owner.get(`/api/portal/reports/${r1.id}/approvals`)).status, 200);
  assert.equal((await op.person.get(`/api/portal/reports/${r2.id}/approvals`)).status, 404, 'not their client');
  assert.equal((await mine.person.get(`/api/portal/reports/${r2.id}/approvals`)).status, 404, 'another client');
  assert.equal((await op.person.get(`/portal/report/${r1.id}`)).status, 200);
  assert.equal((await op.person.get(`/portal/report/${r2.id}`)).status, 404);

  const write = await op.person.post(`/api/portal/reports/${r1.id}/approvals`, { name: 'Emerson', items: [{ key: 'i1', title: '1. Outline', decision: 'changes' }] });
  assert.ok([401, 403, 404].includes(write.status), `operators cannot answer for a client (got ${write.status})`);
  assert.equal((await mine.person.get(`/api/portal/reports/${r1.id}/approvals`)).body.items[0].decision, 'approve', 'the client’s answer is untouched');
});

test('the team’s client list carries each report’s progress', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const report = await publish(owner, a.client.id, 'Status update');
  await a.person.post(`/api/portal/reports/${report.id}/approvals`, { name: 'Jordan Rivera', items: [{ key: 'i1', title: '1. Outline', decision: 'approve' }] });
  const row = (await owner.get('/api/portal/admin/clients')).body.clients[0].reports[0];
  assert.equal(row.progress.approved, 1);
});

test('completed approvals can be uploaded into Past approvals, and the client sees them there', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const base = `/api/portal/admin/clients/${a.client.id}/files`;
  const up = await owner.upload(`${base}?name=Approved-copy-edits.pdf&area=approvals`, PDF);
  assert.equal(up.status, 201);
  assert.equal(up.body.file.area, 'approvals');
  const mine = (await a.person.get('/api/portal/me')).body.files.find((f) => f.name === 'Approved-copy-edits.pdf');
  assert.equal(mine.area, 'approvals');
  assert.equal((await a.person.get(`/api/portal/files/${mine.id}`)).status, 200);
  assert.equal((await owner.patch(`/api/portal/admin/files/${mine.id}`, { area: 'compliance' })).body.file.area, 'compliance');
  assert.equal((await owner.upload(`${base}?name=x.pdf&area=bogus`, PDF)).body.file.area, 'files');
});
