import crypto from 'node:crypto';

/**
 * Content-Security-Policy for a report page served inside the portal.
 *
 * A report is one self-contained HTML page, so it carries its own inline
 * <script> and <style>. The site-wide policy forbids inline code, and loosening
 * it with 'unsafe-inline' would loosen it for every page. Instead each report
 * is hashed when it is served: the policy allows exactly the inline blocks that
 * are in the document being sent, so a block that is added later, or injected,
 * does not run.
 *
 * What stays locked: no inline event handlers (script-src-attr 'none'), no
 * external scripts, no framing, and connect-src 'self' so the page can talk to
 * the portal API and nowhere else. Inline style="" attributes are allowed, since
 * they cannot run code and a hash cannot cover them.
 */

const sha = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** Hashes of every non-empty inline <script> and <style> body in a page. */
export function inlineHashes(html) {
  const grab = (tag) => [...String(html).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))]
    // A <script src> has no body and is not allowed by this policy anyway.
    .map((m) => m[1])
    .filter((body) => body.trim() !== '')
    .map(sha);
  return { script: grab('script'), style: grab('style') };
}

/** The CSP header value for one report, derived from the site-wide one. */
export function reportCsp(baseCsp, html) {
  const { script, style } = inlineHashes(html);
  const directives = new Map(String(baseCsp).split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [name, ...rest] = d.split(/\s+/); return [name, rest]; }));
  directives.set('script-src', ["'self'", ...script]);
  directives.set('style-src', ["'self'", ...style]);
  directives.set('style-src-attr', ["'unsafe-inline'"]);
  // Report fonts and images are embedded as data: URIs so the file also works on its own.
  directives.set('font-src', ["'self'", 'data:']);
  directives.set('img-src', ["'self'", 'data:']);
  directives.set('connect-src', ["'self'"]);
  directives.set('frame-src', ["'none'"]);
  return [...directives].map(([name, values]) => [name, ...values].join(' ')).join('; ');
}
