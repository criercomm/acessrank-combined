// Copy of Deck R · Accessrank "The web's biggest blind spot" — English only. V2 after JP Lincoln's notes (2026-09-15).
// Every number here has a source in PLAN.md §8 or in AccessRank-capacidades.md. Bracketed values [like this] and TBD tiles
// are inputs JP / Carlos must fill in before the room; the deck renders them visibly so they cannot be forgotten.
// Presenter notes (notes) are what the presenter reads in ?presenter=1.
export const copy = {
  brand: 'Accessrank',
  spine: "The web's biggest blind spot. Accessrank finds it, fixes it, and proves it.",
  legal: '<b>Accessrank</b> · Investor presentation · Not legal advice · Statistics from cited third-party sources · Confidential',
  chapters: ['Blind spot', 'The letter', 'Plug-ins', 'The fix', 'Safe', 'Engine', 'Model', 'Market', 'Today', 'Libraries', 'Contact'],

  s01: {
    title: ["THE WEB'S BIGGEST", 'BLIND SPOT.'],
    sub: "95% of websites fail accessibility standards — a blind spot most companies don't know they have until a demand letter arrives. Accessrank finds it, fixes it, and turns the fix into faster, more visible, more sellable pages.",
    source: 'WebAIM Million 2026: 95.9% of the top one million home pages have detectable WCAG failures',
    notes: 'Open slow. "Ninety-five percent of websites fail accessibility standards. Most companies find out when a demand letter arrives. We find it, we fix it in the code, and the fix makes the pages faster and more visible." Then advance.',
  },

  s02: {
    title: ['Every online store is one demand letter away', 'from a $30,000 problem.'],
    letterAlt: 'The first page of a real web-accessibility complaint filed in New York in March 2026, names and contact details blurred',
    stats: [
      { value: '5,114', label: 'ADA website lawsuits filed in 2025', source: 'UsableNet 2025 year-end report' },
      { value: '6,176', label: 'on pace for 2026, up about 20%', source: 'UsableNet 2026 midyear report' },
      { value: '79%', label: 'of 2026 filings target ecommerce', source: 'UsableNet 2026 midyear report' },
      { value: '45%', label: 'of 2025 federal suits hit companies already sued before', source: 'UsableNet 2025 year-end report' },
    ],
    micro: 'Average cost per claim: $30,000+ in settlement and legal fees. Accessible.org. The letter on screen is a real complaint filed in March 2026; names and contact details are blurred.',
    notes: 'Let the complaint rise before you speak. "This is a real one, filed in March. Five thousand of these last year. Seventy-nine percent against online stores. Forty-five percent hit companies that had already been sued once. Thirty thousand dollars each before anyone fixes anything."',
  },

  s03: {
    title: ["Simply adding an accessibility plug-in isn't a fix.", 'It can trigger a lawsuit.'],
    lede: "The FTC fined accessiBe $1 million for misleading claims in 2025. Overlays don't fix the underlying code; they're a litigation signal. Accessrank fixes the source.",
    pct: '38.5', pctSuffix: '%',
    pctLabel: 'of businesses sued in 2025 already had an accessibility widget installed',
    pctSource: 'AudioEye 2026 analysis · UsableNet 2026 midyear report',
    notes: 'The wall is every store that bought a plug-in. Click: the red ones were sued anyway. "Thirty-eight percent of the companies sued already had a widget. The FTC fined the biggest vendor a million dollars. A widget is not a defense; it is a signal to the plaintiff\'s bar. We fix the source."',
  },

  s04: {
    title: ['Scan. Fix in the code. Re-scan.', 'Document it. Prove it.'],
    stages: ['Scan', 'Findings', 'Fix', 'Validate'],
    store: {
      name: 'Northline Goods', url: 'northlinegoods.com',
      nav: ['Shop', 'New', 'Sale', 'About'],
      hero: { eyebrow: 'Fall drop', title: 'Built for cold mornings.', cta: 'Shop the drop' },
      products: [
        { id: 'sneaker', name: 'Trail Runner 02', price: '$128', sale: '$96' },
        { id: 'headphones', name: 'Studio Over-Ear', price: '$219' },
        { id: 'skincare', name: 'Daily Serum', price: '$48' },
        { id: 'candle', name: 'Cedar Candle', price: '$34', sale: '$24' },
        { id: 'sweater', name: 'Oat Knit', price: '$142' },
        { id: 'wallet', name: 'Bifold Wallet', price: '$76' },
      ],
      modal: { title: 'Choose a size', sizes: ['7', '8', '9', '10', '11'], cta: 'Add to cart' },
      form: { title: 'Get 10% off', placeholder: 'you@email.com', cta: 'Join' },
    },
    findings: [
      { n: 1, key: 'alt', label: 'Missing alt text', wcag: '1.1.1' },
      { n: 2, key: 'contrast', label: 'Contrast 2.9:1', wcag: '1.4.3' },
      { n: 3, key: 'cart', label: 'Cart update not announced', wcag: '4.1.3' },
      { n: 4, key: 'focus', label: 'Focus trap in size modal', wcag: '2.1.2' },
      { n: 5, key: 'label', label: 'Unlabeled email field', wcag: '3.3.2' },
      { n: 6, key: 'color', label: 'Sale price by color only', wcag: '1.4.1' },
      { n: 7, key: 'target', label: 'Tap target 28 px', wcag: '2.5.8' },
    ],
    counts: { findings: 47, pages: 6, shown: 7 },
    score: { before: 41, after: 96 },
    panel: { idle: 'Ready to scan', scanning: 'Scanning in a real browser', found: 'findings on 6 pages', fixed: 'changes approved', done: 'remaining after re-scan' },
    evidence: {
      title: 'Sale price fails contrast', rule: 'color-contrast', wcag: 'WCAG 2.2 · 1.4.3 Contrast (Minimum)',
      selector: '.card__price--sale', measured: '2.9:1', required: '4.5:1',
      html: '<span class="card__price--sale">$96</span>',
      grade: 'behavior_verified', chip: 'Draft theme · never the live theme',
      lines: ['Foreground #F26A5E on #14142A', 'Also fails 1.4.1: sale indicated by color only'],
    },
    diff: {
      file: 'snippets/price.liquid',
      lines: [
        ['ctx', '{%- if compare_at_price > price -%}'],
        ['del', '  <span class="card__price--sale">{{ price | money }}</span>'],
        ['add', '  <span class="card__price--sale" aria-label="Sale price">'],
        ['add', '    <span class="badge">Sale</span> {{ price | money }}'],
        ['add', '  </span>'],
        ['ctx', '{%- endif -%}'],
      ],
      css: [
        ['ctx', '.card__price--sale {'],
        ['del', '  color: #F26A5E;'],
        ['add', '  color: #FFB4AB; /* 7.1:1 on #14142A */'],
        ['ctx', '}'],
      ],
      approve: 'Approve change',
      approved: 'Approved · Accessrank operator',
    },
    rollback: 'Rollback',
    notes: 'This is the demo. Four clicks. 1) Scan: the beam finds 47 issues on 6 pages, score 41. 2) Findings: one issue with its evidence. 3) Fix: the actual code change on a draft theme, approved. 4) Validate: re-scan, zero remaining, score 96. Then hover Rollback and let them see everything come back — frame it as our safety net, not a button the owner has to press: "if a change ever misbehaves we revert it, and a verification scan runs automatically." Say: "Nothing here is a screenshot. It is the cycle the product runs."',
  },

  s05: {
    title: ['No site downtime.', 'Every fix documented to keep the lawyers at bay.'],
    steps: [
      { id: 'draft', label: 'Draft, never live', line: 'Shopify fixes are written to a draft theme. The published theme is never touched until someone explicitly publishes.' },
      { id: 'approve', label: 'Approval per change', line: 'Every change is approved file by file. Who approved it, and why, is recorded.' },
      { id: 'verify', label: 'Write verified', line: 'After every write, the file is read back and compared with the approved version. If anything differs, nothing goes out.' },
      { id: 'zero', label: '0 remaining', line: 'A fix is accepted only when the re-scan of the same pages reports zero remaining issues.' },
      { id: 'evidence', label: 'Evidence pack', line: 'Each finding comes with the rule, the WCAG criterion, the selector and the measurements. Before-and-after screenshots show what was fixed and why — remediation evidence that can help support a legal defense.' },
    ],
    people: [
      { id: 'operator', label: 'Operator', line: 'runs the scan and writes the fix' },
      { id: 'client', label: 'Client', line: 'grants access and approves from the portal' },
      { id: 'shopper', label: 'Shopper', line: 'More than 1 in 4 U.S. adults (70M+) live with a disability' },
    ],
    notes: 'Click through the five guardrails; the explanation sits under the active one. The line for the room: "The live store never goes down because we never touch the live theme. And every fix is measured and documented, which is what keeps the lawyers at bay."',
  },

  s06: {
    title: ['The same structural fixes that enable accessibility', 'raise the rankings too.'],
    lede: 'Screen readers, search engines and AI agents all read the same thing: the structure of the page. Real headings, labeled controls and a text description for every image make a store usable for the blind, readable for Google, and shoppable by the agents that browse on people\x27s behalf.',
    tiles: [
      { value: '54.5%', label: 'of ecommerce sites have images with no text description, invisible to screen readers and to search', source: 'WebAIM Million' },
      { value: '73%', label: 'of remediated sites saw organic-traffic growth, +12% on average', source: 'Semrush, 847-site study' },
      { value: '27%', label: 'of disabled online shoppers abandon a purchase at least once a month because of accessibility barriers', source: 'Fable survey of disabled shoppers' },
      { value: '70M+', label: 'U.S. adults live with a disability, more than 1 in 4', source: 'CDC, 2024 (2022 data)' },
    ],
    standards: [
      { label: 'Accessibility', line: 'WCAG 2.2 AA plus 11 ADA ecommerce lawsuit patterns' },
      { label: 'Core Web Vitals', line: 'Lab performance and image delivery fixes' },
      { label: 'SEO / AI search', line: 'Metadata, structured data, agent annotations' },
      { label: 'Security', line: 'OWASP Top 10 basics: headers, TLS, cookies' },
    ],
    platforms: ['Shopify · deep', 'WordPress', 'GitHub', 'Bitbucket', 'Cloudflare', 'Code ZIP'],
    notes: '"Screen readers, Google and AI shopping agents read the same structure. Fix it once for the blind and the page becomes more visible to search and to agents. Seventy-three percent of remediated sites grew organic traffic. And it is revenue: seventy million American adults live with a disability, and more than a quarter of disabled shoppers abandon a purchase every month because a store does not work for them." The standards rail below is the engine that does it.',
  },

  s07: {
    title: ['Pay for results,', 'not promises.'],
    plans: [
      { id: 'starter', name: 'Starter', once: '$1,500', monthly: '$79', who: 'Stores up to 10 SKUs', items: ['WCAG 2.2 AA source-code remediation', 'Monthly re-audit and VPAT', 'SEO optimization'], time: 'About 2 weeks' },
      { id: 'growth', name: 'Growth', tag: 'Most popular', once: '$3,500', monthly: '$249', who: 'Brands with 11–50 SKUs', items: ['Everything in Starter', 'Weekly audits, one-click fixes', 'SEO rank tracking, EAA summary'], time: '2–4 weeks' },
      { id: 'enterprise', name: 'Enterprise', once: 'Custom', monthly: null, who: 'Shopify Plus, 50+ SKUs', items: ['Daily or real-time monitoring', 'Dedicated CSM, SOC 2, DPA, SSO', 'Indemnification'], time: '6–12 weeks' },
    ],
    express: { name: 'Lawsuit response', price: '$5,900', line: 'From $5,900, delivered in 7 days: emergency audit, source-code remediation of the cited issues, screen-reader proof video, VPAT and settlement-terms review.' },
    today: 'Today: an operated service with a client portal.',
    next: 'Next: self-serve billing and an agency tier.',
    notes: '"A one-time project to raise the score, then a monthly plan to hold it there. The lawsuit-response lane is the fastest path to a first check: brands that were served this week." Be transparent: today the service is operated by our team; billing automation is on the roadmap.',
  },

  s08: {
    title: ['Top eight ADA lawsuits', 'by state and by industry.'],
    statesLabel: 'Most active lawsuits by state, 2025',
    states: [
      { name: 'New York', n: 1108 }, { name: 'Florida', n: 950 }, { name: 'California', n: 787 }, { name: 'Illinois', n: 576 },
      { name: 'Minnesota', n: 160 }, { name: 'Pennsylvania', n: 101 }, { name: 'Missouri', n: 85 }, { name: 'All other states', n: 181 },
    ],
    statesSource: 'EcomBack 2025 annual report · 3,948 suits in state and federal courts',
    industriesLabel: 'Most active lawsuits by industry, 2025',
    industries: [
      { name: 'Restaurants, food & drink', n: 1368 }, { name: 'Fashion & apparel', n: 1025 }, { name: 'Beauty & personal care', n: 317 },
      { name: 'Furniture & home', n: 303 }, { name: 'Health & medical', n: 283 }, { name: 'Sports & fitness', n: 89 },
      { name: 'General retail', n: 89 }, { name: 'Toys, gifts & specialty', n: 68 },
    ],
    industriesSource: 'EcomBack 2025 annual report',
    rails: [
      { label: 'Platforms', steps: ['Shopify', 'WordPress', 'Code repositories'] },
      { label: 'Standards', steps: ['Accessibility', 'Performance', 'Search & AI', 'Security', 'Compliance'] },
    ],
    notes: '"Four states carry 87 percent of the filings and two industries, food and fashion, carry 60 percent. That is where the first customers are. The rails below are where the same engine goes next: platforms and standards."',
  },

  s09: {
    title: ['Functional alpha,', 'end to end.'],
    engLabel: 'Engineering, today',
    eng: [
      { value: '99,000', label: 'lines of TypeScript in the API' },
      { value: '1,200', label: 'automated test cases' },
      { value: '140', label: 'API routes' },
      { value: '39', label: 'data models' },
    ],
    tractionLabel: 'Traction',
    traction: [
      { value: null, label: 'sites audited' },
      { value: null, label: 'findings fixed' },
      { value: null, label: 'paying customers' },
      { value: null, label: 'pipeline' },
    ],
    tbd: 'TBD',
    builtLabel: 'How it is built',
    built: [
      { name: 'Founded 2025', role: 'Remote-first', line: 'A small team across U.S. and EU time zones that would rather stay hands-on than scale as a report-only vendor.' },
      { name: 'Operated', role: 'People in the loop', line: 'Trained operators run every scan and write every fix; clients grant access and approve changes from their own portal.' },
      { name: 'Integrations live', role: 'Shipping today', line: 'Shopify end to end, WordPress, GitHub and Bitbucket pull requests, code ZIPs, Cloudflare.' },
    ],
    notes: 'Be exact: "The full cycle works end to end today: scan, remediate on a draft, validate, report, rollback. It is an alpha in maturity and an operated service in delivery." The team is deliberately not named on screen; if asked, describe the operating model, not people. Fill the traction tiles before the room; TBD is on purpose so nothing invented ships.',
  },


  s11: {
    eyebrow: 'Next market · Accessrank for Libraries',
    title: ['Public libraries serve everyone.', 'Their websites should too.'],
    lede: 'Same engine, second market. ADA Title II now holds every public library website to WCAG, with deadlines in 2027 and 2028. Catalogs, e-resources and event pages get the same scan, fix and documentation.',
    stats: [
      { value: '96%', label: 'of public library websites fail at least one WCAG 2.2 AA criterion', source: 'WebAIM Million 2025' },
      { value: '2027', label: 'Title II deadline for libraries serving 50,000+ residents; smaller systems in 2028', source: 'U.S. DOJ, Title II rule' },
      { value: '70M+', label: 'U.S. adults live with a disability, more than 1 in 4', source: 'CDC, 2024 (2022 data)' },
    ],
    catalog: {
      name: 'Northline Public Library', search: 'Search the catalog',
      items: [
        { title: 'The Lighthouse Keeper', author: 'A. Moreno', status: 'Available' },
        { title: 'Field Notes on Rivers', author: 'J. Okafor', status: '2 holds' },
        { title: 'Winter Bread', author: 'L. Haddad', status: 'Available' },
      ],
      cta: 'Place hold', form: { title: 'Hold request', fields: ['Card number', 'Email'], cta: 'Confirm' },
    },
    findings: [
      { n: 1, label: 'Book cover without alt text', at: { x: 6, y: 42 } },
      { n: 2, label: 'Hold form without labels', at: { x: 40, y: 81 } },
      { n: 3, label: 'Hold confirmation not announced', at: { x: 93, y: 60 } },
    ],
    platformsLabel: 'Works with',
    platforms: ['BiblioCommons', 'Polaris', 'Sierra', 'OverDrive', 'Libby', 'Koha'],
    plans: [
      { name: 'Branch', price: '$1,800', unit: '/yr', who: 'Under 25,000 residents' },
      { name: 'System', price: '$5,400', unit: '/yr', who: '25,000-250,000 residents' },
      { name: 'Metropolitan', price: '$8,400+', unit: '/yr', who: '250,000+ residents and consortia' },
    ],
    site: 'accessrankforlibraries',
    notes: '"The same engine has a second market with a legal deadline attached: public libraries. Title II now applies WCAG to their catalogs and event pages, with 2027 and 2028 deadlines. Ninety-six percent fail today. We sell it as an annual plan, priced for library budgets." This is a teaser; do not promise dates or customers.',
  },

  s12: {
    title: ["Let's talk."],
    sub: 'Which of your portfolio brands should we scan first?',
    people: [
      { name: '', role: 'Co-founder and CEO', email: 'jp@accessrank.ai', phone: '+1 310 408 1881' },
      { name: '', role: 'Co-founder and CTO', email: 'carlos@accessrank.ai', phone: '+51 958 967 616' },
    ],
    site: 'accessrank.ai', siteHref: 'https://accessrank.ai/',
    notes: 'Close with the question on screen and stop. Two ways to reach us: the CEO in the US, the CTO in Peru; both numbers are in international format.',
  },
}
