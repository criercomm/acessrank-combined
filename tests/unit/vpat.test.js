import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CRITERIA, LEVELS, normalizeLevel, evidencePassages, readiness, renderVpatHtml, SCAN_CHECKABLE } from '../../server/lib/vpat.js';
import { readXlsx, readCsv, excelDate } from '../../server/lib/xlsx-read.js';

test('the criteria list is WCAG 2.2 Level A and AA: 31 + 24, no 4.1.1, no duplicates', () => {
  assert.equal(CRITERIA.length, 55);
  assert.equal(CRITERIA.filter((c) => c.level === 'A').length, 31);
  assert.equal(CRITERIA.filter((c) => c.level === 'AA').length, 24);
  assert.equal(new Set(CRITERIA.map((c) => c.id)).size, 55);
  assert.ok(!CRITERIA.some((c) => c.id === '4.1.1'));
  for (const id of SCAN_CHECKABLE) assert.ok(CRITERIA.some((c) => c.id === id), id);
  assert.equal(SCAN_CHECKABLE.size, 15);
});

test('conformance levels: the four ITI terms; Not Evaluated is recognised so it can be refused', () => {
  assert.equal(normalizeLevel('Supports'), 'supports');
  assert.equal(normalizeLevel('partially supports'), 'partially_supports');
  assert.equal(normalizeLevel('Does Not Support'), 'does_not_support');
  assert.equal(normalizeLevel('N/A'), 'not_applicable');
  assert.equal(normalizeLevel('Not Evaluated'), 'not_evaluated');
  assert.equal(normalizeLevel('maybe'), '?');
  assert.equal(normalizeLevel(''), '');
  assert.deepEqual(Object.keys(LEVELS), ['supports', 'partially_supports', 'does_not_support', 'not_applicable']);
});

test('Evidence File passages: rows and list items naming a criterion, with their section; placeholders and version numbers ignored', () => {
  const html = `<h2>Remediation log</h2><table><tr><td>Nov 4</td><td>1.4.3 Contrast: headings over photos fixed</td></tr>
    <tr><td><span class="fill">[[criterion]]</span></td><td>x</td></tr></table>
    <h2>Conformance summary</h2><table data-acr="conformance"><template data-acr-row><tr><td>{{criterion}} 2.4.7</td></tr></template>
    <tr><td>Automated scans</td><td>axe-core 4.10.2 on the live site</td><td>0 violations</td></tr>
    <tr><td>1.4.3 1.4.11 Text over photos</td><td>Sampled pixels</td><td>Now pass</td></tr></table>
    <ul><li>2.5.8 Target size: cart buttons enlarged</li></ul>`;
  const p = evidencePassages(html);
  assert.deepEqual([...p.keys()].sort(), ['1.4.11', '1.4.3', '2.5.8']);
  assert.equal(p.get('1.4.3').length, 2);
  assert.equal(p.get('1.4.3')[0].section, 'Remediation log');
  assert.match(p.get('1.4.11')[0].text, /Text over photos · Sampled pixels · Now pass/);
  assert.ok(!p.has('2.4.7'), 'row templates are skipped');
});

