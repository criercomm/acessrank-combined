import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const {
  hashPassword, verifyPassword, generatePassword, normalizeLoginEmail, sanitizeFilename,
  contentTypeFor, contentDisposition, readSessionToken, SESSION_COOKIE, PortalError,
} = await import('../../server/lib/portal.js');

test('a password verifies against its own hash and nothing else', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterz', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('the same password hashes differently each time (per-login salt)', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
  assert.notEqual(a, b);
});

test('a malformed or foreign hash never verifies and never throws', async () => {
  for (const stored of ['', null, 'plaintext', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e', 'scrypt$0$0$0$AAAA$AAAA']) {
    assert.equal(await verifyPassword('anything', stored), false, String(stored));
  }
});

test('generated passwords are grouped, unambiguous and do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const password = generatePassword();
    assert.match(password, /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
    seen.add(password);
  }
  assert.equal(seen.size, 200);
});

test('sign-in emails are matched case-insensitively and junk is refused', () => {
  assert.deepEqual(normalizeLoginEmail('  Jordan@Example.COM '), { email: 'Jordan@Example.COM', key: 'jordan@example.com' });
  for (const bad of ['', 'nope', 'a@b', 'two words@example.com', '<script>@example.com']) {
    assert.throws(() => normalizeLoginEmail(bad), PortalError, bad);
  }
});

test('an uploaded filename loses its path and anything unprintable', () => {
  assert.equal(sanitizeFilename('C:\\Users\\jp\\Audit report.pdf'), 'Audit report.pdf');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..hidden'), 'hidden');
  assert.equal(sanitizeFilename('a<b>c\u0000.pdf'), 'abc .pdf');
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename('x'.repeat(400)).length, 180);
});

test('download type comes from our list, never from the uploader', () => {
  assert.equal(contentTypeFor('VPAT.PDF'), 'application/pdf');
  assert.equal(contentTypeFor('proof.mp4'), 'video/mp4');
  // Anything a browser could render as a page is served as opaque bytes.
  assert.equal(contentTypeFor('evil.html'), 'application/octet-stream');
  assert.equal(contentTypeFor('evil.svg'), 'application/octet-stream');
  assert.equal(contentTypeFor('noextension'), 'application/octet-stream');
});

test('content-disposition is always an attachment and survives odd names', () => {
  assert.equal(contentDisposition('report.pdf'), 'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf');
  const odd = contentDisposition('Freshé "final" (v2).pdf');
  assert.ok(odd.startsWith('attachment; filename="Fresh_ _final_ (v2).pdf"'));
  assert.ok(odd.endsWith("filename*=UTF-8''Fresh%C3%A9%20%22final%22%20%28v2%29.pdf"));
  assert.ok(!/[\r\n]/.test(contentDisposition('a\r\nSet-Cookie: x=1.pdf')));
});

test('the session cookie is read by exact name and shape only', () => {
  const token = 'A'.repeat(43);
  const req = (cookie) => ({ headers: { cookie } });
  assert.equal(readSessionToken(req(`other=1; ${SESSION_COOKIE}=${token}; x=y`)), token);
  assert.equal(readSessionToken(req(`not_${SESSION_COOKIE}=${token}`)), null);
  assert.equal(readSessionToken(req(`${SESSION_COOKIE}=short`)), null);
  assert.equal(readSessionToken(req(`${SESSION_COOKIE}=${'A'.repeat(30)};drop table`)), 'A'.repeat(30));
  assert.equal(readSessionToken(req(`${SESSION_COOKIE}=has spaces and <tags>`)), null);
  assert.equal(readSessionToken({ headers: {} }), null);
});
