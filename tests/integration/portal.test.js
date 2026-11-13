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
    replace: (p, raw, o) => call('PUT', p, { raw, ...o }),
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
  assert.deepEqual(body, { ok: true, role: 'admin', next: '/portal/approvals' });

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
  for (const path of ['/portal', '/portal/', '/portal/index.html', '/portal/admin', '/portal/admin/index.html', '/portal/approvals', '/portal/clients', '/portal/client', '/portal/repository']) {
    const { status, headers } = await nobody.get(path);
    assert.equal(status, 302, path);
    assert.equal(headers.get('location'), '/client-login', path);
    assert.equal(headers.get('cache-control'), 'private, no-store', path);
  }

  const admin = await adminBrowser();
  const { person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  assert.equal((await person.get('/portal/admin')).headers.get('location'), '/portal', 'a client never reaches the admin page');
  for (const path of ['/portal/approvals', '/portal/clients', '/portal/client', '/portal/repository', '/portal/operators']) {
    assert.equal((await person.get(path)).headers.get('location'), '/portal', `a client never reaches ${path}`);
    assert.notEqual((await admin.get(path)).status, 302, `the owner does reach ${path}`);
  }
  assert.equal((await admin.get('/portal/admin')).headers.get('location'), '/portal/approvals', 'the old console address lands on Approvals');
  assert.equal((await admin.get('/portal')).headers.get('location'), '/portal/approvals');
  assert.equal((await person.get('/client-login')).headers.get('location'), '/portal');
  assert.equal((await admin.get('/client-login')).headers.get('location'), '/portal/approvals');
  // The team may open the client page only to view it as a client: /portal?as=<client id>.
  assert.notEqual((await admin.get('/portal?as=3f2b8c1e-6a4d-4f6e-9b7a-1c2d3e4f5a6b')).status, 302);
  assert.equal((await admin.get('/portal?as=not-an-id')).headers.get('location'), '/portal/approvals');

  // Signed in and in the right place: not a redirect (200 with a built dist/, the 404 page without).
  assert.notEqual((await person.get('/portal')).status, 302);
  assert.notEqual((await admin.get('/portal/approvals')).status, 302);
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
  const served = page.body.toString('utf8');
  const returnAt = served.indexOf('<style>.ar-return');
  const bodyEnd = REPORT_HTML.toLowerCase().lastIndexOf('</body>');
  assert.ok(returnAt > 0, 'a way back to the portal is added at the foot of the page');
  assert.equal(served.slice(0, returnAt), bodyEnd === -1 ? REPORT_HTML : REPORT_HTML.slice(0, bodyEnd), 'the report itself is served exactly as published, not as a download');
  assert.match(served, /<nav class="ar-return" aria-label="Portal"><a href="\/portal">Return to your client portal<\/a><\/nav>/);
  assert.equal(page.headers.get('content-disposition'), null);

  const csp = page.headers.get('content-security-policy');
  assert.match(csp.split(';').find((d) => d.trim().startsWith('style-src ')), /'sha256-[A-Za-z0-9+/=]+'/, 'the return link\u2019s style is hashed like the report\u2019s own');
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'(;|$)/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp.split(';').find((d) => d.trim().startsWith('script-src ')), /unsafe-inline/);

  assert.equal((await b.person.get(`/portal/report/${report.id}`)).status, 404, 'another client');
  const signedOut = await browser().get(`/portal/report/${report.id}`);
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get('location'), '/client-login');
  const teamPage = await admin.get(`/portal/report/${report.id}`);
  assert.equal(teamPage.status, 200, 'the team can open it');
  assert.ok(teamPage.body.toString('utf8').includes(`<a href="/portal/client#client=${a.client.id}">Return to this client\u2019s portal</a>`), 'the team goes back to that client\u2019s page');
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
  assert.equal(signedIn.body.next, '/portal/approvals');
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
  assert.equal((await op.person.get('/portal')).headers.get('location'), '/portal/approvals');
  assert.equal((await op.person.get('/portal/approvals')).status, 200);
  assert.equal((await op.person.get('/portal/clients')).status, 200);
  assert.equal((await op.person.get('/portal/operators')).headers.get('location'), '/portal/approvals', 'Operators is for masters');
  assert.equal((await op.person.get('/portal/repository')).headers.get('location'), '/portal/approvals', 'and so is the Repository');
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

