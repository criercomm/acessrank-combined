import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCopy, deckBundleDrift } from '../../scripts/prerender-deck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The deck's slides are a committed build (src/assets/static/deck); its text
// version is generated from deck/src/copy.js. This fails when copy.js has moved
// on and the slides have not been rebuilt, so the two cannot drift unnoticed.
test('the committed deck bundle matches deck/src/copy.js', async () => {
  const copy = await loadCopy();
  const drift = deckBundleDrift(copy, path.join(ROOT, 'src', 'assets', 'static', 'deck'));
  assert.ok(drift.ok, drift.reason);
  assert.ok(drift.probes >= 5, 'expected at least five probes from copy.js');
});
