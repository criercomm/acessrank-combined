import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { reportCsp, inlineHashes, withReturnLink } from '../../server/lib/reportCsp.js';

const sha = (t) => `'sha256-${crypto.createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const BASE = "default-src 'self'; script-src 'self' https://x.test; style-src 'self'; script-src-attr 'none'; frame-ancestors 'none'; connect-src 'self' https://x.test; frame-src 'self'";

test('every inline block is hashed, and empty ones and external scripts are not', () => {
  const html = '<style>a{b:c}</style><script>var x=1;</script><script src="/x.js"></script><script> </script>';
  const h = inlineHashes(html);
  assert.deepEqual(h.script, [sha('var x=1;')]);
  assert.deepEqual(h.style, [sha('a{b:c}')]);
});

test('the policy allows exactly the blocks in the document and tightens the rest', () => {
  const html = '<style>a{b:c}</style><script>go()</script>';
  const csp = reportCsp(BASE, html);
  const d = Object.fromEntries(csp.split('; ').map((x) => [x.split(' ')[0], x.split(' ').slice(1)]));
  assert.deepEqual(d['script-src'], ["'self'", sha('go()')]);
  assert.deepEqual(d['style-src'], ["'self'", sha('a{b:c}')]);
  assert.deepEqual(d['connect-src'], ["'self'"], 'the page may call only our own API');
  assert.deepEqual(d['frame-src'], ["'none'"]);
  assert.deepEqual(d['script-src-attr'], ["'none'"], 'inline event handlers stay blocked');
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.ok(!d['script-src'].includes("'unsafe-inline'"));
});

test('a different document gets different hashes', () => {
  assert.notEqual(reportCsp(BASE, '<script>a()</script>'), reportCsp(BASE, '<script>b()</script>'));
});

test('the return link goes just before </body>, is escaped, and its style is covered by the CSP', () => {
  const html = '<html><body><p>Report</p><script>var x=1;</script></BODY></html>';
  const page = withReturnLink(html, { href: '/portal', label: 'Return to your <client> portal' });
  assert.ok(page.startsWith('<html><body><p>Report</p><script>var x=1;</script><style>.ar-return'));
  assert.ok(page.endsWith('<a href="/portal">Return to your &lt;client> portal</a></nav></BODY></html>'));
  assert.equal(inlineHashes(page).style.length, 1);
  assert.match(reportCsp(BASE, page), /style-src 'self' 'sha256-/);
  assert.match(page, /@media print\{\.ar-return\{display:none\}\}/);
  // A page with no </body> still gets the link, at the end.
  assert.ok(withReturnLink('<p>x</p>', { href: '/portal', label: 'Back' }).endsWith('<a href="/portal">Back</a></nav>'));
});
