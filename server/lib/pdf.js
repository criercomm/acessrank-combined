import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { log } from './logger.js';
import { render, escapeHtml } from './template.js';
import { getBrowserForRendering } from './browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '..', 'templates', 'report.html');

/**
 * PDF generation.
 *
 * The report is rendered by the same Chromium the scanner already runs, so PDF
 * output costs no extra dependency and no extra binary in the image.
 *
 * `setContent` is used rather than navigating to a URL: the template is fully
 * self-contained (inlined CSS, inline SVG, no web fonts), so the renderer never
 * makes a network request. That keeps generation deterministic and offline, and
 * means a slow CDN can never stall a customer's report.
 */

/** WCAG 2.2 success criteria referenced by the axe rules we run. */
const CRITERION_NAMES = {
  '1.1.1': { name: 'Non-text Content', level: 'A' },
  '1.2.1': { name: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  '1.2.2': { name: 'Captions (Prerecorded)', level: 'A' },
  '1.2.3': { name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  '1.2.4': { name: 'Captions (Live)', level: 'AA' },
  '1.2.5': { name: 'Audio Description (Prerecorded)', level: 'AA' },
  '1.3.1': { name: 'Info and Relationships', level: 'A' },
  '1.3.2': { name: 'Meaningful Sequence', level: 'A' },
  '1.3.3': { name: 'Sensory Characteristics', level: 'A' },
  '1.3.4': { name: 'Orientation', level: 'AA' },
  '1.3.5': { name: 'Identify Input Purpose', level: 'AA' },
  '1.4.1': { name: 'Use of Color', level: 'A' },
  '1.4.2': { name: 'Audio Control', level: 'A' },
  '1.4.3': { name: 'Contrast (Minimum)', level: 'AA' },
  '1.4.4': { name: 'Resize Text', level: 'AA' },
  '1.4.5': { name: 'Images of Text', level: 'AA' },
  '1.4.10': { name: 'Reflow', level: 'AA' },
  '1.4.11': { name: 'Non-text Contrast', level: 'AA' },
  '1.4.12': { name: 'Text Spacing', level: 'AA' },
  '1.4.13': { name: 'Content on Hover or Focus', level: 'AA' },
  '2.1.1': { name: 'Keyboard', level: 'A' },
  '2.1.2': { name: 'No Keyboard Trap', level: 'A' },
  '2.1.4': { name: 'Character Key Shortcuts', level: 'A' },
  '2.2.1': { name: 'Timing Adjustable', level: 'A' },
  '2.2.2': { name: 'Pause, Stop, Hide', level: 'A' },
  '2.3.1': { name: 'Three Flashes or Below Threshold', level: 'A' },
  '2.4.1': { name: 'Bypass Blocks', level: 'A' },
  '2.4.2': { name: 'Page Titled', level: 'A' },
  '2.4.3': { name: 'Focus Order', level: 'A' },
  '2.4.4': { name: 'Link Purpose (In Context)', level: 'A' },
  '2.4.5': { name: 'Multiple Ways', level: 'AA' },
  '2.4.6': { name: 'Headings and Labels', level: 'AA' },
  '2.4.7': { name: 'Focus Visible', level: 'AA' },
  '2.4.11': { name: 'Focus Not Obscured (Minimum)', level: 'AA' },
  '2.5.1': { name: 'Pointer Gestures', level: 'A' },
  '2.5.2': { name: 'Pointer Cancellation', level: 'A' },
  '2.5.3': { name: 'Label in Name', level: 'A' },
  '2.5.4': { name: 'Motion Actuation', level: 'A' },
  '2.5.7': { name: 'Dragging Movements', level: 'AA' },
  '2.5.8': { name: 'Target Size (Minimum)', level: 'AA' },
  '3.1.1': { name: 'Language of Page', level: 'A' },
  '3.1.2': { name: 'Language of Parts', level: 'AA' },
  '3.2.1': { name: 'On Focus', level: 'A' },
  '3.2.2': { name: 'On Input', level: 'A' },
  '3.2.3': { name: 'Consistent Navigation', level: 'AA' },
  '3.2.4': { name: 'Consistent Identification', level: 'AA' },
  '3.2.6': { name: 'Consistent Help', level: 'A' },
  '3.3.1': { name: 'Error Identification', level: 'A' },
  '3.3.2': { name: 'Labels or Instructions', level: 'A' },
  '3.3.3': { name: 'Error Suggestion', level: 'AA' },
  '3.3.4': { name: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  '3.3.7': { name: 'Redundant Entry', level: 'A' },
  '3.3.8': { name: 'Accessible Authentication (Minimum)', level: 'AA' },
  '4.1.2': { name: 'Name, Role, Value', level: 'A' },
  '4.1.3': { name: 'Status Messages', level: 'AA' },
};

export function describeCriteria(ids = []) {
  return ids.map((id) => ({
    id,
    name: CRITERION_NAMES[id]?.name ?? 'Success criterion',
    level: CRITERION_NAMES[id]?.level ?? 'AA',
  }));
}


const formatDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(date);

const formatMonth = (date = new Date()) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);

/** WCAG 2.2 has 31 Level A and 24 Level AA success criteria (4.1.1 retired). */
export const WCAG22_A_AA_TOTAL = 55;

/**
 * Complaint patterns: the same grouping the platform's deep-scan summary uses, so
 * a prospect who later gets the full audit recognises the categories. A rule
 * maps by id first; anything unlisted falls back to its success criteria, then
 * to "Other".
 */
const PATTERNS = [
  {
    id: 'media', label: 'Inaccessible images and media',
    rules: ['image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'object-alt', 'area-alt',
      'image-redundant-alt', 'video-caption', 'audio-caption', 'color-contrast', 'color-contrast-enhanced',
      'link-in-text-block', 'blink', 'marquee'],
    criteria: ['1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.5', '1.4.1', '1.4.3', '1.4.5', '1.4.11'],
  },
  {
    id: 'forms', label: 'Form and authentication barriers',
    rules: ['label', 'select-name', 'autocomplete-valid', 'form-field-multiple-labels', 'label-title-only',
      'input-button-name'],
    criteria: ['1.3.5', '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.3.7', '3.3.8'],
  },
  {
    id: 'structure', label: 'Page structure and navigation barriers',
    rules: ['region', 'landmark-one-main', 'landmark-unique', 'landmark-no-duplicate-main', 'landmark-main-is-top-level',
      'landmark-banner-is-top-level', 'landmark-contentinfo-is-top-level', 'landmark-complementary-is-top-level',
      'landmark-no-duplicate-banner', 'landmark-no-duplicate-contentinfo', 'heading-order', 'page-has-heading-one',
      'empty-heading', 'bypass', 'skip-link', 'document-title', 'html-has-lang', 'html-lang-valid', 'valid-lang',
      'html-xml-lang-mismatch', 'link-name', 'frame-title', 'frame-title-unique', 'list', 'listitem',
      'definition-list', 'dlitem', 'identical-links-same-purpose', 'th-has-data-cells', 'td-headers-attr'],
    criteria: ['1.3.1', '2.4.1', '2.4.2', '2.4.4', '2.4.5', '2.4.6', '3.1.1', '3.1.2', '3.2.3', '3.2.4'],
  },
  {
    id: 'keyboard', label: 'Keyboard access barriers',
    rules: ['scrollable-region-focusable', 'tabindex', 'focus-order-semantics', 'nested-interactive', 'accesskeys',
      'frame-focusable-content', 'server-side-image-map'],
    criteria: ['2.1.1', '2.1.2', '2.1.4', '2.4.3', '2.4.7', '2.4.11', '3.2.1'],
  },
  {
    id: 'mobile', label: 'Mobile, touch and zoom barriers',
    rules: ['meta-viewport', 'meta-viewport-large', 'target-size'],
    criteria: ['1.3.4', '1.4.4', '1.4.10', '1.4.12', '2.5.1', '2.5.2', '2.5.4', '2.5.7', '2.5.8'],
  },
  {
    id: 'dynamic', label: 'Unannounced dynamic updates',
    rules: ['aria-live-region'],
    criteria: ['4.1.3'],
  },
  {
    id: 'dialog', label: 'Cart drawer and dialog barriers',
    rules: ['aria-dialog-name'],
    criteria: [],
  },
];
const OTHER_PATTERN = { id: 'other', label: 'Other accessibility findings' };

function patternFor(issue) {
  const byRule = PATTERNS.find((p) => p.rules.includes(issue.id));
  if (byRule) return byRule;
  const criteria = issue.criteria ?? [];
  return PATTERNS.find((p) => criteria.some((c) => p.criteria.includes(c))) ?? OTHER_PATTERN;
}

/** Group failing elements by complaint pattern, largest first, with bar widths. */
export function complaintPatterns(issues = []) {
  const totals = new Map();
  for (const issue of issues) {
    const p = patternFor(issue);
    totals.set(p.id, { label: p.label, count: (totals.get(p.id)?.count ?? 0) + (issue.nodes ?? 0) });
  }
  const rows = [...totals.values()].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const max = rows[0]?.count ?? 0;
  return rows.map((r) => ({ ...r, pct: max ? Math.max(3, Math.round((r.count / max) * 100)) : 0 }));
}

/** Failing WCAG criteria with their name, level and how many elements fail them. */
export function criteriaTable(issues = [], failedCriteria = []) {
  const elements = new Map();
  for (const issue of issues) {
    for (const c of issue.criteria ?? []) elements.set(c, (elements.get(c) ?? 0) + (issue.nodes ?? 0));
  }
  return describeCriteria(failedCriteria)
    .map((c) => ({ ...c, elements: elements.get(c.id) ?? 0 }))
    .sort((a, b) => b.elements - a.elements);
}

const SEO_STATUS = {
  pass: { label: 'Pass', tone: 'good' },
  partial: { label: 'Needs work', tone: 'warn' },
  fail: { label: 'Fail', tone: 'bad' },
};

/** Score colour only — the free check deliberately prints no "Fair"/"Strong" label. */
const scoreTone = (score) => (score == null ? 'neutral' : score >= 90 ? 'good' : score >= 75 ? 'warn' : 'bad');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Build the template context from a persisted scan row plus the lead.
 * Kept separate from rendering so it can be unit-tested without Chromium.
 *
 * The free report is the summary only: scores, failing criteria and complaint
 * patterns, never selectors or snippets. The element-level record is what the
 * full audit sells, so it stays out of a document anyone can forward.
 */
export function buildReportContext({ scan, result, lead, reportId }) {
  const a11y = result.accessibility ?? {};
  const seo = result.seo ?? {};
  const agent = result.agent ?? null;
  const counts = a11y.counts ?? { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const issues = a11y.issues ?? [];
  const failedCriteria = a11y.failedCriteria ?? [];
  const overlays = result.profile?.overlays ?? [];
  const host = (result.origin ?? result.finalUrl ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const accessibility = result.scores?.accessibility ?? null;
  const elements = a11y.violationsTotal ?? (counts.critical + counts.serious + counts.moderate + counts.minor);
  const nFailing = failedCriteria.length;

  const crawlers = agent?.checks?.find((c) => c.id === 'crawlersAllowed');

  return {
    report: {
      id: (reportId ?? scan?.id ?? '').toString().slice(0, 8),
      generatedAt: formatDate(),
      month: formatMonth(),
    },
    site: {
      url: result.finalUrl ?? result.requestedUrl,
      origin: result.origin,
      host,
      title: result.meta?.title || host,
      pagesScanned: result.pagesScanned ?? 1,
      pagesLabel: plural(result.pagesScanned ?? 1, 'page'),
      pagesPronoun: (result.pagesScanned ?? 1) === 1 ? 'it' : 'them',
      pageUrls: result.pageUrls ?? [],
      pageList: (result.pageUrls ?? []).join(' · '),
    },
    lead: {
      name: lead?.name ?? 'there',
      email: lead?.email ?? '',
    },
    access: {
      headline: nFailing
        ? `${host} fails ${plural(nFailing, 'WCAG 2.2 success criterion', 'WCAG 2.2 success criteria')}${overlays.length ? ' and runs an accessibility overlay' : ''}, on an automated check alone.`
        : `${host} passes every WCAG 2.2 criterion an automated check can test${overlays.length ? ', but runs an accessibility overlay' : ''}.`,
      score: accessibility,
      scoreTone: scoreTone(accessibility),
      failing: nFailing,
      failingTone: nFailing ? 'bad' : 'good',
      elements,
      high: counts.critical + counts.serious,
      medium: counts.moderate,
      low: counts.minor,
      wcagTotal: WCAG22_A_AA_TOTAL,
      overlays: overlays.join(' and '),
      overlayDetected: overlays.length > 0,
      overlayTone: overlays.length ? 'bad' : 'good',
      overlayStatus: overlays.length ? `Yes: ${overlays.join(' and ')}` : 'None detected',
      patterns: complaintPatterns(issues),
      criteria: criteriaTable(issues, failedCriteria),
      hasIssues: elements > 0,
    },
    rank: {
      seo: result.scores?.seo ?? seo.score ?? null,
      seoTone: scoreTone(result.scores?.seo ?? seo.score),
      seoChecks: (seo.checks ?? []).map((c) => ({
        label: c.label,
        // Raw values like a full viewport string add nothing for a buyer and push the table onto a new page.
        detail: (c.detail || '').length > 44 ? `${c.detail.slice(0, 42).trimEnd()}…` : (c.detail || ''),
        status: SEO_STATUS[c.status]?.label ?? 'Fail',
        tone: SEO_STATUS[c.status]?.tone ?? 'bad',
      })),
      agent: agent?.total ? agent.score : null,
      agentTone: scoreTone(agent?.total ? agent.score : null),
      agentPassed: agent?.passed ?? 0,
      agentTotal: agent?.total ?? 0,
      agentChecks: (agent?.checks ?? []).map((c) => ({
        label: c.label,
        detail: c.detail || '',
        status: c.pass ? 'Pass' : 'Fail',
        tone: c.pass ? 'good' : 'bad',
      })),
      crawlersKnown: Boolean(crawlers),
      crawlersOpen: Boolean(crawlers?.pass),
      crawlersDetail: crawlers?.detail || '',
    },
    engine: {
      name: 'Accessrank audit engine',
      version: result.engineVersion ?? '1.0.0',
      axeVersion: result.axeVersion ?? '',
    },
    fonts: reportFonts(),
    site_url: config.siteUrl,
    site_host: config.siteUrl.replace(/^https?:\/\//, ''),
  };
}

/**
 * Inter and JetBrains Mono, inlined as data URIs so the PDF matches the platform
 * reports without the renderer ever touching the network. The runtime image only
 * carries the built site, so dist/ is tried before src/.
 */
let fontCache = null;
function reportFonts() {
  if (fontCache) return fontCache;
  const read = (file) => {
    for (const dir of ['dist', 'src']) {
      const p = path.join(__dirname, '..', '..', dir, 'assets', 'fonts', file);
      if (fs.existsSync(p)) return `data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}`;
    }
    return '';
  };
  fontCache = { sans: read('inter-latin-400.woff2'), mono: read('jetbrains-mono-latin-400.woff2') };
  if (!fontCache.sans) log.warn('report fonts not found; the PDF falls back to system fonts');
  return fontCache;
}

/** Running footer: Chromium renders it outside the page's own CSS, so it styles itself. */
const footerTemplate = (context) => `
  <div style="width:100%;padding:0 0.6in;font:7.5px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b6d76;display:flex;justify-content:space-between;">
    <span>${escapeHtml(context.site.host)} · Accessrank free accessibility check · ${escapeHtml(context.report.month)}</span>
    <span>Prepared by Accessrank.ai · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

/**
 * @returns {Promise<Buffer>} the rendered PDF
 */
export async function generateReportPdf(context) {
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(`Report template missing at ${TEMPLATE}`);
  }
  const html = render(fs.readFileSync(TEMPLATE, 'utf8'), context);

  const browser = await getBrowserForRendering();
  const page = await browser.newPage();
  try {
    // Nothing in the template is remote, so 'load' resolves without network.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    // Force print styles: without this, Chromium renders the screen stylesheet
    // and the @page rules never apply.
    await page.emulateMedia({ media: 'print' });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(context),
    });
    log.info('report pdf generated', { bytes: pdf.length });
    return pdf;
  } finally {
    await page.close().catch(() => {});
  }
}
/** Escape-hatch used by tests and by `npm run preview:pdf`. */
export async function renderReportHtml(context) {
  return render(fs.readFileSync(TEMPLATE, 'utf8'), context);
}

export default { generateReportPdf, buildReportContext, renderReportHtml, describeCriteria, complaintPatterns, criteriaTable };