test('masters replace a team file in place: notes stay, and nobody else can', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson', email: 'emerson@accessrank.test' });
  const file = (await owner.upload('/api/portal/team-files?name=scope-v1.pdf', PDF)).body.file;
  const note = await owner.post('/api/portal/team-notes', { fileId: file.id, body: 'Waiting on legal.' });
  assert.equal(note.status, 201);
  const next = Buffer.concat([PDF, Buffer.from('\n% v2')]);

  const done = await owner.replace(`/api/portal/team-files/${file.id}?name=scope-v2.pdf`, next);
  assert.equal(done.status, 200);
  assert.equal(done.body.file.id, file.id);
  assert.equal(done.body.file.name, 'scope-v2.pdf');
  assert.equal(done.body.file.size, next.length);
  assert.deepEqual(Buffer.from((await owner.get(`/api/portal/team-files/${file.id}`)).body), next);
  const listed = (await owner.get('/api/portal/team-files')).body.files.filter((f) => f.id === file.id);
  assert.equal(listed.length, 1, 'replaced, not duplicated');
  assert.equal((await owner.get('/api/portal/team-notes')).body.notes.filter((n) => n.fileId === file.id).length, 1, 'the note stayed with the file');

  assert.equal((await owner.replace(`/api/portal/team-files/${file.id}?name=empty.pdf`, Buffer.alloc(0))).status, 400);
  assert.equal((await owner.replace('/api/portal/team-files/00000000-0000-4000-8000-000000000000?name=x.pdf', PDF)).status, 404);
  assert.equal((await op.person.replace(`/api/portal/team-files/${file.id}?name=x.pdf`, PDF)).status, 404, 'regular operators cannot');
  assert.equal((await mine.person.replace(`/api/portal/team-files/${file.id}?name=x.pdf`, PDF)).status, 404, 'clients cannot');
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

/* ------------------------------------------------------ team repository --- */

test('the team repository is a master-only drawer: add, download, delete', async () => {
  const owner = await adminBrowser();
  const master = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.41');
  const plain = await operatorWithLogin(owner, { name: 'Priya', email: 'priya@accessrank.test' }, '198.51.100.42');
  const client = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');

  const empty = await master.person.get('/api/portal/team-files');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.files, []);
  assert.equal(empty.body.maxFileBytes, 1024 * 1024);

  const added = await master.person.upload('/api/portal/team-files?name=Operator%20handbook.pdf', PDF);
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.file.name, 'Operator handbook.pdf');
  assert.equal(added.body.file.size, PDF.length);
  assert.equal(added.body.file.addedByEmail, 'carlos@accessrank.test');
  assert.equal(added.body.file.addedByName, 'Carlos');
  const id = added.body.file.id;

  // Any master sees it, including the owner login, and can download the same bytes.
  assert.equal((await owner.get('/api/portal/team-files')).body.files.length, 1);
  const download = await owner.get(`/api/portal/team-files/${id}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(download.body, PDF);

  // Nobody else can see, add, fetch or delete: it answers as if it were not there.
  for (const who of [plain.person, client.person, browser()]) {
    const denied = who === plain.person || who === client.person ? 404 : 401;
    assert.equal((await who.get('/api/portal/team-files')).status, denied);
    assert.equal((await who.upload('/api/portal/team-files?name=x.pdf', PDF)).status, denied);
    assert.equal((await who.get(`/api/portal/team-files/${id}`)).status, denied);
    assert.equal((await who.del(`/api/portal/team-files/${id}`)).status, denied);
  }
  assert.equal((await master.person.get('/api/portal/team-files')).body.files.length, 1, 'the refused attempts changed nothing');

  assert.equal((await master.person.upload('/api/portal/team-files?name=empty.pdf', Buffer.alloc(0))).status, 400);
  assert.equal((await master.person.upload('/api/portal/team-files?name=big.pdf', Buffer.alloc(1024 * 1024 + 1, 0x20))).status, 413);

  assert.equal((await master.person.del(`/api/portal/team-files/${id}`)).status, 200);
  assert.equal((await master.person.get(`/api/portal/team-files/${id}`)).status, 404);
  assert.equal((await master.person.del(`/api/portal/team-files/${id}`)).status, 404);
  assert.deepEqual((await master.person.get('/api/portal/team-files')).body.files, []);
});

test('a file in the team repository is never reachable through a client', async () => {
  const owner = await adminBrowser();
  const a = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const added = await owner.upload('/api/portal/team-files?name=Internal.pdf', PDF);
  assert.equal(added.status, 201);
  assert.equal((await a.person.get(`/api/portal/files/${added.body.file.id}`)).status, 404, 'the client file route does not serve it');
  assert.equal((await a.person.get('/api/portal/me')).body.files.length, 0);
});

test('a master creates a client portal in one step: client, first login and assigned operators', async () => {
  const owner = await adminBrowser();
  const plain = await operatorWithLogin(owner, { name: 'Priya', email: 'priya@accessrank.test' }, '198.51.100.51');
  const master = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.52');

  // Name only still works.
  const bare = await master.person.post('/api/portal/admin/clients', { name: 'Bare Co.' });
  assert.equal(bare.status, 201);
  assert.equal(bare.body.login, null);

  // Everything at once.
  const made = await master.person.post('/api/portal/admin/clients', {
    name: 'Larkspur Tea Co.',
    login: { name: 'Sam Lark', email: 'sam@larkspur.test' },
    operatorIds: [plain.operator.id],
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.client.name, 'Larkspur Tea Co.');
  assert.ok(made.body.login.password.length >= 10);
  assert.equal(made.body.login.user.email, 'sam@larkspur.test');

  const sam = browser('198.51.100.53');
  assert.equal((await sam.login({ email: 'sam@larkspur.test', password: made.body.login.password })).status, 200);

  const mine = await plain.person.get('/api/portal/admin/clients');
  assert.ok(mine.body.clients.some((c) => c.id === made.body.client.id), 'the assigned operator sees it');
  assert.ok(!mine.body.clients.some((c) => c.id === bare.body.client.id), 'and not the unassigned one');

  // A refused login leaves no half-made client behind.
  const before = (await master.person.get('/api/portal/admin/clients')).body.clients.length;
  const dup = await master.person.post('/api/portal/admin/clients', { name: 'Dup Co.', login: { email: 'sam@larkspur.test' } });
  assert.equal(dup.status, 409);
  const reserved = await master.person.post('/api/portal/admin/clients', { name: 'Res Co.', login: { email: 'carlos@accessrank.test' } });
  assert.equal(reserved.status, 400);
  const badOp = await master.person.post('/api/portal/admin/clients', { name: 'Op Co.', operatorIds: ['not-an-operator'] });
  assert.equal(badOp.status, 404);
  assert.equal((await master.person.get('/api/portal/admin/clients')).body.clients.length, before);

  // Only masters.
  assert.equal((await plain.person.post('/api/portal/admin/clients', { name: 'Nope', login: { email: 'n@x.test' } })).status, 404);
});

test('team notes: sit under a file, masters add, edit and delete them; nobody else can see or change them', async () => {
  const owner = await adminBrowser();
  const master = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.61');
  const plain = await operatorWithLogin(owner, { name: 'Priya', email: 'priya@accessrank.test' }, '198.51.100.62');
  const client = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

  const fileA = (await master.person.upload('/api/portal/team-files?name=Readiness.pdf', PDF)).body.file;
  const fileB = (await master.person.upload('/api/portal/team-files?name=Cart%20tests.pdf', PDF)).body.file;
  assert.deepEqual((await master.person.get('/api/portal/team-notes')).body.notes, []);

  const first = await master.person.post('/api/portal/team-notes', { fileId: fileA.id, body: '  Handbook v3 is up.  ', authorName: 'Someone Else', authorEmail: 'fake@x.test' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.note.body, 'Handbook v3 is up.');
  assert.equal(first.body.note.fileId, fileA.id);
  assert.equal(first.body.note.authorName, 'Carlos');
  assert.equal(first.body.note.authorEmail, 'carlos@accessrank.test', 'the author comes from the session');
  assert.equal(first.body.note.updatedAt, null);
  assert.ok(!Number.isNaN(Date.parse(first.body.note.createdAt)));

  assert.equal((await owner.post('/api/portal/team-notes', { fileId: fileB.id, body: 'From the owner.' })).status, 201);
  const list = (await master.person.get('/api/portal/team-notes')).body.notes;
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((n) => n.fileId), [fileA.id, fileB.id], 'oldest first, each carrying its file');

  assert.equal((await master.person.post('/api/portal/team-notes', { fileId: fileA.id, body: '   ' })).body.code, 'note_empty');
  assert.equal((await master.person.post('/api/portal/team-notes', { fileId: fileA.id, body: 'x'.repeat(2001) })).body.code, 'note_long');
  assert.equal((await master.person.post('/api/portal/team-notes', { fileId: '00000000-0000-4000-8000-000000000000', body: 'orphan' })).status, 404, 'a note needs a file');
  assert.equal((await master.person.post('/api/portal/team-notes', { body: 'no file' })).body.code, 'note_target', 'a note needs a file or a task');
  assert.equal((await master.person.post('/api/portal/team-notes', { fileId: fileA.id, taskId: fileB.id, body: 'both' })).body.code, 'note_target');

  // Edit: any master can; the author and first time stay, and the edit is marked.
  const edited = await owner.patch(`/api/portal/team-notes/${first.body.note.id}`, { body: ' Handbook v4 is up. ' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.note.body, 'Handbook v4 is up.');
  assert.equal(edited.body.note.authorEmail, 'carlos@accessrank.test', 'editing keeps the original author');
  assert.equal(edited.body.note.createdAt, first.body.note.createdAt);
  assert.ok(edited.body.note.updatedAt);
  assert.equal((await master.person.patch(`/api/portal/team-notes/${first.body.note.id}`, { body: ' ' })).body.code, 'note_empty');
  assert.equal((await master.person.patch('/api/portal/team-notes/not-a-uuid', { body: 'x' })).status, 404);

  for (const who of [plain.person, client.person]) {
    assert.equal((await who.get('/api/portal/team-notes')).status, 404);
    assert.equal((await who.post('/api/portal/team-notes', { fileId: fileA.id, body: 'nope' })).status, 404);
    assert.equal((await who.patch(`/api/portal/team-notes/${first.body.note.id}`, { body: 'nope' })).status, 404);
    assert.equal((await who.del(`/api/portal/team-notes/${first.body.note.id}`)).status, 404);
  }
  assert.equal((await browser().get('/api/portal/team-notes')).status, 401);
  assert.equal((await master.person.get('/api/portal/team-notes')).body.notes[0].body, 'Handbook v4 is up.', 'the refused attempts changed nothing');

  // Delete a note, then delete a file and its notes go with it.
  assert.equal((await master.person.del(`/api/portal/team-notes/${first.body.note.id}`)).status, 200);
  assert.equal((await master.person.del(`/api/portal/team-notes/${first.body.note.id}`)).status, 404);
  assert.equal((await master.person.get('/api/portal/team-notes')).body.notes.length, 1);
  assert.equal((await master.person.del(`/api/portal/team-files/${fileB.id}`)).status, 200);
  assert.deepEqual((await master.person.get('/api/portal/team-notes')).body.notes, [], 'a deleted file takes its notes with it');
});

test('team punch list: masters add, edit, tick off and delete tasks; nobody else can reach it', async () => {
  const owner = await adminBrowser();
  const master = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.63');
  const plain = await operatorWithLogin(owner, { name: 'Priya', email: 'priya@accessrank.test' }, '198.51.100.64');
  const client = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');

  assert.deepEqual((await master.person.get('/api/portal/team-tasks')).body.tasks, []);

  const added = await master.person.post('/api/portal/team-tasks', { text: '  Review the   readiness report ', authorEmail: 'fake@x.test' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const task = added.body.task;
  assert.equal(task.text, 'Review the readiness report');
  assert.equal(task.done, false);
  assert.equal(task.authorEmail, 'carlos@accessrank.test', 'the author comes from the session');
  assert.equal((await owner.post('/api/portal/team-tasks', { text: 'Second task' })).status, 201);
  assert.deepEqual((await master.person.get('/api/portal/team-tasks')).body.tasks.map((t) => t.text), ['Review the readiness report', 'Second task'], 'oldest first');

  assert.equal((await master.person.post('/api/portal/team-tasks', { text: '  ' })).body.code, 'task_empty');
  assert.equal((await master.person.post('/api/portal/team-tasks', { text: 'x'.repeat(301) })).body.code, 'task_long');

  const renamed = await owner.patch(`/api/portal/team-tasks/${task.id}`, { text: 'Review and integrate the report' });
  assert.equal(renamed.body.task.text, 'Review and integrate the report');
  assert.equal(renamed.body.task.done, false);
  const ticked = await master.person.patch(`/api/portal/team-tasks/${task.id}`, { done: true });
  assert.equal(ticked.body.task.done, true);
  assert.ok(ticked.body.task.doneAt);
  assert.equal(ticked.body.task.text, 'Review and integrate the report', 'ticking leaves the text alone');
  const unticked = await master.person.patch(`/api/portal/team-tasks/${task.id}`, { done: false });
  assert.equal(unticked.body.task.done, false);
  assert.equal(unticked.body.task.doneAt, null);
  assert.equal((await master.person.patch(`/api/portal/team-tasks/${task.id}`, {})).body.code, 'task_nochange');
  assert.equal((await master.person.patch('/api/portal/team-tasks/not-a-uuid', { done: true })).status, 404);

  for (const who of [plain.person, client.person]) {
    assert.equal((await who.get('/api/portal/team-tasks')).status, 404);
    assert.equal((await who.post('/api/portal/team-tasks', { text: 'nope' })).status, 404);
    assert.equal((await who.patch(`/api/portal/team-tasks/${task.id}`, { done: true })).status, 404);
    assert.equal((await who.del(`/api/portal/team-tasks/${task.id}`)).status, 404);
  }
  assert.equal((await browser().get('/api/portal/team-tasks')).status, 401);

  assert.equal((await master.person.del(`/api/portal/team-tasks/${task.id}`)).status, 200);
  assert.equal((await master.person.del(`/api/portal/team-tasks/${task.id}`)).status, 404);
  assert.equal((await master.person.get('/api/portal/team-tasks')).body.tasks.length, 1);
});

test('team notes on punch list tasks: add, edit, delete, and they go when the task goes', async () => {
  const owner = await adminBrowser();
  const master = await operatorWithLogin(owner, { name: 'Carlos', email: 'carlos@accessrank.test', role: 'master' }, '198.51.100.65');
  const plain = await operatorWithLogin(owner, { name: 'Priya', email: 'priya@accessrank.test' }, '198.51.100.66');

  const taskA = (await master.person.post('/api/portal/team-tasks', { text: 'Review the report' })).body.task;
  const taskB = (await master.person.post('/api/portal/team-tasks', { text: 'Book the vendor' })).body.task;

  const added = await master.person.post('/api/portal/team-notes', { taskId: taskA.id, body: '  Compare against the GEO report.  ', authorEmail: 'fake@x.test' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.note.taskId, taskA.id);
  assert.equal(added.body.note.fileId, null);
  assert.equal(added.body.note.body, 'Compare against the GEO report.');
  assert.equal(added.body.note.authorEmail, 'carlos@accessrank.test', 'the author comes from the session');
  assert.equal((await owner.post('/api/portal/team-notes', { taskId: taskB.id, body: 'Second' })).status, 201);
  assert.equal((await master.person.post('/api/portal/team-notes', { taskId: '00000000-0000-4000-8000-000000000000', body: 'orphan' })).status, 404);
  assert.equal((await master.person.post('/api/portal/team-notes', { taskId: taskA.id, body: ' ' })).body.code, 'note_empty');
  assert.equal((await plain.person.post('/api/portal/team-notes', { taskId: taskA.id, body: 'nope' })).status, 404);

  const all = (await master.person.get('/api/portal/team-notes')).body.notes;
  assert.deepEqual(all.map((n) => n.taskId), [taskA.id, taskB.id]);

  const edited = await owner.patch(`/api/portal/team-notes/${added.body.note.id}`, { body: 'Compared.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.note.taskId, taskA.id);
  assert.equal(edited.body.note.authorEmail, 'carlos@accessrank.test');
  assert.ok(edited.body.note.updatedAt);

  assert.equal((await master.person.del(`/api/portal/team-notes/${all[1].id}`)).status, 200);
  assert.equal((await master.person.del(`/api/portal/team-tasks/${taskA.id}`)).status, 200);
  assert.deepEqual((await master.person.get('/api/portal/team-notes')).body.notes, [], 'a deleted task takes its notes with it');
});

test('client file notes: staff add, edit and delete them on Other files and Past approvals; clients never see them', async () => {
  const owner = await adminBrowser();
  const mine = await clientWithLogin(owner, 'Top Seedz', 'jordan@topseedz.test');
  const theirs = await clientWithLogin(owner, 'Larkspur Tea Co.', 'sam@larkspur.test');
  const op = await operatorWithLogin(owner, { name: 'Emerson Dev', email: 'emerson@accessrank.test' });
  await owner.put(`/api/portal/operators/${op.operator.id}/clients`, { clientIds: [mine.client.id] });
  const upload = async (c, name, area) => (await owner.upload(`/api/portal/admin/clients/${c.client.id}/files?name=${name}&area=${area}`, PDF)).body.file;
  const other = await upload(mine, 'other.pdf', 'files');
  const past = await upload(mine, 'signed.pdf', 'approvals');
  const compliance = await upload(mine, 'vpat.pdf', 'compliance');
  const theirFile = await upload(theirs, 'secret.pdf', 'files');
  const notesOf = async (id) => (await owner.get('/api/portal/admin/clients')).body.clients.find((c) => c.id === mine.client.id).files.find((f) => f.id === id).notes;

  // Add: trimmed, authored by the session (never the body), on both areas.
  const first = await owner.post(`/api/portal/admin/files/${other.id}/notes`, { body: '  Waiting on legal.  ', authorName: 'Someone Else' });
  assert.equal(first.status, 201);
  assert.equal(first.body.note.body, 'Waiting on legal.');
  assert.notEqual(first.body.note.authorName, 'Someone Else');
  assert.equal(first.body.note.updatedAt, null);
  const pastNote = await op.person.post(`/api/portal/admin/files/${past.id}/notes`, { body: 'Signed 11/2.' });
  assert.equal(pastNote.status, 201, 'an assigned operator can');
  assert.deepEqual((await notesOf(other.id)).map((n) => n.body), ['Waiting on legal.']);
  assert.deepEqual((await notesOf(past.id)).map((n) => n.body), ['Signed 11/2.']);

  // Refused: empty, too long, Compliance files, missing files.
  assert.equal((await owner.post(`/api/portal/admin/files/${other.id}/notes`, { body: '   ' })).body.code, 'note_empty');
  assert.equal((await owner.post(`/api/portal/admin/files/${other.id}/notes`, { body: 'x'.repeat(2001) })).body.code, 'note_long');
  assert.equal((await owner.post(`/api/portal/admin/files/${compliance.id}/notes`, { body: 'nope' })).body.code, 'note_area');
  assert.equal((await owner.post('/api/portal/admin/files/00000000-0000-4000-8000-000000000000/notes', { body: 'orphan' })).status, 404);

  // Edit: the body and updatedAt change, the author and created time do not.
  const edited = await owner.patch(`/api/portal/admin/file-notes/${first.body.note.id}`, { body: ' Legal approved. ' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.note.body, 'Legal approved.');
  assert.ok(edited.body.note.updatedAt);
  assert.equal(edited.body.note.authorEmail, first.body.note.authorEmail);
  assert.equal(edited.body.note.createdAt, first.body.note.createdAt);
  assert.equal((await owner.patch(`/api/portal/admin/file-notes/${first.body.note.id}`, { body: '' })).body.code, 'note_empty');

  // Nobody outside the team, and no operator outside their clients, can reach them.
  const theirNote = (await owner.post(`/api/portal/admin/files/${theirFile.id}/notes`, { body: 'Theirs.' })).body.note;
  assert.equal((await op.person.post(`/api/portal/admin/files/${theirFile.id}/notes`, { body: 'x' })).status, 404);
  assert.equal((await op.person.patch(`/api/portal/admin/file-notes/${theirNote.id}`, { body: 'x' })).status, 404);
  assert.equal((await op.person.del(`/api/portal/admin/file-notes/${theirNote.id}`)).status, 404);
  assert.equal((await mine.person.post(`/api/portal/admin/files/${other.id}/notes`, { body: 'x' })).status, 404, 'a client login cannot add');
  assert.equal((await mine.person.patch(`/api/portal/admin/file-notes/${first.body.note.id}`, { body: 'x' })).status, 404);
  assert.equal((await mine.person.del(`/api/portal/admin/file-notes/${first.body.note.id}`)).status, 404);
  // The client reads the notes on their own Other files and Past approvals, by author name only, and cannot change them.
  const seen = (await mine.person.get('/api/portal/me')).body.files;
  assert.deepEqual(seen.find((f) => f.id === other.id).notes.map((n) => n.body), ['Legal approved.']);
  assert.deepEqual(seen.find((f) => f.id === past.id).notes.map((n) => n.body), ['Signed 11/2.']);
  assert.deepEqual(seen.find((f) => f.id === compliance.id).notes, [], 'Compliance files carry none');
  assert.ok(!JSON.stringify(seen).includes('@accessrank.test'), 'no staff email address reaches a client');
  assert.ok(!JSON.stringify((await theirs.person.get('/api/portal/me')).body.files).includes('Legal approved.'), 'another client sees none of it');

  // Delete, and deleting a file takes its notes with it.
  assert.equal((await owner.del(`/api/portal/admin/file-notes/${first.body.note.id}`)).status, 200);
  assert.equal((await owner.del(`/api/portal/admin/file-notes/${first.body.note.id}`)).status, 404);
  assert.deepEqual(await notesOf(other.id), []);
  assert.equal((await owner.del(`/api/portal/admin/files/${past.id}`)).status, 200);
  assert.equal((await owner.patch(`/api/portal/admin/file-notes/${pastNote.body.note.id}`, { body: 'x' })).status, 404, 'its notes went with it');
});

/* ------------------------------------------------- work to do and ACR --- */

test('work to do: ticking approved items, queuing them for the ACR, and publishing the ACR', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Top Seedz', 'jordan@topseedz.test');
  const report = await publish(admin, a.client.id, 'Contact details and fixes');
  const saved = await a.person.post(`/api/portal/reports/${report.id}/approvals`, {
    name: 'Jordan Rivera',
    items: [
      { key: 'd1', title: 'Add alt text to product images', decision: 'approve', choice: 'Human-written' },
      { key: 'c2', title: 'Accessibility email address', decision: 'changes', comment: 'info@topseedz.test' },
    ],
  });
  assert.equal(saved.status, 201);
  const work = (key) => `/api/portal/admin/reports/${report.id}/work/${key}`;

  // Queuing needs a draft to apply the change to.
  const noDraft = await admin.put(work('d1'), { done: true, queue: true, criterion: '1.1.1 Non-text Content', conformance: 'supports' });
  assert.equal(noDraft.status, 409);
  assert.equal(noDraft.body.code, 'acr_draft_required');

  // A client login can't reach any of this.
  assert.equal((await a.person.put(work('d1'), { done: true })).status, 404);
  assert.equal((await a.person.get(`/api/portal/admin/clients/${a.client.id}/acr`)).status, 404);

  const draft = await admin.upload(`/api/portal/admin/clients/${a.client.id}/acr/drafts?name=${encodeURIComponent('Top Seedz ACR v3.docx')}`, PDF);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal((await a.person.get(`/api/portal/admin/acr-drafts/${draft.body.draft.id}`)).status, 404, 'drafts are team only');
  assert.ok(!(await a.person.get('/api/portal/me')).body.files.some((f) => f.name === 'Top Seedz ACR v3.docx'), 'and not in the client file list');

  const queued = await admin.put(work('d1'), { done: true, queue: true, criterion: '1.1.1 Non-text Content', conformance: 'supports', note: 'Checked with VoiceOver' });
  assert.equal(queued.status, 200, JSON.stringify(queued.body));
  assert.equal(queued.body.work.acrState, 'queued');
  assert.ok(queued.body.work.doneAt);
  const later = await admin.put(work('c2'), { done: true, queue: false });
  assert.equal(later.body.work.acrState, 'none');
  assert.equal((await admin.put(work('zz'), { done: true })).status, 404, 'only answered items');
  assert.equal((await admin.put(work('d1'), { done: true, conformance: 'great' })).status, 400);

  const seen = (await admin.get('/api/portal/admin/approvals')).body.reports[0];
  assert.equal(seen.items.find((i) => i.key === 'd1').work.acrState, 'queued');
  assert.equal(seen.acrDraft.name, 'Top Seedz ACR v3.docx');

  const acr = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr`)).body;
  assert.equal(acr.queue.length, 1);
  assert.equal(acr.queue[0].title, 'Add alt text to product images');
  assert.equal(acr.drafts.length, 1);

  const update = await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/update?format=txt`);
  assert.equal(update.status, 200);
  const text = update.body.toString('utf8');
  assert.match(text, /Apply to: Top Seedz ACR v3\.docx/);
  assert.match(text, /1\.1\.1 Non-text Content -> Supports/);
  assert.match(text, /Team note: Checked with VoiceOver/);

  const published = await admin.upload(`/api/portal/admin/clients/${a.client.id}/acr/publish?name=${encodeURIComponent('Top Seedz ACR v4.pdf')}`, PDF);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.applied, 1);
  const files = (await a.person.get('/api/portal/me')).body.files;
  assert.ok(files.some((f) => f.name === 'Top Seedz ACR v4.pdf' && f.area === 'compliance'), 'the published ACR reaches the client');

  const after = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr`)).body;
  assert.equal(after.queue.length, 0);
  assert.equal(after.drafts[0].name, 'Top Seedz ACR v4.pdf');
  assert.equal(after.drafts[0].published, true);

  const undone = await admin.put(work('d1'), { done: false });
  assert.equal(undone.body.work.done, false);
  assert.equal(undone.body.work.acrState, 'none');
});

