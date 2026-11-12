import test from 'node:test';
import assert from 'node:assert/strict';
import { passMatches, makeStaffToken, verifyStaffToken } from '../../server/lib/staff.js';

test('passMatches needs a configured secret and an exact match', () => {
  assert.equal(passMatches('abc', ''), false);
  assert.equal(passMatches('abc', 'abc'), true);
  assert.equal(passMatches('abd', 'abc'), false);
  assert.equal(passMatches(undefined, 'abc'), false);
});

test('a token verifies with its secret and fails after the secret changes', () => {
  const t = makeStaffToken('s1');
  assert.equal(verifyStaffToken(t, 's1'), true);
  assert.equal(verifyStaffToken(t, 's2'), false);
  assert.equal(verifyStaffToken(t, ''), false);
});

test('tampered, malformed and expired tokens fail', () => {
  const t = makeStaffToken('s1');
  const [exp, sig] = t.split('.');
  assert.equal(verifyStaffToken(`${Number(exp) + 99999}.${sig}`, 's1'), false);
  assert.equal(verifyStaffToken('nonsense', 's1'), false);
  assert.equal(verifyStaffToken(null, 's1'), false);
  const old = makeStaffToken('s1', Date.now() - 400 * 86400_000);
  assert.equal(verifyStaffToken(old, 's1'), false);
});
