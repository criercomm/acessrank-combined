import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAcr, draftVersion, nextVersion, isHtmlDraft, pdfTemplates } from '../../server/lib/acr-merge.js';

const day = (v) => (v ? new Date(v).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }) : '');
const meta = { builtAt: new Date('2026-11-12T18:00:00Z'), builtBy: 'JP', day, decisions: { approve: 'Approved', changes: 'Changes requested' }, conformance: { supports: 'Supports' } };

const DRAFT = `<!DOCTYPE html><html><body><main>
<p class="cover">Version <span data-acr="version">Version 1.0</span> · <span data-acr="date">November 6, 2026</span></p>
<table data-acr="history"><thead><tr><th>Date</th><th>Item</th></tr></thead><tbody>
<tr><td>November 6, 2026</td><td>Record issued</td></tr>
<template data-acr-row><tr><td>{{date}}</td><td>{{title}} by {{builtBy}}</td></tr></template>
</tbody></table>
<h2>Section 2</h2><table data-acr="remediation-log"><tbody><tr><td>Oct 26</td><td>Alt text</td><td>Done</td></tr></tbody></table>
<h2>Section 3</h2><ul data-acr="conformance"></ul>
<h2>Section 4</h2><p data-acr-until="statement" class="pending">The statement is waiting for the client's approval.</p>
<p data-acr-when="statement" hidden>The statement below was approved and is published.</p>
<p>Report contact: <span data-acr-fill="contacts">to be confirmed</span></p>
<h2>Section 7</h2><div data-acr="approvals"><p>September 1: site changes.</p></div>
<h2>Exhibit D</h2><p data-acr="statement-status">Draft for review</p><div data-acr="statement"><p>Proposed &lt;old&gt; wording</p></div>
<section data-acr="appendix"><h2>Appendix A</h2></section>
<template data-acr-pdf-footer><div>Freshé ACR <span data-acr="version">Version 1.0</span></div></template>
</main></body></html>`;

const queue = [
  { key: 'statement', title: 'Section 1: the proposed accessibility statement', decision: 'approve', choice: '', comment: '', signerName: 'Lisa Park', decidedAt: '2026-11-07T18:00:00Z', doneAt: '2026-11-10T18:00:00Z', doneByName: 'JP', note: '', criterion: '', conformance: '', reportTitle: 'Statement',
    statement: { blocks: [{ type: 'heading', text: 'Accessibility Statement' }, { type: 'paragraph', text: 'We want <everyone> in.' }, { type: 'item', text: 'Alt text' }], placeholders: [], asProposed: false } },
  { key: 'contacts', title: 'Who handles reports', decision: 'approve', choice: 'Lisa Park, lisa@freshe.test', comment: '', signerName: 'Lisa Park', decidedAt: '2026-11-07T18:00:00Z', doneAt: '2026-11-10T18:00:00Z', doneByName: 'JP', note: '', criterion: '1.1.1 Non-text Content', conformance: 'supports', reportTitle: 'Statement' },
];

test('merges approved changes into the marked places and bumps the version', () => {
  const { html, version, placed } = mergeAcr(DRAFT, { queue }, meta);
  assert.equal(version, '1.1');
  assert.deepEqual(placed, { remediation: true, approvals: true, conformance: true, statement: true });
  assert.match(html, /<span data-acr="version">Version 1\.1<\/span> · <span data-acr="date">November 12, 2026<\/span>/);
  assert.match(html, /Freshé ACR <span data-acr="version">Version 1\.1<\/span>/, 'the PDF footer template is updated too');
  assert.match(html, /<tr><td>November 12, 2026<\/td><td>Record updated to version 1\.1 by JP<\/td><\/tr>\n<template data-acr-row>/, 'history row uses the template');
  assert.match(html, /<td>November 10, 2026<\/td><td>Who handles reports<\/td><td>Client answer: Approved: Lisa Park, lisa@freshe\.test \(Lisa Park, November 7, 2026\)\./);
  assert.match(html, /<ul data-acr="conformance">\n<li><strong>Who handles reports<\/strong>/);
  assert.ok(!html.includes('waiting for the client'), 'pending note removed');
  assert.match(html, /<p data-acr-when="statement">The statement below/, 'approved note shown');
  assert.match(html, /<span data-acr-fill="contacts">Lisa Park, lisa@freshe\.test<\/span>/);
  assert.match(html, /<p data-acr="statement-status">Approved by Lisa Park on November 7, 2026\.<\/p>/);
  assert.match(html, /<div data-acr="statement"><h4>Accessibility Statement<\/h4>\n<p>We want &lt;everyone&gt; in\.<\/p>\n<ul><li>Alt text<\/li><\/ul><\/div>/);
  assert.ok(!html.includes('Proposed &lt;old&gt;'));
  assert.ok(!html.includes('acr-updates'), 'nothing left over');
  assert.equal(pdfTemplates(html).footer, '<div>Freshé ACR <span data-acr="version">Version 1.1</span></div>');
});

