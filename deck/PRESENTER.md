# Accessrank — Presenter Guide

Version 3 · 2026-09-16 · For the presenter of the Accessrank investor deck.
This is the only document you need in the room.

**Links**
- Deck: https://www.accessrank.ai/deck/ — the whole site asks for a password first (Carlos has it). Enter it once per browser; it is remembered for 30 days.
- Backup copy (same deck): https://accessrank-rust.vercel.app/deck/
- Presenter view (your laptop only): add `?presenter=1` to the link.
- Three-minute version (if you are given five minutes): add `?short=1` to the link.

---

## Before you walk in

1. Fill in the inputs the deck shows on purpose as placeholders. They live in one file, `src/copy.js`, and Carlos can change them in minutes: the traction tiles (`TBD`). The deck does not state the raise or the use of funds: those go in the separate spreadsheets. The contact page already carries the real emails and phones of the two co-founders (CEO and CTO); the team is deliberately not named on any scene.
2. Open the link in Chrome on the laptop that drives the screen. Refresh once with Ctrl+Shift+R (Cmd+Shift+R on a Mac).
3. The deck opens straight on scene 1. It has sound effects only (no music). They start with your first click; if the room has no speakers, click "Sound on" at the top right or press M to turn them off.
4. Go full screen: F11 on Windows, Ctrl+Cmd+F on a Mac. Leave the mouse still; the cursor fades.
5. Two screens? Open the plain link on the projector and the link with `?presenter=1` on your laptop. The presenter panel shows the current scene, the next one, your talking point and the clock. It never appears on the audience screen.
6. Click through all eleven scenes once so every image is cached. Go back to scene 1 with the Home key.

## Controls

| To | Do |
|---|---|
| Next | Click anywhere · → or Space · swipe left on a phone |
| Back | ← · Shift+click · swipe right |
| Sound | The "Sound on / off" label at the top right, or the M key |
| Jump | Home = scene 1 · End = contact (scene 11) |

The counter at the top right always tells you where you are. Three scenes need more than one click before they move on; the table says how many.

---

## Scene by scene

| # | Scene | On screen | Clicks to leave | Say |
|---|---|---|---|---|
| 01 | Blind spot | THE WEB'S BIGGEST BLIND SPOT. A floating ecommerce home page with a scanner beam crossing it. | 1 | "Ninety-five percent of websites fail accessibility standards. Most companies find out when a demand letter arrives. We find it, we fix it in the code, and the fix makes the pages faster and more visible." |
| 02 | The letter | A real complaint rises into view. Four numbers clack in. | 1 | Let the page rise before you speak. "This is a real one, filed in March. Five thousand of these last year. Seventy-nine percent against online stores. Forty-five percent hit companies that had already been sued once. Thirty thousand dollars each before anyone fixes anything." |
| 03 | Plug-ins | "Simply adding an accessibility plug-in isn't a fix." A wall of 400 widget badges assembles under it. | 2 (first click: 38.5 % of them turn red) | "This wall is every store that bought a plug-in. Click. The red ones were sued anyway. Thirty-eight percent of the companies sued already had one. The FTC fined the biggest vendor a million dollars. A widget is not a defense; it is a signal to the plaintiff's bar. We fix the source." |
| 04 | The fix | A real storefront. Scan → findings → fix → validate. | 5 (four stages, then leave) | Click 1, Scan: "Forty-seven issues on six pages, score 41." Click 2, Findings: "One of them, with its evidence: rule, criterion, selector, measured contrast." Click 3, Fix: "The actual code change, on a draft theme, approved by a person." Click 4, Validate: "Re-scan. Zero remaining. Score 96. Every step documented." Then hover Rollback: everything comes back. Frame it as our safety net, not a button the owner presses — "if a change ever misbehaves, we revert it and a verification scan runs automatically." Say: "Nothing here is a screenshot. It is the cycle the product runs." |
| 05 | Safe | Five guardrails on a line; the explanation sits centred under the active one. Three people from behind. | Up to 5 (one guardrail per click) or hover them | "The live store never goes down because we never touch the live theme. And every fix is measured and documented, which is what keeps the lawyers at bay." |
| 06 | Engine | Why accessibility lifts visibility and revenue: four numbers (images without text, traffic growth, 27% abandonment, 70M+ adults with a disability), plus the four standards. | 1 | "Screen readers, Google and AI shopping agents read the same structure. Fix it once for the blind and the page becomes more visible to search and to agents. Seventy-three percent of remediated sites grew organic traffic. And it is revenue: seventy million American adults live with a disability, and more than a quarter of disabled shoppers abandon a purchase every month because a store does not work for them." |
| 07 | Model | Three plans and the lawsuit-response lane. | 1 | "A one-time project to raise the score, then a monthly plan to hold it there. The lawsuit-response lane is the fastest path to a first check: brands served this week." Be transparent: "Today the service is operated by our team. Self-serve billing is on the roadmap." |
| 08 | Market | Top eight ADA lawsuits by state and by industry (2025 report). Two expansion rails. | 1 | "Four states carry eighty-seven percent of the filings and two industries, food and fashion, carry sixty percent. That is where the first customers are. The rails below are where the same engine goes next." |
| 09 | Today | Engineering numbers, traction, how it is built. | 1 | "The full cycle works end to end today: scan, remediate on a draft, validate, report, rollback. It is an alpha in maturity and an operated service in delivery." If asked about the team, describe the operating model; no names on screen by design. |
| 10 | Libraries | Teaser: Accessrank for Libraries. Three numbers, a catalog mock with three failures, platforms and annual plans. | 1 | "The same engine has a second market with a legal deadline attached: public libraries. Title II now applies WCAG to their catalogs, with 2027 and 2028 deadlines. Ninety-six percent fail today. Annual plans priced for library budgets." A teaser: no dates or customers promised. |
| 11 | Contact | Let's talk. Co-founder and CEO / CTO, emails, phones, accessrank.ai. | Stay | Close with the question on screen: "Which of your portfolio brands should we scan first?" |