test('reading the results template: xlsx with dates as serials, and CSV', () => {
  const wb = readXlsx(fs.readFileSync(new URL('../fixtures/vpat-results-sample.xlsx', import.meta.url)));
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Results', 'Issues', 'Setup']);
  const results = wb.sheets[0].rows;
  assert.equal(results[0][0], 'Criterion');
  assert.equal(results[1][0], '1.1.1 Non-text Content');
  assert.equal(results[1][3], 'Supports');
  assert.equal(excelDate(results[1][9]), '2026-11-20');
  assert.deepEqual(readCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  assert.throws(() => readXlsx(Buffer.from('not a zip at all, just text padding padding')), /not an \.xlsx/);
});

const complete = () => {
  const rows = {};
  for (const c of CRITERIA) rows[c.id] = { level: 'supports', remarks: '', source: 'vendor', evidence: '', prefill: [] };
  return {
    meta: { productName: 'Test store website', description: 'An online store.', contact: 'test@example.com', evaluationMethods: 'Keyboard and NVDA.', testers: 'Test Tester', testDates: 'Nov 2026', signedBy: 'Test Tester' },
    rows,
  };
};

test('readiness: every A and AA row needs a human-given level; gaps need remarks and evidence', () => {
  const data = complete();
  assert.equal(readiness(data, { humanTesting: true }).ready, true);
  assert.equal(readiness(data, { humanTesting: false }).ready, false, 'human testing must be on');

  data.rows['1.4.3'] = { level: 'supports', source: 'evidence', remarks: '', evidence: '', prefill: [] };
  assert.ok(readiness(data, { humanTesting: true }).blockers.some((b) => b.criterion === '1.4.3'), 'an Evidence File suggestion is not an answer');

  const d2 = complete();
  d2.rows['4.1.3'] = { level: 'partially_supports', source: 'vendor', remarks: '', evidence: '', prefill: [] };
  const r2 = readiness(d2, { humanTesting: true });
  assert.equal(r2.blockers.filter((b) => b.criterion === '4.1.3').length, 2, 'needs a remark and evidence');

  const d3 = complete();
  d3.rows['2.1.1'] = { level: '', source: '', remarks: '', evidence: '', prefill: [{ section: 'x', text: 'y' }] };
  const r3 = readiness(d3, { humanTesting: true });
  assert.equal(r3.counts.open, 1);
  assert.match(r3.blockers[0].text, /^1 of 55 criteria have no level yet \(1 with Evidence File notes to start from\)/);

  const d4 = complete();
  d4.meta.signedBy = '';
  assert.ok(readiness(d4, { humanTesting: true }).blockers.some((b) => b.field === 'signedBy'));
});

test('the report follows the VPAT 2.5Rev WCAG layout and escapes what people typed', () => {
  const data = complete();
  data.rows['1.1.1'].remarks = '<script>alert(1)</script> & more';
  const html = renderVpatHtml(data, { clientName: 'Test & Co', reportDate: new Date('2026-11-21T20:00:00Z') });
  for (const s of ['Accessibility Conformance Report', 'WCAG Edition', 'Based on VPAT<sup>&reg;</sup> Version 2.5Rev', 'Table 1: Success Criteria, Level A', 'Table 2: Success Criteria, Level AA', 'Table 3: Success Criteria, Level AAA', 'Not Evaluated:', 'Legal Disclaimer', 'November 21, 2026', '4.1.1 Parsing', '2.4.11 Focus Not Obscured (Minimum) (Level AA 2.2 only)', '1.3.4 Orientation (Level AA 2.1 and 2.2)']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(!html.includes('<script>'), 'remarks are escaped');
  assert.ok(html.includes('Test &amp; Co'));
  assert.ok(!html.includes('DRAFT'));
  assert.ok(renderVpatHtml(data, { clientName: 'x', draft: true }).includes('DRAFT for Accessrank review'));
  assert.ok(!/<link|<img|src=|@import|https?:\/\/(?!www\.w3)/.test(html.replace(/<p class="mark">[\s\S]*?<\/p>/, '')), 'self-contained');
});

test('reading the results template: an empty self-closing row does not swallow the next row; inline strings are read', () => {
  const wb = readXlsx(fs.readFileSync(new URL('../fixtures/vpat-results-variant.xlsx', import.meta.url)));
  const rows = wb.sheets[0].rows;
  assert.equal(rows[1][0], '1.1.1 Non-text Content', 'inline string');
  assert.deepEqual(rows[2], [], 'row 3 is empty');
  assert.equal(rows[3][0], '1.2.2 Captions (Prerecorded)', 'row 4 is still read');
  assert.equal(rows[3][3], 'Not Applicable');
  assert.equal(rows.length, 57);
});
