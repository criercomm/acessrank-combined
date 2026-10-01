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
  for (const path of ['/portal', '/portal/', '/portal/index.html', '/portal/admin', '/portal/admin/index.html']) {
    const { status, headers } = await nobody.get(path);
    assert.equal(status, 302, path);
    assert.equal(headers.get('location'), '/client-login', path);
    assert.equal(headers.get('cache-control'), 'private, no-store', path);
  }

  const admin = await adminBrowser();
  const { person } = await clientWithLogin(admin, 'Harbor & Pine', 'jordan@harborpine.test');

  assert.equal((await person.get('/portal/admin')).headers.get('location'), '/portal', 'a client never reaches the admin page');
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
