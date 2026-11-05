#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { render as renderTemplate } from './server/lib/template.js';
import { minifyCss } from './server/lib/minify.js';

/**
 * Static site build.
 *
 * The original site repeated its <head>, nav and footer verbatim across seven
 * files and defined the same design tokens in two places. That is the defect
 * this fixes: pages are authored as body fragments, chrome comes from partials,
 * and CSS/JS are bundled once with a content hash for cache busting.
 *
 * Output is plain static HTML with no client-side framework and no runtime
 * templating — it can be served by this app, or dropped on any CDN.
 *
 * Template syntax (deliberately tiny):
 *   {{ value }}          HTML-escaped interpolation
 *   {{{ value }}}        raw interpolation
 *   {{> partial }}       include src/partials/<partial>.html
 *   {{#if value}}…{{/if}}          conditional
 *   {{#unless value}}…{{/unless}}  negated conditional
 *   {{#each list}}…{{/each}}       iteration, {{ this.prop }} inside
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

const site = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'site.json'), 'utf8'));
const SITE_URL = (process.env.SITE_URL || 'https://accessrank.ai').replace(/\/+$/, '');
const BUILD_DATE = new Date().toLocaleDateString('en-CA');

/* ------------------------------------------------------------ template --- */

// One renderer, shared with the PDF report, so both behave identically.
const PARTIALS = path.join(SRC, 'partials');
const render = (template, context) => renderTemplate(template, context, { partialsDir: PARTIALS });

/* -------------------------------------------------------------- assets --- */

const hashOf = (content) => crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);

function bundle(files, baseDir) {
  return files
    .map((file) => {
      const full = path.join(baseDir, file);
      if (!fs.existsSync(full)) {
        console.warn(`  ! missing ${file} — skipped`);
        return '';
      }
      return `/* ---- ${file} ---- */\n${fs.readFileSync(full, 'utf8')}`;
    })
    .filter(Boolean)
    .join('\n\n');
}


function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dst);
    else { fs.copyFileSync(src, dst); count += 1; }
  }
  return count;
}

/* --------------------------------------------------------------- build --- */

function structuredData(page) {
  const blocks = [];
  const types = page.schema ?? [];

  if (types.includes('Organization')) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: site.name,
      legalName: site.legalName,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/assets/img/logo.svg`,
      email: site.email,
      telephone: site.phone,
      description: site.description,
      foundingDate: String(site.foundingYear),
      address: {
        '@type': 'PostalAddress',
        streetAddress: site.address.street,
        addressLocality: site.address.city,
        addressRegion: site.address.region,
        postalCode: site.address.postalCode,
        addressCountry: 'US',
      },
      areaServed: 'US',
      knowsAbout: ['Web accessibility', 'WCAG 2.2', 'ADA Title III website compliance', 'Shopify theme remediation', 'Ecommerce SEO', 'AI agent readiness'],
      contactPoint: [{
        '@type': 'ContactPoint',
        email: site.email,
        telephone: site.phone,
        contactType: 'sales',
        areaServed: 'US',
        availableLanguage: ['English'],
      }],
    });
  }

  if (types.includes('Service')) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Accessrank accessibility remediation',
      serviceType: 'Web accessibility remediation (WCAG 2.2 AA), monitoring and SEO for ecommerce',
      provider: { '@id': `${SITE_URL}/#organization` },
      areaServed: 'US',
      description:
        'Source-code remediation of ecommerce storefronts against WCAG 2.2 Level A and AA, with an Accessibility Compliance Record (dated baseline audit, remediation log, VPAT-format conformance report, human testing record), ongoing regression monitoring, and on-page SEO and AI readiness improvements.',
      audience: { '@type': 'BusinessAudience', audienceType: 'DTC ecommerce brands on Shopify, WooCommerce, BigCommerce and custom platforms' },
      url: `${SITE_URL}/#product`,
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Accessrank plans',
        itemListElement: [
          { '@type': 'Offer', name: 'Starter', description: 'Stock theme with a handful of apps. USD 1,500 one-time onboarding; monitoring USD 79/month or USD 690/year.', price: '1500', priceCurrency: 'USD', url: `${SITE_URL}/#pricing` },
          { '@type': 'Offer', name: 'Growth', description: 'Customized theme with up to 15 apps and several page templates. USD 3,500 one-time onboarding; monitoring USD 249/month or USD 2,090/year.', price: '3500', priceCurrency: 'USD', url: `${SITE_URL}/#pricing` },
          { '@type': 'Offer', name: 'Scale', description: 'Heavily customized themes with 15 or more apps. USD 6,500 one-time onboarding; monitoring USD 599/month or USD 4,990/year.', price: '6500', priceCurrency: 'USD', url: `${SITE_URL}/#pricing` },
          { '@type': 'Offer', name: 'Enterprise', description: 'Shopify Plus, multiple storefronts or brands, and headless builds. Custom onboarding and monitoring plan.', url: `${SITE_URL}/contact-sales` },
          { '@type': 'Offer', name: 'Lawsuit response', description: 'For stores already served a demand letter or lawsuit. About 7-day delivery.', price: '5900', priceCurrency: 'USD', url: `${SITE_URL}/#lawsuit-response` },
        ],
      },
    });
  }

  if (types.includes('Article')) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.title.split(' | ')[0].split(' — ')[0],
      description: page.description,
      url: `${SITE_URL}${page.url}`,
      inLanguage: 'en-US',
      datePublished: page.datePublished || `${site.foundingYear}-01-01`,
      dateModified: page.dateModified || BUILD_DATE,
      author: { '@id': `${SITE_URL}/#organization` },
      publisher: { '@id': `${SITE_URL}/#organization` },
      isPartOf: { '@type': 'WebSite', name: site.name, url: `${SITE_URL}/` },
    });
  }

  if (types.includes('FAQPage') && Array.isArray(page.faq) && page.faq.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      // Freshness signal. Answer engines weight recently-updated pages more
      // heavily, and an FAQ with no date carries none. Set `dateModified` on
      // the page in site.json when you change its answers; the build date is
      // only a fallback, so an untouched page does not claim to be newer than
      // it is.
      dateModified: page.dateModified || BUILD_DATE,
      mainEntity: page.faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }

  // Page-level freshness for every page, FAQ or not. Same date convention as
  // above: site.json wins, build date is the fallback.
  blocks.push({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url: `${SITE_URL}${page.url}`,
    name: page.title.split(' | ')[0].split(' \u2014 ')[0],
    description: page.description,
    inLanguage: 'en-US',
    datePublished: page.datePublished || `${site.foundingYear}-01-01`,
    dateModified: page.dateModified || BUILD_DATE,
    publisher: { '@id': `${SITE_URL}/#organization` },
    isPartOf: { '@type': 'WebSite', name: site.name, url: `${SITE_URL}/` },
  });

  if (page.url !== '/') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: page.title.split(' — ')[0], item: `${SITE_URL}${page.url}` },
      ],
    });
  }

  return blocks
    .map((block) => `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`)
    .join('\n  ');
}