test('ACR update: an approved accessibility statement goes in word for word', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Freshe', 'lisa@freshe.test');
  const html = `<!DOCTYPE html><html lang="en"><head><title>Statement</title></head><body><main>
    <h2>The proposed statement</h2>
    <div class="statement"><h3>Accessibility Statement</h3><p>Freshe Meals wants freshemeals.com to work for everyone &amp; every device.</p>
      <h3>What we have done</h3><ul><li>Clear focus outlines</li><li>Alt text on photos</li></ul>
      <p>Last reviewed <mark>[date of publication]</mark>.</p></div>
    <div class="stmt"><p>Proposed footer text</p></div>
  </main></body></html>`;
  const report = await publish(admin, a.client.id, 'Statement and footer approval', html);
  await a.person.post(`/api/portal/reports/${report.id}/approvals`, {
    name: 'Lisa Park',
    items: [
      { key: 'statement', title: 'Section 1: the proposed accessibility statement', decision: 'approve' },
      { key: 'footer', title: 'Section 3: the Accessrank footer addition', decision: 'approve' },
    ],
  });
  await admin.upload(`/api/portal/admin/clients/${a.client.id}/acr/drafts?name=${encodeURIComponent('Freshe ACR v1.docx')}`, PDF);
  const work = (key) => `/api/portal/admin/reports/${report.id}/work/${key}`;
  assert.equal((await admin.put(work('statement'), { done: true, queue: true })).status, 200);
  assert.equal((await admin.put(work('footer'), { done: true, queue: true })).status, 200);

  const acr = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr`)).body;
  const st = acr.queue.find((w) => w.key === 'statement').statement;
  assert.deepEqual(st.blocks.map((b) => b.type), ['heading', 'paragraph', 'heading', 'item', 'item', 'paragraph']);
  assert.equal(st.blocks[1].text, 'Freshe Meals wants freshemeals.com to work for everyone & every device.');
  assert.deepEqual(st.placeholders, ['[date of publication]']);
  assert.equal(acr.queue.find((w) => w.key === 'footer').statement, undefined, 'only the statement item carries text');

  const text = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/update?format=txt`)).body.toString('utf8');
  assert.match(text, /Approved statement text, word for word:/);
  assert.match(text, /- Alt text on photos/);
  assert.match(text, /Fill in before publishing: \[date of publication\]/);
  assert.ok(!text.includes('Proposed footer text'));
});