Scene 04 is the moment the room should lean forward. Do not narrate over the scan; let the beam finish, then speak.

---

## Words

| Instead of | Say |
|---|---|
| "We use AI to fix accessibility." | "We fix the code and re-scan until zero remain. Deterministic first; AI only where a person reviews it." |
| "We guarantee you won't get sued." | "We give you fixed code and evidence a lawyer can read. Nobody honest guarantees the rest." |
| "It's like an overlay but better." | "It is the opposite of an overlay. Overlays hide the problem at runtime. We change the theme." |

Never say: certified, compliant-guaranteed, SOC 2 / HIPAA / PCI as things we do today, Lighthouse, real-user data, self-serve SaaS.
Use: fix, proof, evidence, draft theme, re-scan, zero remaining, rollback, operated service, general availability.

---

## What is true, if anyone asks

- **"Where does the 95% come from?"** WebAIM Million 2026, its audit of the top one million home pages: 95.9% had detectable WCAG failures, up from 94.8% in 2025. The deck rounds down to 95%.
- **"Where do 70 million and 27% come from?"** CDC, July 2024 release on 2022 survey data: more than 1 in 4 U.S. adults, over 70 million, reported a disability. The 27% is from a survey by Fable, an accessibility-testing company, of disabled online shoppers in its own community: 27% give up on a purchase at least once a month because of accessibility problems, 8% weekly. It is a panel survey, not a national sample; say so if pressed.
- **"Is that letter real?"** Yes. It is the first page of a web-accessibility complaint filed in New York State court in March 2026 against an online food brand. Names, addresses, phone, email and the index number are blurred on purpose. The claims it makes are the ones on scene 4: unlabeled controls, cart updates not announced, keyboard traps, images without alt text.
- **"Is this a widget?"** No. It modifies the real theme or code. A runtime overlay exists only as a last resort when there is no code access, and the catalog forbids using it to fake semantic fixes.
- **"What if you break the store?"** We never write to the published theme. Draft theme, approval per change with the diff on screen, read-back verification of every file, validation with zero remaining, explicit publish, and if a change ever misbehaves we revert it ourselves with an automatic verification scan.
- **"How much do you fix automatically?"** An engineering estimate, not a measured result: around half of WCAG 2.2 AA is detectable automatically and roughly a third is fixable with repository access. What needs people becomes a ticket with a checklist and evidence.
- **"Is it SaaS?"** Today it is an operated service with a client portal for access and reports. Self-serve billing and an agency tier are on the roadmap.
- **"Do you guarantee we won't be sued?"** No, and nobody honest does. You get fixed code, a verification report and a downloadable evidence pack for your lawyers.
- **"What do you scan?"** WCAG 2.2 AA with 55 criteria live, ADA ecommerce lawsuit patterns, Core Web Vitals in the lab, technical SEO and AI-search readiness, OWASP Top 10 basics. 35 detectors in a real browser, 114 signal types, 35 remediators.
- **"Which platforms?"** Shopify end to end (draft theme, publish, revert), WordPress, GitHub and Bitbucket pull requests, code ZIPs, Cloudflare for the overlay fallback. Nothing else should be claimed as an integration today.
- **"How big is the product?"** About 99,000 lines of TypeScript in the API, 140 routes, 39 data models, roughly 1,200 automated tests.
- **"Where do the market numbers come from?"** EcomBack's 2025 annual report: 3,948 website-accessibility suits in state and federal courts; New York, Florida, California and Illinois carry 87%; restaurants and food 35%, fashion and apparel 26%. UsableNet's 2025 year-end and 2026 midyear reports for the lawsuit counts on scene 2; AudioEye 2026 for the widget figure.
- **"Is the store real?"** No. Northline Goods is a fictional store drawn in code so that the product's real cycle could be shown without naming a client. The failures it shows are the ones the product detects every day.

---

## If something goes wrong

- **The scan doesn't start.** Click once more; the beam runs on the first click of scene 04.
- **No sound.** Effects start with the first click. If the label at the top right says "Sound off", click it or press M.
- **You lost your place.** The counter at the top right. Home returns to scene 1, End goes to contact.
- **The page shows browser chrome.** Press Escape, reload, go full screen.
- **A password page appears.** That is the site's lock: enter the password Carlos gave you. The browser remembers it for 30 days; after ten wrong tries it asks you to wait 15 minutes. The backup link has no password.
- **The page will not load.** Use the backup link; both hold the same deck.
- **You have five minutes, not ten.** Use the link with `?short=1`: blind spot, the letter, the fix, the model, contact.

Northline Goods, its products and the people shown are original creations for this presentation. The complaint shown is a public court filing with personal and contact details blurred.
