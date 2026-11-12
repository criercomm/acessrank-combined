/**
 * Lighthouse accessibility score via Google PageSpeed Insights.
 *
 * Google loads the page and runs Lighthouse on its own machines, so this costs
 * our server one HTTPS request instead of a second full Chromium audit. It is
 * the same score a plaintiff's firm sees when it runs Lighthouse or PageSpeed
 * on the store, which is why it is shown beside the Accessrank score.
 *
 * Strictly best-effort: no key, a timeout, a quota error or an unreachable page
 * all return null, and the scan result simply has no Lighthouse score. The
 * dialog then leaves the Lighthouse bar out. It must never fail a scan.
 */
import config from './config.js';
import { log } from './logger.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Pull the accessibility score (0–100) out of a PageSpeed Insights v5 response. */
export function parsePagespeed(body) {
  const lh = body && body.lighthouseResult;
  const raw = lh && lh.categories && lh.categories.accessibility && lh.categories.accessibility.score;
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
  return {
    accessibility: Math.round(raw * 100),
    lighthouseVersion: lh.lighthouseVersion || null,
    finalUrl: lh.finalDisplayedUrl || lh.finalUrl || null,
    strategy: (lh.configSettings && lh.configSettings.formFactor) || null,
  };
}

/**
 * @param {string} url the store address (already validated by normalizeTargetUrl)
 * @param {{ apiKey?: string, timeoutMs?: number, strategy?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<null | { accessibility: number, lighthouseVersion: string|null, finalUrl: string|null, strategy: string|null, durationMs: number }>}
 */
export async function fetchLighthouseAccessibility(url, opts = {}) {
  const apiKey = opts.apiKey ?? config.pagespeed.apiKey;
  if (!apiKey) return null;
  const timeoutMs = opts.timeoutMs ?? config.pagespeed.timeoutMs;
  const strategy = opts.strategy ?? config.pagespeed.strategy;
  const doFetch = opts.fetchImpl ?? fetch;

  const qs = new URLSearchParams({ url, category: 'ACCESSIBILITY', strategy, key: apiKey });
  const started = Date.now();
  try {
    const res = await doFetch(`${ENDPOINT}?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Never log the request URL: it carries the API key.
      log.warn('pagespeed request failed', { status: res.status, durationMs: Date.now() - started });
      return null;
    }
    const parsed = parsePagespeed(await res.json());
    if (!parsed) {
      log.warn('pagespeed response had no accessibility score', { durationMs: Date.now() - started });
      return null;
    }
    const durationMs = Date.now() - started;
    log.info('pagespeed score fetched', { durationMs, score: parsed.accessibility });
    return { ...parsed, durationMs };
  } catch (err) {
    log.warn('pagespeed unavailable', {
      reason: err.name === 'TimeoutError' ? 'timeout' : err.message,
      durationMs: Date.now() - started,
    });
    return null;
  }
}

export default { fetchLighthouseAccessibility, parsePagespeed };