test('ACR merge: an HTML draft gets the approved changes merged in, and publishing needs no upload', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Freshe', 'lisa@freshe.test');
  const report = await publish(admin, a.client.id, 'Statement approval', `<!DOCTYPE html><html lang="en"><head><title>S</title></head><body><main>
    <div class="statement"><h3>Accessibility Statement</h3><p>Freshe wants everyone in.</p></div></main></body></html>`);
  await a.person.post(`/api/portal/reports/${report.id}/approvals`, {
    name: 'Lisa Park', items: [{ key: 'statement', title: 'Section 1: the proposed accessibility statement', decision: 'approve' }],
  });
  const draftHtml = `<!DOCTYPE html><html><body><main><p><span data-acr="version">Version 1.0</span></p>
    <table data-acr="remediation-log"><tbody><tr><td>Oct 26</td><td>Alt text</td><td>Done</td></tr></tbody></table>
    <div data-acr="statement"><p>Old proposed wording</p></div></main></body></html>`;
  const up = await admin.upload(`/api/portal/admin/clients/${a.client.id}/acr/drafts?name=${encodeURIComponent('Freshe ACR Draft.html')}`, Buffer.from(draftHtml));
  assert.equal(up.status, 201);
  assert.equal(up.body.draft.mergeable, true);
  assert.equal((await admin.put(`/api/portal/admin/reports/${report.id}/work/statement`, { done: true, queue: true })).status, 200);

  const merged = await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/update?format=html`);
  assert.equal(merged.status, 200);
  const html = merged.body.toString('utf8');
  assert.match(html, /Version 1\.1</);
  assert.match(html, /<p>Freshe wants everyone in\.<\/p>/);
  assert.ok(!html.includes('Old proposed wording'));
  assert.match(html, /<td>Section 1: the proposed accessibility statement<\/td>/);

  const rendered = [];
  app.locals.renderAcrPdf = async (h, opts) => { rendered.push({ h, opts }); return Buffer.from('%PDF-1.4 merged'); };
  try {
    const built = await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/update`);
    assert.equal(built.status, 200);
    assert.match(decodeURIComponent(built.headers.get('content-disposition')), /Freshe Accessibility Compliance Record Version 1\.1\.pdf/);
    const pub = await admin.post(`/api/portal/admin/clients/${a.client.id}/acr/publish`);
    assert.equal(pub.status, 201, JSON.stringify(pub.body));
    assert.equal(pub.body.version, '1.1');
    assert.equal(pub.body.applied, 1);
    assert.equal(rendered.at(-1).opts.version, '1.1');
  } finally {
    delete app.locals.renderAcrPdf;
  }
  const files = (await a.person.get('/api/portal/me')).body.files;
  assert.ok(files.some((f) => f.name === 'Freshe Accessibility Compliance Record Version 1.1.pdf' && f.area === 'compliance'));
  assert.ok(files.some((f) => f.name === 'Freshe Accessibility Compliance Record Version 1.1.html' && f.area === 'compliance'), 'the HTML goes to the client too');
  const after = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr`)).body;
  assert.equal(after.queue.length, 0);
  assert.equal(after.drafts[0].name, 'Freshe Accessibility Compliance Record Version 1.1.html', 'the merged ACR is the next draft');
  assert.equal(after.drafts[0].mergeable, true);
  assert.equal((await admin.post(`/api/portal/admin/clients/${a.client.id}/acr/publish`)).status, 409, 'nothing queued');
});

test('ACR draft upload is checked against the client’s answers, and the preview says what Build will change', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Seedco', 'angie@seedco.test');
  const report = await publish(admin, a.client.id, 'Statement and footer', `<!DOCTYPE html><html lang="en"><head><title>S</title></head><body><main>
    <div class="statement"><h3>Accessibility Statement</h3><p>Seedco wants everyone in.</p></div></main></body></html>`);
  await a.person.post(`/api/portal/reports/${report.id}/approvals`, {
    name: 'Angie Moe', items: [
      { key: 'statement', title: 'Accessibility statement text', decision: 'approve' },
      { key: 'email', title: 'Accessibility email address', decision: 'comment', comment: 'info@seedco.test' },
    ],
  });
  // The draft uses the template's names: "statement" matches, "contacts" has no answer, "email" is never used.
  const draftHtml = `<!DOCTYPE html><html><body><main><p><span data-acr="version">Version 1.0 draft</span></p>
    <table data-acr="remediation-log" data-acr-order="newest-first"><tbody><tr><td>Oct 26</td><td>Alt text</td></tr></tbody></table>
    <p><span data-acr-until="statement">Not yet published.</span><span data-acr-when="statement" hidden>Published <span data-acr-fill="statement" data-acr-format="{{@live}}">[date]</span>.</span></p>
    <p>Contact: <span data-acr-fill="contacts" data-acr-format="{{Contact email}}">[email]</span></p>
    <div class="sechead" id="exd"><h2>Accessibility statement</h2></div><div class="statement"><p>Approved wording.</p></div>
    </main></body></html>`;
  const up = await admin.upload(`/api/portal/admin/clients/${a.client.id}/acr/drafts?name=${encodeURIComponent('Seedco ACR Draft.html')}`, Buffer.from(draftHtml));
  assert.equal(up.status, 201);
  const warnings = up.body.draft.warnings.join(' ');
  assert.match(warnings, /waits for answers named contacts/);
  assert.match(warnings, /not used anywhere in the draft: Accessibility email address/);
  assert.ok(!/statement/.test(warnings.split('This client')[0].replace('waits for answers named contacts', '')), 'a matching answer is not reported');

  assert.equal((await admin.put(`/api/portal/admin/reports/${report.id}/work/statement`, { done: true, queue: true })).status, 200);
  assert.equal((await admin.put(`/api/portal/admin/reports/${report.id}/work/email`, { done: true, queue: true })).status, 200);
  const preview = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/preview`)).body.preview;
  assert.equal(preview.mergeable, true);
  assert.equal(preview.version, '1.0');
  const st = preview.items.find((i) => i.key === 'statement');
  const em = preview.items.find((i) => i.key === 'email');
  assert.equal(st.places, 3);
  assert.deepEqual(st.flags, []);
  assert.equal(em.places, 0);
  assert.match(em.flags.join(' '), /typed answer/);
  assert.match(em.flags.join(' '), /never mentions this item/);
  assert.deepEqual(preview.notes, [], 'Exhibit D is written out, so nothing is reprinted');

  // Taking the typed answer out of the update leaves it done, and the preview drops it.
  const out = await admin.put(`/api/portal/admin/reports/${report.id}/work/email`, { done: true, queue: false });
  assert.equal(out.body.work.done, true);
  assert.equal(out.body.work.acrState, 'none');
  const again = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/preview`)).body.preview;
  assert.deepEqual(again.items.map((i) => i.key), ['statement']);

  const merged = (await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/update?format=html`)).body.toString('utf8');
  assert.ok(!merged.includes('acr-updates'), 'no Updates section');
  assert.ok(!merged.includes('Seedco wants everyone in.'), 'the statement is not reprinted');
});

test('the ACR preview and draft check are team-only and need a draft', async () => {
  const admin = await adminBrowser();
  const a = await clientWithLogin(admin, 'Nodraft', 'n@nodraft.test');
  const p = await admin.get(`/api/portal/admin/clients/${a.client.id}/acr/preview`);
  assert.equal(p.status, 200);
  assert.equal(p.body.preview.mergeable, false);
  assert.equal((await a.person.get(`/api/portal/admin/clients/${a.client.id}/acr/preview`)).status >= 401, true);
});
