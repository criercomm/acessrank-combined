/**
 * Express application, with no side effects on import.
 *
 * Kept separate from index.js so the integration tests can mount the real app
 * on an ephemeral port without starting the production listener, the store
 * warm-up or the signal handlers.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config, { readiness } from './lib/config.js';
import { log, requestId } from './lib/logger.js';
import api from './routes/api.js';
import { isStaff, passMatches, setStaffCookie } from './lib/staff.js';
import portal, { portalPageGate, loginPageGate, reportPage } from './routes/portal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const app = express();
app.disable('x-powered-by');

/**
 * Trust exactly as many proxy hops as are actually in front of us.
 *
 * `trust proxy: true` would accept any X-Forwarded-For a client sends, letting
 * anyone mint unlimited quota by spoofing the header. A fixed hop count means
 * only the address our own load balancer appended is believed.
 */
app.set('trust proxy', config.trustProxy);

/**
 * www.accessrank.ai is served too, but its pages called the API from an origin
 * the check below refuses — every free check started there failed with
 * "Request blocked." Send www visitors to the canonical host instead, so there
 * is one origin, one set of cookies and one canonical URL.
 */
const canonicalHost = new URL(config.siteUrl).host;
app.use((req, res, next) => {
  if (req.get('host') !== `www.${canonicalHost}`) return next();
  const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
  return res.redirect(status, `${config.siteUrl}${req.originalUrl}`);
});

/* ------------------------------------------------------------- headers --- */

const scriptSrc = ["'self'", "https://www.googletagmanager.com"];
// The homepage embeds the investor deck same-origin (site.js openDeck, the
// #deck-overlay-frame iframe) — frame-src must allow 'self' or that overlay
// is silently dead in every environment that enforces this CSP.
const frameSrc = ["'self'"];
const connectSrc = ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com"];

/**
 * The build inlines the stylesheet into every page's <head> to cut the
 * render-blocking request, and records the block's sha256 in dist/csp.json.
 * Allowing that exact hash — never 'unsafe-inline' — keeps the "no inline
 * styles except the one the build produced" guarantee. If the manifest is
 * missing (dist not built yet), style-src stays 'self' alone and the health
 * endpoint's site:false will already be flagging the missing build.
 */
const styleSrc = ["'self'"];
let builtWithTurnstile = false;
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'csp.json'), 'utf8'));
  if (typeof manifest.styleHash === 'string' && /^sha256-[A-Za-z0-9+/=]+$/.test(manifest.styleHash)) {
    styleSrc.push(`'${manifest.styleHash}'`);
  }
  builtWithTurnstile = manifest.turnstileInMarkup === true;
} catch { /* no dist yet — dev without a build, or tests that never serve pages */ }

