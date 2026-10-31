# Mobile testing

Three layers. Each catches what the one above it cannot.

| Layer | What it is | Catches | When |
|---|---|---|---|
| 1. Automated suite | `scripts/test-mobile.mjs` in emulated phones | Layout bugs, tap targets, iOS zoom, overlays, menu, slow-phone headline, reduced motion | Every push (CI), and before every release |
| 2. Live-site run | The same suite pointed at accessrank.ai | Anything added outside this repo (analytics banner, edge scripts) | Every morning (CI), and after every deploy |
| 3. Real devices | Your iPhone, the iOS Simulator, a cloud device lab | What emulation cannot: Safari toolbars, keyboard, safe areas, real GPU and CPU | Before launch, and after any layout change |

## Commands

```
npm run test:mobile                    build, then test 4 phone sizes in Chromium and WebKit (about 4 minutes)
npm run test:mobile:full               + landscape, tablet, 767px edge, light theme, Chromium and WebKit
npm run test:mobile:live               test the live site instead of the local build
node scripts/test-mobile.mjs --route=/,/beta     only these pages
node scripts/test-mobile.mjs --strict            warnings fail too
```

One-time setup, per computer: `npx playwright install chromium webkit`. `npm run setup` does this too. If a browser is missing the test prints a warning and still runs with the other one.

Open `test-results/mobile/report.html` after a run. It shows a screenshot of every page on every phone, with the findings under each page.

## What it checks

| Check | Fails when | Standard |
|---|---|---|
| horizontal-overflow | The page scrolls sideways at any phone width, including 320px | WCAG 1.4.10 Reflow |
| tap-target | A target is under 24px and crowded by neighbours | WCAG 2.5.8 |
| tap-target-comfort (warn) | A target is under 40px | Apple / Google guidance |
| ios-input-zoom | A form field is under 16px, so iOS Safari zooms the page on focus | iOS behaviour |
| detached-marker | A dot or icon sits alone beside text that wraps (the yellow-dot bug) | Layout |
| covered-content | A fixed widget sits on content at the top or bottom of a page | Layout |
| mobile-nav | The menu button is missing, will not open, or pushes the page sideways | Layout |
| headline-reveal, lcp | On a throttled phone the headline appears after 2s, or LCP is over 2.5s | Core Web Vitals |
| reduced-motion | An infinite animation, or the hidden-headline class, survives "reduce motion" | WCAG 2.3.3 |
| viewport-meta | Pinch-zoom is blocked or the viewport is not device-width | WCAG 1.4.4 |
| console | A script error, or a failed request for a page asset | Health |
| small-text, clipped-text (warn) | Text under 12px, or text cut off by its box | Legibility |

Warnings do not fail a run. Errors do. A deliberate exception goes in `tests/mobile/known-issues.json` with a reason.

## Real-device routine (layer 3, about 15 minutes)

Use your own iPhone first, because it is the real thing.

1. On the Mac: `npm run dev`, then find the Mac's address (System Settings, Wi-Fi, Details).
2. On the iPhone, on the same Wi-Fi, open `http://<that address>:3000`.
3. For the Simulator instead: Xcode, Open Developer Tool, Simulator, then open Safari there. Safari's Develop menu on the Mac can inspect it.

Walk this list on the home page, one pricing or sign-up page, and the audit widget:

- Rotate to landscape and back. Nothing jumps or is cut off.
- Tap the menu, open every item, close it with the button.
- Tap into the audit field. The page must not zoom in. Type, submit, and read the result.
- Scroll to the very bottom. Every link in the footer is reachable and none is under a floating button.
- Turn on Settings, Accessibility, Motion, Reduce Motion. Reload. The headline just shows.
- Turn on Larger Text (Display and Brightness, Text Size, maximum). Nothing overlaps or clips.
- Switch to Low Power Mode and reload on cellular. The headline appears quickly.
- Check light and dark themes.

For devices you do not own (older iPhones, Samsung, Pixel), use BrowserStack Live or a similar cloud lab, and walk the same list.

## What emulation cannot see

Chromium emulation matches screen size, pixel ratio and touch. It does not reproduce iOS Safari's collapsing address bar, safe-area insets, the on-screen keyboard resizing the page, or real-device CPU and GPU. WebKit is much closer to Safari but is still not iOS. That is why layer 3 exists.

## When a test fails

1. Open `report.html`, find the page, look at the screenshot.
2. Fix the CSS or markup.
3. Re-run only that page: `node scripts/test-mobile.mjs --route=/beta`.
4. Never loosen a check to make it pass. If a finding is truly acceptable, add it to `known-issues.json` with the reason.
