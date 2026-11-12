/**
 * Staff pass: lets the team's own browsers skip the daily scan and report limits.
 *
 * Opening /staff?pass=<STAFF_PASS> once sets a signed, HttpOnly cookie in that
 * browser. The cookie is an expiry time plus an HMAC keyed by STAFF_PASS, so it
 * cannot be forged, and changing the secret (`fly secrets set STAFF_PASS=...`)
 * invalidates every pass already issued. The code itself is never stored in the
 * browser, logged, or shown on the site. The per-minute burst limits still apply.
 */
import crypto from 'node:crypto';
import config from './config.js';

export const STAFF_COOKIE = 'ar_staff';
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function hmac(secret, expiry) {
  return crypto.createHmac('sha256', secret).update(`staff:v1:${expiry}`).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** True when `pass` is the configured staff code. Always false when none is configured. */
export function passMatches(pass, secret = config.security.staffPass) {
  return Boolean(secret) && typeof pass === 'string' && safeEqual(pass, secret);
}

export function makeStaffToken(secret = config.security.staffPass, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + MAX_AGE_SECONDS;
  return `${expiry}.${hmac(secret, expiry)}`;
}

export function verifyStaffToken(token, secret = config.security.staffPass, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const [expiry, sig] = token.split('.');
  if (!/^\d+$/.test(expiry || '') || !sig) return false;
  if (Number(expiry) * 1000 < now) return false;
  return safeEqual(sig, hmac(secret, expiry));
}

function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** True when this request comes from a browser holding a valid staff pass. */
export function isStaff(req) {
  return verifyStaffToken(readCookie(req, STAFF_COOKIE));
}

export function setStaffCookie(res) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_SECONDS}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', `${STAFF_COOKIE}=${makeStaffToken()}; ${attrs.join('; ')}`);
}

export default { isStaff, passMatches, makeStaffToken, verifyStaffToken, setStaffCookie, STAFF_COOKIE };
