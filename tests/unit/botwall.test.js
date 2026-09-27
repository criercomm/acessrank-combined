import test from 'node:test';
import assert from 'node:assert/strict';

const { botWallReason } = await import('../../server/lib/scanner.js');

test('Cloudflare challenge header is a bot wall whatever the page says', () => {
  assert.equal(botWallReason({ headers: { 'cf-mitigated': 'challenge' }, title: 'Shop' }), 'cloudflare');
});

test('challenge titles are bot walls', () => {
  for (const title of [
    'Just a moment...', 'Just a moment…', 'Attention Required! | Cloudflare',
    'w3.org — Performing security verification', 'Access Denied', 'Pardon Our Interruption',
    'Verifying you are human. This may take a few seconds.',
  ]) {
    assert.ok(botWallReason({ title }), `"${title}" should be detected`);
  }
});

test('challenge markup is a bot wall', () => {
  assert.equal(botWallReason({ title: 'Northline Goods', marker: true }), 'challenge_markup');
});

test('ordinary store pages are not bot walls', () => {
  for (const title of [
    'Northline Goods — Trail running gear', 'Just added: fall drop', 'Security cameras | Home Depot',
    'Access to the archive', '', 'Moment watches',
  ]) {
    assert.equal(botWallReason({ headers: { server: 'cloudflare' }, title }), null, `"${title}" is a real page`);
  }
});