test('a draft with no markers still gets every change, in an Updates section', () => {
  const plain = '<html><body><main><h1>ACR</h1><p>Body</p></main></body></html>';
  const { html, version, placed } = mergeAcr(plain, { queue }, meta);
  assert.equal(version, '1.1');
  assert.equal(placed.remediation, false);
  assert.match(html, /<section class="acr-updates" data-acr-added="1\.1">\n<h2>Updates in version 1\.1<\/h2>/);
  assert.match(html, /<h3>Who handles reports<\/h3>/);
  assert.match(html, /<h3>Approved accessibility statement<\/h3>/);
  assert.match(html, /<\/section>\n<\/main>/);
});

test('a draft is issued at its own number; formats fill from field answers; newest-first logs; @page text', () => {
  const draft = `<html><head><style>@page { @bottom-left { content: "Version 1.0 draft \\00b7  November 6, 2026"; } }</style></head><body>
<p><span data-acr="version">Version 1.0 draft</span> <span data-acr="date">November 6, 2026</span></p>
<table data-acr="remediation-log" data-acr-order="newest-first"><thead><tr><th>Date</th></tr></thead>
<template data-acr-row><tr><td>{{dateShort}}</td><td>{{title}}</td></tr></template>
<tr><td>Nov 6</td><td>Older fix</td></tr></table>
<p>Contact: <span data-acr-fill="contacts" data-acr-format="{{Freshé contact name}}, {{Freshé contact email}}; footer {{footer:@choice}}"><span class="hl">[contact]</span></span></p>
<p>Days: <span data-acr-fill="contacts" data-acr-format="{{Missing field}}">[days]</span></p>
<p>Signed: <span data-acr-fill="statement" data-acr-format="{{@signer}}, {{@date}}, {{@answer}}">[x]</span></p>
<p>Exhibit C: <span class="hl" data-acr-placeholder="">[to be issued after manual testing]</span>.</p>
<p>Phone: <span data-acr-fill="contacts" data-acr-format="{{Freshé contact phone}}"><span class="hl" data-acr-placeholder="not given in the approval">[phone]</span></span></p></body></html>`;
  const q = [
    { key: 'statement', title: 'Statement', decision: 'approve', choice: 'Approved as is', comment: '', signerName: 'Lisa Park', decidedAt: '2026-11-07T18:00:00Z', doneAt: '2026-11-10T18:00:00Z' },
    { key: 'contacts', title: 'Contacts', decision: 'approve', choice: 'Option 2', comment: 'Freshé contact name: Lisa Park\nFreshé contact email: lisa@freshe.test\nNotes: none', signerName: 'Lisa Park', decidedAt: '2026-11-07T18:00:00Z', doneAt: '2026-11-11T18:00:00Z' },
    { key: 'footer', title: 'Footer', decision: 'approve', choice: 'Approved as shown', comment: '', signerName: 'Lisa Park', decidedAt: '2026-11-07T18:00:00Z', doneAt: '2026-11-11T18:00:00Z' },
  ];
  const { html, version } = mergeAcr(draft, { queue: q }, meta);
  assert.equal(version, '1.0');
  assert.match(html, /content: "Version 1\.0 \\00b7  November 12, 2026"/);
  assert.match(html, /<span data-acr="version">Version 1\.0<\/span>/);
  assert.match(html, /<\/template>\n<tr><td>Nov 11<\/td><td>Footer<\/td><\/tr>\n<tr><td>Nov 11<\/td><td>Contacts<\/td><\/tr>\n<tr><td>Nov 10<\/td><td>Statement<\/td><\/tr>/);
  assert.ok(html.indexOf('Footer</td>') < html.indexOf('Older fix'), 'new rows sit above the older ones');
  assert.match(html, />Lisa Park, lisa@freshe\.test; footer Approved as shown<\/span>/);
  assert.match(html, /data-acr-format="\{\{Missing field\}\}">\[days\]<\/span>/, 'left as is when an answer is missing');
  assert.match(html, />Lisa Park, November 7, 2026, Approved as is<\/span>/);
  assert.match(html, /<p>Exhibit C: to be issued after manual testing\.<\/p>/, 'placeholder cleared, brackets dropped');
  assert.match(html, /data-acr-format="\{\{Freshé contact phone\}\}">not given in the approval<\/span>/, 'an unanswered blank says so');
  assert.ok(!html.includes('class="hl"'));
});

test('versions and draft types', () => {
  assert.equal(draftVersion(DRAFT), '1.0');
  assert.equal(nextVersion('1.0', true), '1.0');
  assert.equal(nextVersion('1.9'), '1.10');
  assert.equal(nextVersion(''), '1.1');
  assert.ok(isHtmlDraft('Freshe ACR.html'));
  assert.ok(!isHtmlDraft('Freshe ACR.pdf'));
});