// CSP must match what the SERVED PAGES contain, and the widget markup is baked
// at build time — so the build's manifest gets a vote, not only this server's
// own env. Otherwise a keyed build behind a keyless server (integration tests,
// local smoke runs) logs a CSP violation on every page load.
if (config.turnstile.enabled || builtWithTurnstile) {
  scriptSrc.push('https://challenges.cloudflare.com');
  frameSrc.push('https://challenges.cloudflare.com');
  connectSrc.push('https://challenges.cloudflare.com');
}
if (config.analytics.plausibleDomain) {
  const origin = new URL(config.analytics.plausibleSrc).origin;
  scriptSrc.push(origin);
  connectSrc.push(origin);
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      // Fonts are self-hosted, so no font CDN needs allowing — which also keeps
      // visitor IPs from reaching a third party, as the privacy policy promises.
      fontSrc: ["'self'"],
      // 'self' plus the sha256 of the one <style> block the build inlines.
      styleSrc,
      scriptSrc,
      scriptSrcAttr: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc,
      frameSrc,
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      manifestSrc: ["'self'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Images under /assets/img/ (including the email-signature logos) are hotlinked
// from other origins (mail clients, and pages that preview a signature), so they
// opt out of helmet's Cross-Origin-Resource-Policy: same-origin default.
app.use((req, res, next) => {
  if (req.path.startsWith('/assets/img/')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  next();
});

// The homepage frames the investor deck same-origin (site.js openDeck, the
// #deck-overlay-frame iframe). The site-wide frame-ancestors 'none' above is
// the right default everywhere else, but it also stops /deck being framed by
// its own parent page — so /deck alone gets 'self' instead of 'none'.
app.use((req, res, next) => {
  if (req.path === '/deck' || req.path.startsWith('/deck/')) {
    const csp = res.getHeader('Content-Security-Policy');
    if (typeof csp === 'string') {
      res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors 'none'/, "frame-ancestors 'self'"));
    }
    res.removeHeader('X-Frame-Options');
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

/* ----------------------------------------------------------- plumbing --- */

app.use((req, res, next) => {
  req.id = requestId();
  res.setHeader('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || res.statusCode >= 400) {
      log.debug('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    }
  });
  next();
});

// A 100kB ceiling is far above any legitimate form and far below anything that
// could be used to exhaust memory.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/**
 * Reject cross-origin API calls. The forms are same-origin, so anything else is
 * either a misconfiguration or someone else's page driving our endpoints.
 */
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();

  const allowed = new Set([config.siteUrl, ...config.security.allowedOrigins]);
  const origin = req.get('origin');
  if (!origin) return next(); // curl and server-to-server callers send none.
  if (allowed.has(origin.replace(/\/+$/, ''))) return next();
  if (!config.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return next();

  log.warn('cross-origin API call refused', { origin });
  return res.status(403).json({ ok: false, code: 'bad_origin', error: 'Request blocked.' });
});

/* -------------------------------------------------------- rate limits --- */

/**
 * These are burst ceilings only — the business quotas from the brief live in the
 * database (server/lib/quota.js), because they must survive a restart and be
 * consistent across processes.
 *
 * The default key generator is used deliberately. A custom `req.ip` key looks
 * equivalent but groups IPv6 by full address, and a residential IPv6 subscriber
 * holds an entire /64 — so a single visitor could rotate through addresses and
 * never hit the limit. The library's default buckets IPv6 by subnet.
 */
const burst = (limit, code, error, options = {}) => rateLimit({
  windowMs: 60_000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, code, error },
  ...options,
});

/**
 * The portal admin API gets its own, higher ceiling instead of the public one.
 * Dropping a folder of reports onto a client area is one request per file, and
 * at the public 60/minute an ordinary upload of a few dozen documents would
 * start failing halfway through. It is still bounded, and every one of those
 * requests is refused without a valid admin session.
 */
const isPortalAdmin = (req) => req.path === '/portal/admin' || req.path.startsWith('/portal/admin/')
  || req.path === '/portal/team-files' || req.path.startsWith('/portal/team-files/')
  || req.path === '/portal/team-notes';

// Coarse ceiling so no single address can flood the API.
app.use('/api', burst(
  config.limits.apiBurstPerMinute,
  'too_many_requests',
  'Too many requests. Please slow down.',
  { skip: isPortalAdmin },
));

app.use('/api/portal/admin', burst(
  config.portal.adminBurstPerMinute,
  'too_many_requests',
  'Too many requests. Wait a minute and try again.',
));

// The team repository is master-only too, and takes uploads the same way.
app.use('/api/portal/team-files', burst(
  config.portal.adminBurstPerMinute,
  'too_many_requests',
  'Too many requests. Wait a minute and try again.',
));

app.use('/api/portal/team-notes', burst(
  config.portal.adminBurstPerMinute,
  'too_many_requests',
  'Too many requests. Wait a minute and try again.',
));

// Password guessing is bounded per email and per address in the database
// (server/lib/portal.js); this only stops a single address hammering the hash.
app.use('/api/portal/login', burst(
  config.portal.loginBurstPerMinute,
  'too_many_requests',
  'Too many sign-in attempts. Wait a minute and try again.',
));

// Scans are the expensive path: a burst cap on top of the daily quota.
app.use('/api/scan', burst(
  config.limits.scanBurstPerMinute,
  'scan_burst_limit',
  'That is a lot of scans at once. Wait a minute and try again.',
));

/*
 * Staff pass. /staff?pass=<code> sets the cookie, then redirects to /staff so the code leaves the
 * address bar; /staff alone reports whether this browser has a pass. A wrong or missing code gets
 * the same page as no pass at all, so the endpoint reveals nothing.
 */
app.use('/staff', burst(10, 'too_many_requests', 'Too many attempts. Wait a minute and try again.'));
app.get(['/staff', '/staff/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (typeof req.query.pass === 'string') {
    if (passMatches(req.query.pass)) setStaffCookie(res);
    return res.redirect(303, '/staff');
  }
  const active = isStaff(req);
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Accessrank staff pass</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;line-height:1.5">
<h1 style="font-size:22px">${active ? 'This browser has unlimited scans' : 'No staff pass in this browser'}</h1>
<p>${active
    ? 'Free scans and report requests from this browser skip the daily limits for the next year. Clearing cookies or using a private window removes the pass.'
    : 'Open your private staff link in this browser to turn it on.'}</p>
<p><a href="/">Go to the checker</a></p></body></html>`);
});

app.use('/api/report', burst(
  config.limits.reportBurstPerMinute,
  'too_many_requests',
  'Too many attempts. Please wait a moment.',
));

/* ---------------------------------------------------------------- api --- */

// Mounted ahead of the general router so /api/portal/* never falls through to it.
app.use('/api/portal', portal);
app.use('/api', api);

/* -------------------------------------------------------- portal pages --- */

// A report page is served from the database with its own policy and its own
// session check, so it is mounted ahead of the generic page gate.
app.get('/portal/report/:id', reportPage);

// Before the static handlers, so a signed-out visitor is redirected to the
// sign-in page rather than served the portal's empty shell.
app.use('/portal', portalPageGate);
app.use('/client-login', loginPageGate);

/* ------------------------------------------------------------- static --- */

if (!fs.existsSync(DIST)) {
  log.warn(`dist/ not found at ${DIST} — run "npm run build" to generate the site.`);
}

// Hashed assets are immutable; everything else revalidates.
app.use('/assets', express.static(path.join(DIST, 'assets'), {
  maxAge: '1y',
  immutable: true,
  fallthrough: true,
}));

// ---------------------------------------------------------------------------
// Two home pages, one address.
//
// The overview deck is the home page for tablets and desktops: a fixed-viewport
// slide experience that is at its best there. Phones get the long-form page
// instead — it has had its own mobile work, and on a phone the deck degrades to
// scrolling stacks. Both are complete, honest pages, so this is "dynamic
// serving" in Google's terms; the Vary header tells caches the two differ, and
// because Google indexes mobile-first, the page it treats as / is the long-form
// one with the FAQ and Offer schema.
//
// The long-form page is also always at /home, for desktop visitors following
// the deck's nav and for the /home#pricing-style anchors. It carries
// rel=canonical "/", so the two addresses consolidate.
//
// Detection is by device class, not viewport: Android phones carry "Mobile" in
// the UA and Android tablets do not; iPhone/iPod name themselves; iPadOS Safari
// reports as a Mac and so gets the deck, which suits it. Chrome also sends the
// Sec-CH-UA-Mobile client hint. ?view=deck / ?view=site override either way,
// for testing and for anyone who wants the other one.
const PHONE_UA = /\bMobile\b|iPhone|iPod|Windows Phone/i;
const TABLET_UA = /iPad|Tablet|PlayBook|Silk/i;
// The AI crawlers robots.txt invites by name. None of them carries a phone
// signature, so without this they would receive the deck — 1,100 words and no
// FAQ or Service schema — while Google's smartphone crawler receives the
// long-form page. They get what every phone visitor gets: a complete page that
// real people see, which is what keeps this dynamic serving rather than cloaking.
const AI_CRAWLER_UA = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|anthropic-ai|PerplexityBot|Google-Extended|Applebot-Extended|Bytespider|CCBot|Amazonbot|meta-externalagent/i;
function wantsLongForm(req) {
  const view = typeof req.query.view === 'string' ? req.query.view : '';
  if (view === 'site') return true;
  if (view === 'deck') return false;
  if (req.get('sec-ch-ua-mobile') === '?1') return true;
  const ua = req.get('user-agent') || '';
  if (AI_CRAWLER_UA.test(ua)) return true;
  return PHONE_UA.test(ua) && !TABLET_UA.test(ua);
}
const HOME_HTML = path.join(DIST, 'index.html');
const DECK_HTML = path.join(DIST, 'deck', 'index.html');
app.get('/', (req, res) => {
  res.setHeader('Vary', 'User-Agent, Sec-CH-UA-Mobile');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  const deckAvailable = fs.existsSync(DECK_HTML);
  return res.sendFile(wantsLongForm(req) || !deckAvailable ? HOME_HTML : DECK_HTML);
});
app.get(['/home', '/home/'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.sendFile(HOME_HTML);
});

app.use(express.static(DIST, {
  extensions: ['html'],
  maxAge: '1h',
  redirect: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  },
}));

/** Serve /about from dist/about/index.html without a trailing-slash redirect. */
app.get(/^\/[\w/-]*$/, (req, res, next) => {
  const candidate = path.join(DIST, req.path, 'index.html');
  if (candidate.startsWith(DIST) && fs.existsSync(candidate)) return res.sendFile(candidate);
  return next();
});

app.use((req, res) => {
  const notFound = path.join(DIST, '404.html');
  res.status(404);
  if (fs.existsSync(notFound)) return res.sendFile(notFound);
  return res.type('text/plain').send('Not found');
});

app.use((err, req, res, _next) => {
  log.error('unhandled error', { err: err.message, id: req.id, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
  res.status(500).json({ ok: false, error: 'Something went wrong on our side.' });
});

export default app;
