# Home page changes and light theme — handoff

Applies on top of commit `15cc5c3` ("Client portal: client login, private file
area per client, admin page"). The portal source in that commit is identical to
the version these edits were built on, so nothing here touches or undoes it —
no file under `server/`, `db/`, `tests/`, and neither `portal.css` nor
`portal.js`, is in this bundle.

## What changed

**Both themes**

- The scrolling yellow marquee is replaced by a static "Works with" strip
  (Shopify, WordPress, WooCommerce, BigCommerce, Custom builds). Its pause
  button and script are removed.
- The stats row (+23%, 2–4 wks, $30K+) loses its blue band and becomes a
  hairline strip in the same style as "Works with".
- The "Target Level AA" note and the pricing buttons get 20px of space above
  them. A list reset in `components.css` was zeroing the margins that were
  meant to provide it.

**New: a light theme**, switched from a sun/moon button at the end of the nav.
Dark remains the default; the choice is saved in `localStorage` (`ar-theme`).

- Colours: page `#FFFFFF`, tiles `#F7F7F7`, accent `#5064B4`.
- In light only: the overlay warning, the "Already facing a claim?" panel and
  the footer are light; the claim pill and button are the accent; rollover
  shadows are the accent.
- The scan results dialog and the investor deck stay dark in both themes.

The README's "Light and dark themes" section says where each piece lives and
how to change the colours.

## Files (15)

Every file is complete and sits at its path from the repo root.

> Copy the **files** into their matching folders. Do not drag the bundle's
> folders onto the repo's folders in Finder — "Replace" swaps the whole folder
> and deletes everything else in it. From a terminal,
> `cp -R accessrank-light-theme/. /path/to/acessrank-combined/` merges safely.

New (2):

```
src/assets/static/theme.js      served as /theme.js; applies a saved light choice before first paint
docs/LIGHT-THEME-HANDOFF.md     this note
```

Replaced (13):

```
src/assets/css/tokens.css       light colour set; --brand-text / --focus roles
src/assets/css/components.css   theme switch; light-only adjustments
src/assets/css/home.css         "Works with" strip; stats row; spacing fixes; brand text -> --brand-text
src/assets/css/pages.css        brand text -> --brand-text; link hover token
src/assets/css/layout.css       brand text -> --brand-text; secondary button border
src/assets/css/base.css         focus ring -> --focus
src/assets/css/a11y.css         focus ring -> --focus
src/assets/js/site.js           theme switch handler; marquee script removed
src/pages/index.html            "Works with" strip markup
src/partials/nav.html           theme switch button
src/partials/shell.html         loads /theme.js in <head>
scripts/selftest-a11y.mjs       audits every page in both themes
README.md                       "Light and dark themes" section
```

`src/partials/shell.html` and `README.md` were also changed by the portal
commit; the versions here are that commit's plus these edits.

`dist/` is not in the bundle. Run `npm run build` and commit the result as with
the portal, or let the Docker build regenerate it on deploy. The site script's
hash changes, so the old `dist/assets/js/site.*.js` and `dist/assets/css/site.*.css`
are removed by the build.

## Things to know before deploying

- **One render-blocking request is added:** `/theme.js` (about 1 kB) loads in
  `<head>` without `defer`. That is deliberate — deferred, a visitor who chose
  light would see every page flash dark first — and the CSP rules out doing it
  inline. If Lighthouse flags it, the alternative is a CSP hash for an inline
  script in `server/app.js`.
- **The inlined stylesheet grows** from about 67 kB to about 74 kB (before
  compression), on every page.
- **The dark theme's colours are otherwise unchanged.** The stats row above is
  the one deliberate restyle. Brand-yellow text was moved from `--brand` to a
  new `--brand-text` token that has the same value in dark; an element-by-element
  comparison of computed colours on seven pages, before and after, shows no
  differences outside the stats row.

## Verified

- `npm run test:unit` (102) and the portal end-to-end tests (15) pass.
- `npm run test:links` passes.
- `npm run test:a11y`, which now covers both themes, passes on every site page
  in dark and light at both viewports. It still fails on `/` and `/deck` for
  colour contrast inside the deck (`.counter-total`, `.mute`); that predates
  both this change and the portal.
- Not verified: Firefox and Safari were not available to test in; everything was
  checked in Chromium only.
