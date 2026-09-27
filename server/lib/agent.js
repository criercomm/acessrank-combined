/**
 * AI agent readiness: can assistants and browsing agents read the page and
 * operate it? Eight plain-English checks, built from signals the scan already
 * collects (axe rules and on-page SEO), mirroring the checklist on the
 * Accessrank for Libraries site (there derived from Lighthouse audits).
 *
 * A check is left out when it could not be evaluated — no forms on the page,
 * or axe could not decide — exactly as Lighthouse drops not-applicable audits,
 * so a page is never marked down for something it does not have.
 *
 * The score is the share of evaluated checks that pass. It is reported beside
 * accessibility and SEO; it does not feed the overall score, whose formula
 * (60% accessibility, 40% SEO) is documented on the methodology page and in
 * the PDF report.
 */

/** Crawlers whose blanket block means AI tools cannot read the site. */
export const AI_CRAWLERS = ['gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-user', 'claude-searchbot',
  'perplexitybot', 'google-extended', 'ccbot', 'applebot-extended'];

export const AGENT_CHECKS = [
  { id: 'buttons', label: 'Buttons have names agents can read', rules: ['button-name'] },
  { id: 'links', label: 'Links say where they go', rules: ['link-name'], seo: 'linkText' },
  { id: 'forms', label: 'Form fields are labeled', rules: ['label', 'select-name'] },
  { id: 'structure', label: 'Page has a clear main region and heading structure', rules: ['landmark-one-main', 'heading-order'] },
  { id: 'crawlableLinks', label: 'Links can be followed by crawlers' },
  { id: 'crawlersAllowed', label: 'Search and AI crawlers are allowed in' },
  { id: 'summary', label: 'Page has a descriptive title and summary' },
  { id: 'language', label: 'Page language is declared', rules: ['html-has-lang', 'html-lang-valid'] },
];

/**
 * Which user agents a robots.txt shuts out of the whole site ("Disallow: /" with no
 * matching "Allow"). Returns lower-cased agent names; '*' means everyone.
 * @param {string} text robots.txt body
 */
export function robotsBlockedAgents(text) {
  const blocked = new Set();
  let agents = [];
  let inRules = false;
  const flush = (rules) => { if (rules.disallowAll && !rules.allowSome) agents.forEach((a) => blocked.add(a)); };
  let rules = { disallowAll: false, allowSome: false };
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (inRules) { flush(rules); agents = []; rules = { disallowAll: false, allowSome: false }; inRules = false; }
      agents.push(value.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (key === 'disallow' && value === '/') rules.disallowAll = true;
      if (key === 'allow' && value && value !== '') rules.allowSome = true;
    }
  }
  flush(rules);
  return [...blocked];
}

/** Outcome of a set of axe rules across the merged scan: true pass, false fail, null not evaluated. */
function ruleOutcome(merged, ids) {
  const has = (list, id) => (list || []).some((r) => r.id === id);
  if (ids.some((id) => has(merged.violations, id))) return false;
  if (ids.some((id) => has(merged.passes, id))) return true;
  return null;
}

/**
 * @param {{violations:any[], passes:any[], incomplete:any[]}} merged axe results across scanned pages
 * @param {object} seoRaw first page's extractSeo() output (plus `robotsTxt`)
 * @param {object} seoSignals buildSeoSignals() output for the first page
 */
export function agentReadiness(merged, seoRaw = {}, seoSignals = {}) {
  const checks = [];
  for (const def of AGENT_CHECKS) {
    let pass = null;
    let detail = '';
    if (def.rules) {
      pass = ruleOutcome(merged, def.rules);
      if (def.seo && seoSignals[def.seo]) {
        const seoPass = seoSignals[def.seo].value === true;
        pass = pass === null ? seoPass : pass && seoPass;
        if (!seoPass) detail = seoSignals[def.seo].detail;
      }
    } else if (def.id === 'crawlableLinks') {
      const n = seoRaw.links?.uncrawlable ?? 0;
      pass = n === 0;
      if (!pass) detail = `${n} link${n === 1 ? '' : 's'} with no real address (javascript: or empty href)`;
    } else if (def.id === 'crawlersAllowed') {
      const noindex = /\bnoindex\b/.test(seoRaw.robots || '');
      const blocked = seoRaw.robotsTxt?.blocked ?? [];
      const blocksAll = blocked.includes('*');
      const blocksAi = AI_CRAWLERS.filter((a) => blocked.includes(a));
      pass = !noindex && !blocksAll && blocksAi.length === 0;
      if (noindex) detail = 'Page is marked noindex';
      else if (blocksAll) detail = 'robots.txt blocks every crawler';
      else if (blocksAi.length) detail = `robots.txt blocks ${blocksAi.join(', ')}`;
    } else if (def.id === 'summary') {
      pass = Boolean((seoRaw.title || '').trim()) && Boolean((seoRaw.description || '').trim());
      if (!pass) detail = !(seoRaw.title || '').trim() ? 'No page title' : 'No meta description';
    }
    if (pass === null) continue;
    checks.push({ id: def.id, label: def.label, pass, ...(detail ? { detail } : {}) });
  }
  const passed = checks.filter((c) => c.pass).length;
  return {
    score: checks.length ? Math.round((passed / checks.length) * 100) : null,
    passed,
    total: checks.length,
    checks,
  };
}