async function build() {
  const started = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // --- assets -------------------------------------------------------------
  const cssDir = path.join(SRC, 'assets', 'css');
  const jsDir = path.join(SRC, 'assets', 'js');

  // Order is the cascade. a11y.css is deliberately last so a component rule
  // cannot silently override a conformance requirement.
  const cssSource = bundle(
    ['tokens.css', 'fonts.css', 'base.css', 'layout.css', 'home.css', 'pages.css', 'overlays.css', 'components.css', 'desktop.css', 'a11y.css'],
    cssDir,
  );
  const css = minifyCss(cssSource);
  const cssName = `site.${hashOf(css)}.css`;

  const jsSource = bundle(['site.js', 'audit.js', 'overlays.js', 'beta-prompt.js'], jsDir);
  const jsName = `site.${hashOf(jsSource)}.js`;

  // The client portal (/client-login, /portal, /portal/admin) ships its own
  // stylesheet and script, linked only from pages marked `portal` in site.json.
  // Bundling them into the files above would put admin-screen CSS inline in the
  // <head> of every marketing page, and its JS in front of every visitor.
  const portalCss = minifyCss(bundle(['portal.css'], cssDir));
  const portalCssName = `portal.${hashOf(portalCss)}.css`;
  const portalJs = bundle(['portal.js'], jsDir);
  const portalJsName = `portal.${hashOf(portalJs)}.js`;
  // The home page headline animation: GSAP plus hero-motion.js, linked only from pages marked `heroMotion`.
  const heroJs = bundle(['vendor/gsap.min.js', 'hero-motion.js'], jsDir);
  const heroJsName = `hero.${hashOf(heroJs)}.js`;

  fs.mkdirSync(path.join(DIST, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'assets', 'css', cssName), css);
  fs.writeFileSync(path.join(DIST, 'assets', 'js', jsName), jsSource);
  fs.writeFileSync(path.join(DIST, 'assets', 'css', portalCssName), portalCss);
  fs.writeFileSync(path.join(DIST, 'assets', 'js', portalJsName), portalJs);
  fs.writeFileSync(path.join(DIST, 'assets', 'js', heroJsName), heroJs);

  // The stylesheet is linked, not inlined (see shell.html), so CSP's style-src
  // stays 'self' alone and no block hash is recorded. server/app.js tolerates
  // the absent hash: it only adds one when csp.json carries it.
  const styleHash = null;
  // Whether the built pages ship the Turnstile <script> + widgets is a
  // BUILD-time fact, so it is recorded here and the server's CSP follows it.
  // Deciding from the server's own env instead caused a real mismatch: a keyed
  // build served by a keyless server (integration tests, local runs) blocked
  // challenges.cloudflare.com and every page logged a CSP violation.
  const turnstileInMarkup = Boolean(process.env.TURNSTILE_SITE_KEY);
  fs.writeFileSync(path.join(DIST, 'csp.json'), JSON.stringify({ styleHash, turnstileInMarkup }, null, 2));

  const copied =
    copyDir(path.join(SRC, 'assets', 'img'), path.join(DIST, 'assets', 'img')) +
    copyDir(path.join(SRC, 'assets', 'fonts'), path.join(DIST, 'assets', 'fonts')) +
    copyDir(path.join(SRC, 'assets', 'static'), DIST);

  console.log(`  css  ${cssName} (${(css.length / 1024).toFixed(1)} kB, from ${(cssSource.length / 1024).toFixed(1)} kB)`);
  console.log(`  js   ${jsName} (${(jsSource.length / 1024).toFixed(1)} kB)`);
  console.log(`  portal ${portalCssName} (${(portalCss.length / 1024).toFixed(1)} kB), ${portalJsName} (${(portalJs.length / 1024).toFixed(1)} kB)`);
  console.log(`  copy ${copied} static files`);

  // The home page is the site root (accessrank.ai/). The overview deck keeps
  // its own build at DIST/deck (copied above from src/assets/static/deck) and
  // is reachable at /deck/; the nav's "Overview" item opens it in an overlay.
  const deckIndex = path.join(DIST, 'deck', 'index.html');
  if (!fs.existsSync(deckIndex)) {
    console.warn('  ! dist/deck/index.html not found — /deck/ will not serve the overview');
  } else {
    // The deck ships as `<main id="deck"></main>` with every word inside its
    // JavaScript bundle, so anything that reads raw HTML — the AI crawlers
    // robots.txt invites, and any visitor whose bundle has not arrived — finds
    // an empty page. Write a readable version of deck/src/copy.js into it here,
    // at build time, so the deck's own committed build stays untouched and the
    // text can never drift from the copy it is generated from.
    // See scripts/prerender-deck.mjs for what is rendered and what is skipped.
    try {
      const { renderDeckText, injectDeckText, loadCopy, DECK_TEXT_CSS, deckBundleDrift } = await import('./scripts/prerender-deck.mjs');
      const deckCopy = await loadCopy();
      // Slides and text must tell one story: warn if the committed slide bundle
      // predates copy.js. `npm test` fails on the same condition.
      const drift = deckBundleDrift(deckCopy, path.join(SRC, 'assets', 'static', 'deck'));
      if (!drift.ok) {
        console.warn(`  ! DECK SLIDES ARE STALE: ${drift.reason}`);
        console.warn('    Rebuild: cd deck && DECK_BASE=/deck/ npm run build, then copy deck/dist over src/assets/static/deck');
      }
      // The stylesheet is a file, not an inline block, because of the CSP
      // (see prerender-deck.mjs). Content-hashed like the deck's own assets so
      // a change is never stuck behind a cached copy.
      const cssHash = crypto.createHash('sha256').update(DECK_TEXT_CSS).digest('hex').slice(0, 10);
      const cssName = `deck-text.${cssHash}.css`;
      fs.writeFileSync(path.join(DIST, 'deck', 'assets', cssName), DECK_TEXT_CSS);
      const before = fs.readFileSync(deckIndex, 'utf8');
      fs.writeFileSync(deckIndex, injectDeckText(before, deckCopy, { cssHref: `/deck/assets/${cssName}` }));
      const words = renderDeckText(deckCopy).replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
      console.log(`  deck ${words} words pre-rendered into /deck/`);
    } catch (err) {
      // A deck that fails to pre-render is still a deck; do not fail the build.
      console.warn(`  ! deck pre-render skipped: ${err.message}`);
    }
  }

  // --- pages --------------------------------------------------------------
  const shell = fs.readFileSync(path.join(SRC, 'partials', 'shell.html'), 'utf8');
  const written = [];

  for (const page of site.pages) {
    const source = path.join(SRC, 'pages', page.file);
    if (!fs.existsSync(source)) {
      console.warn(`  ! ${page.file} not found — skipping ${page.url}`);
      continue;
    }

    const context = {
      site,
      page,
      nav: site.nav,
      footer: site.footer,
      jobs: site.jobs,
      cssHref: `/assets/css/${cssName}`,
      jsHref: `/assets/js/${jsName}`,
      portalCssHref: `/assets/css/${portalCssName}`,
      portalJsHref: `/assets/js/${portalJsName}`,
      heroJsHref: `/assets/js/${heroJsName}`,
      maxFileMb: process.env.PORTAL_MAX_FILE_MB || '25',
      canonical: `${SITE_URL}${page.url === '/' ? '/' : page.url}`,
      siteUrl: SITE_URL,
      year: new Date().getFullYear(),
      isHome: page.url === '/',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
      plausibleDomain: process.env.PLAUSIBLE_DOMAIN || '',
      plausibleSrc: process.env.PLAUSIBLE_SRC || 'https://plausible.io/js/script.js',
    };

    const body = render(fs.readFileSync(source, 'utf8'), context);
    const html = render(shell, { ...context, body, structuredData: structuredData(page) });

    // Extensionless URLs: / -> index.html, /about -> about/index.html
    const outPath = page.url === '/'
      ? path.join(DIST, 'index.html')
      : page.url === '/404'
        ? path.join(DIST, '404.html')
        : path.join(DIST, page.url.replace(/^\//, ''), 'index.html');

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    written.push({ page, outPath });
  }

  // --- job detail pages ---------------------------------------------------
  const jobTemplatePath = path.join(SRC, 'pages', '_job.html');
  if (fs.existsSync(jobTemplatePath)) {
    const jobTemplate = fs.readFileSync(jobTemplatePath, 'utf8');
    for (const job of site.jobs) {
      const page = {
        url: `/careers/${job.slug}`,
        title: `${job.title} — Careers at Accessrank`,
        description: job.summary,
        layout: 'page',
        priority: '0.4',
        changefreq: 'monthly',
      };
      const context = {
        site, page, job, nav: site.nav, footer: site.footer,
        cssHref: `/assets/css/${cssName}`, jsHref: `/assets/js/${jsName}`,
        canonical: `${SITE_URL}${page.url}`, siteUrl: SITE_URL,
        year: new Date().getFullYear(), isHome: false,
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
        plausibleDomain: process.env.PLAUSIBLE_DOMAIN || '',
        plausibleSrc: process.env.PLAUSIBLE_SRC || 'https://plausible.io/js/script.js',
      };
      const body = render(jobTemplate, context);
      const html = render(shell, { ...context, body, structuredData: structuredData(page) });
      const outPath = path.join(DIST, 'careers', job.slug, 'index.html');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html);
      written.push({ page, outPath });
    }
  }

  // --- sitemap & robots ---------------------------------------------------
  // Per-page `dateModified` from site.json, so an untouched page does not
  // claim a new modification date on every deploy (the same rule the schema
  // blocks follow). Build date only as the fallback.
  const urls = written
    .filter(({ page }) => !page.excludeFromSitemap && !page.noindex)
    .map(({ page }) => `  <url>
    <loc>${SITE_URL}${page.url === '/' ? '/' : page.url}</loc>
    <lastmod>${page.dateModified || BUILD_DATE}</lastmod>
    <changefreq>${page.changefreq ?? 'monthly'}</changefreq>
    <priority>${page.priority ?? '0.5'}</priority>
  </url>`)
    .join('\n');

  fs.writeFileSync(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );

  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    [
      // Named first so no one reading the file wonders whether AI crawlers are welcome; the wildcard below already admits them.
      ...['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'CCBot', 'Amazonbot', 'meta-externalagent']
        .flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', 'Disallow: /api/', 'Disallow: /portal', '']),
      'User-agent: *',
      'Allow: /',
      // The audit endpoint is a POST API; keep crawlers out of it entirely.
      'Disallow: /api/',
      // Signed-in client areas: nothing there for a crawler, and the pages
      // redirect to the sign-in form without a session anyway.
      'Disallow: /portal',
      '',
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      '',
    ].join('\n'),
  );

  // The long-form home page is also served at /home (see server/app.js: the deck
  // takes / for tablets and desktops). A real file there keeps the link checker
  // honest about /home#pricing-style anchors and lets static hosting serve it.
  // Same bytes, same rel=canonical "/", so the two addresses consolidate.
  const homeCopy = path.join(DIST, 'home', 'index.html');
  if (fs.existsSync(path.join(DIST, 'index.html'))) {
    fs.mkdirSync(path.dirname(homeCopy), { recursive: true });
    fs.copyFileSync(path.join(DIST, 'index.html'), homeCopy);
  }

  console.log(`  html ${written.length} pages (+ /home alias)`);
  console.log(`\nBuilt to dist/ in ${Date.now() - started}ms`);

  return written;
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
