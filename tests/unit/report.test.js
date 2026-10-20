import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportContext, renderReportHtml, complaintPatterns, criteriaTable, closableChecks } from '../../server/lib/pdf.js';

const issues = [
  { id: 'label', impact: 'critical', nodes: 12, criteria: ['4.1.2'], level: 'A',
    sample: [{ target: '#secret-selector > input', snippet: '<input id="quantity">', summary: 'Fix any of the following' }] },
  { id: 'color-contrast', impact: 'serious', nodes: 41, criteria: ['1.4.3'], level: 'AA', sample: [] },
  { id: 'link-name', impact: 'serious', nodes: 6, criteria: ['2.4.4', '4.1.2'], level: 'A', sample: [] },
  { id: 'region', impact: 'moderate', nodes: 15, criteria: [], level: 'Best practice', sample: [] },
  { id: 'meta-viewport', impact: 'moderate', nodes: 3, criteria: ['1.4.4'], level: 'AA', sample: [] },
];

const result = {
  origin: 'https://www.shop.example',
  finalUrl: 'https://www.shop.example/',
  pagesScanned: 3,
  pageUrls: ['https://www.shop.example/', 'https://www.shop.example/products/a'],
  axeVersion: '4.12.1',
  scores: { accessibility: 76, seo: 84, overall: 76, band: { label: 'Fair', tone: 'ok' } },
  accessibility: {
    issues,
    failedCriteria: ['1.4.3', '1.4.4', '2.4.4', '4.1.2'],
    counts: { critical: 12, serious: 47, moderate: 18, minor: 0 },
    violationsTotal: 77,
  },
  seo: { checks: [{ id: 'viewport', label: 'Mobile viewport configured', status: 'pass', detail: 'width=device-width, initial-scale=1.0, height=device-height, minimum-scale=1.0' }] },
  agent: { score: 63, total: 8, passed: 5, checks: [{ id: 'crawlersAllowed', pass: true, label: 'Search and AI crawlers are allowed in' }] },
  profile: { overlays: ['accessiBe'] },
};

test('the free report carries the summary, never selectors or snippets', async () => {
  const html = await renderReportHtml(buildReportContext({ result, lead: { name: 'Dana' }, reportId: 'abcd1234' }));
  assert.doesNotMatch(html, /secret-selector/);
  assert.doesNotMatch(html, /id=&quot;quantity/);
  assert.doesNotMatch(html, /Fix any of the following/);
  assert.match(html, /For full results, contact us/);
});

test('the score is framed as a best case, without a band word', async () => {
  const ctx = buildReportContext({ result, lead: { name: 'Dana' } });
  const html = await renderReportHtml(ctx);
  assert.match(html, /best case/i);
  assert.doesNotMatch(html, />\s*Fair\s*</);
  assert.equal(ctx.access.score, 76);
});

test('headline names the failing criteria and the overlay', () => {
  const ctx = buildReportContext({ result, lead: {} });
  assert.equal(ctx.site.host, 'shop.example');
  assert.match(ctx.access.headline, /fails 4 WCAG 2\.2 success criteria and runs an accessibility overlay/);
  assert.equal(ctx.access.overlays, 'accessiBe');
  assert.equal(ctx.access.high, 59);
});

test('complaint patterns group by rule, then criterion, largest first', () => {
  const rows = complaintPatterns(issues);
  assert.deepEqual(rows.map((r) => [r.label, r.count]), [
    ['Inaccessible images and media', 41],
    ['Page structure and navigation barriers', 21],
    ['Form and authentication barriers', 12],
    ['Mobile, touch and zoom barriers', 3],
  ]);
  assert.equal(rows[0].pct, 100);
});

test('criteria table counts every element that fails each criterion', () => {
  const rows = criteriaTable(issues, ['1.4.3', '1.4.4', '2.4.4', '4.1.2']);
  assert.deepEqual(rows.map((r) => [r.id, r.elements]), [['1.4.3', 41], ['4.1.2', 18], ['2.4.4', 6], ['1.4.4', 3]]);
  assert.equal(rows.find((r) => r.id === '4.1.2').name, 'Name, Role, Value');
});

test('a clean scan reads as a pass, not a failure', () => {
  const clean = { ...result, profile: null, accessibility: { issues: [], failedCriteria: [], counts: { critical: 0, serious: 0, moderate: 0, minor: 0 }, violationsTotal: 0 } };
  const ctx = buildReportContext({ result: clean, lead: {} });
  assert.match(ctx.access.headline, /passes every WCAG 2\.2 criterion an automated check can test\.$/);
  assert.equal(ctx.access.hasIssues, false);
});

test('long raw SEO details are shortened for the table', () => {
  const ctx = buildReportContext({ result, lead: {} });
  assert.ok(ctx.rank.seoChecks[0].detail.length <= 44);
  assert.ok(ctx.rank.seoChecks[0].detail.endsWith('…'));
});

test('"Readable is step one" counts only the checks accessibility fixes close', () => {
  const check = (id, pass) => ({ id, pass });
  const all = closableChecks({ checks: [check('links', false), check('forms', false), check('structure', false), check('buttons', true)] });
  assert.equal(all.closable, 3);
  assert.equal(all.closableLabel, 'the three failing checks');

  // Crawler access and the page summary are SEO work, so they are counted as failing but never claimed.
  const some = closableChecks({ checks: [check('forms', false), check('crawlersAllowed', false), check('summary', false)] });
  assert.equal(some.closableLabel, 'one of the three failing checks');

  assert.equal(closableChecks({ checks: [check('crawlersAllowed', false)] }).closable, 0);
  assert.equal(closableChecks(null).closable, 0);
});

test('the box is left out when no accessibility-backed check fails', async () => {
  const html = await renderReportHtml(buildReportContext({ result, lead: {} }));
  assert.doesNotMatch(html, /Readable is step one/);
  const failing = { ...result, agent: { ...result.agent, checks: [{ id: 'forms', pass: false, label: 'Form fields are labeled' }] } };
  assert.match(await renderReportHtml(buildReportContext({ result: failing, lead: {} })), /also close the one failing check here/);
});
