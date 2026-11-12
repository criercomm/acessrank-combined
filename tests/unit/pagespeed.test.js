import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagespeed, fetchLighthouseAccessibility } from '../../server/lib/pagespeed.js';

const sample = {
  lighthouseResult: {
    lighthouseVersion: '13.0.0',
    finalDisplayedUrl: 'https://example.com/',
    configSettings: { formFactor: 'mobile' },
    categories: { accessibility: { score: 0.8 } },
  },
};

test('parsePagespeed reads the accessibility score as 0–100', () => {
  assert.deepEqual(parsePagespeed(sample), {
    accessibility: 80, lighthouseVersion: '13.0.0', finalUrl: 'https://example.com/', strategy: 'mobile',
  });
});

test('parsePagespeed returns null when the score is missing', () => {
  assert.equal(parsePagespeed({}), null);
  assert.equal(parsePagespeed({ lighthouseResult: { categories: {} } }), null);
});

test('no API key means no request and no score', async () => {
  let called = false;
  const out = await fetchLighthouseAccessibility('https://example.com/', { apiKey: '', fetchImpl: () => { called = true; } });
  assert.equal(out, null);
  assert.equal(called, false);
});

test('asks only for the accessibility category and returns the score', async () => {
  let asked;
  const out = await fetchLighthouseAccessibility('https://example.com/', {
    apiKey: 'k', timeoutMs: 1000, strategy: 'mobile',
    fetchImpl: async (u) => { asked = new URL(u); return { ok: true, json: async () => sample }; },
  });
  assert.equal(out.accessibility, 80);
  assert.equal(asked.searchParams.get('category'), 'ACCESSIBILITY');
  assert.equal(asked.searchParams.get('url'), 'https://example.com/');
});

test('an HTTP error, a thrown error or a timeout all give null, never a throw', async () => {
  const opts = { apiKey: 'k', timeoutMs: 1000, strategy: 'mobile' };
  assert.equal(await fetchLighthouseAccessibility('https://example.com/', { ...opts, fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
  assert.equal(await fetchLighthouseAccessibility('https://example.com/', { ...opts, fetchImpl: async () => { throw new Error('boom'); } }), null);
  // AbortSignal.timeout's timer is unref'd; keep the loop alive the way the running server does.
  const keepAlive = setTimeout(() => {}, 500);
  const slow = (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
  assert.equal(await fetchLighthouseAccessibility('https://example.com/', { ...opts, timeoutMs: 50, fetchImpl: slow }), null);
  clearTimeout(keepAlive);
});
