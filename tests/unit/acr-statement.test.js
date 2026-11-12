import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStatement, isStatementItem, statementPlaceholders } from '../../server/lib/acr-statement.js';

test('finds the statement block in either report layout and keeps only text', () => {
  const freshe = '<div class="statement"><h3>Accessibility Statement</h3><p>We want <a href="/x">it</a> to work &amp; help.</p><ul><li><p>One</p></li></ul><script>alert(1)</script></div>';
  assert.deepEqual(extractStatement(freshe), [
    { type: 'heading', text: 'Accessibility Statement' },
    { type: 'paragraph', text: 'We want it to work & help.' },
    { type: 'item', text: 'One' },
  ]);
  const seedz = '<div class="stmt"><p>Proposed footer</p></div><div class="stmt">\n <p class="st">Accessibility Statement</p><p>Top Seedz wants</p><p class="sh">Our goal</p><p>Published <mark>[date]</mark></p></div>';
  const blocks = extractStatement(seedz);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'heading', 'paragraph']);
  assert.deepEqual(statementPlaceholders(blocks), ['[date]']);
});

test('a marked block wins, and a report with no statement gives null', () => {
  assert.deepEqual(extractStatement('<section data-acr-content="statement"><p>Custom</p></section>'), [{ type: 'paragraph', text: 'Custom' }]);
  assert.equal(extractStatement('<div class="stmt"><p>Proposed footer</p></div>'), null);
  assert.equal(extractStatement(''), null);
});

test('recognises statement approval items', () => {
  assert.ok(isStatementItem('statement', ''));
  assert.ok(isStatementItem('i9', 'Accessibility statement text (Exhibit D)'));
  assert.ok(!isStatementItem('footer', 'Section 3: the Accessrank footer addition'));
});
