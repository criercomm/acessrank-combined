/* ---- site.js ---- */
/* Accessrank — shared site behaviour. No framework, no dependencies. */
(function () {
  'use strict';

  /* ------------------------------------------------------ mobile nav --- */

  var toggle = document.querySelector('.nav-toggle');
  var menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // Escape closes the menu and returns focus to the control that opened it.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    // Leaving the mobile breakpoint must not strand the menu in an open state.
    var mq = window.matchMedia('(min-width: 861px)');
    var onChange = function (event) { if (event.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* --------------------------------------------------- nav dropdown --- */

  document.querySelectorAll('[data-nav-menu]').forEach(function (item) {
    var btn = item.querySelector('.nav-menu-toggle');
    if (!btn) return;
    var setOpen = function (open) {
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!item.classList.contains('is-open'));
    });
    document.addEventListener('click', function (e) {
      if (!item.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && item.classList.contains('is-open')) { setOpen(false); btn.focus(); }
    });
    // Mark the page we are on.
    var here = location.pathname.replace(/\/$/, '') || '/';
    item.querySelectorAll('.nav-submenu a').forEach(function (a) {
      var target = a.getAttribute('href').replace(/\/$/, '');
      if (target === here) a.setAttribute('aria-current', 'page');
    });
  });

  /* ----------------------------------------------------- theme switch --- */
  /* /theme.js has already applied a saved choice before first paint; this
   * wires the button in the nav. Dark is the default, so "light" is the only
   * value ever stored — choosing dark again clears it. */
  var themeButtons = document.querySelectorAll('[data-theme-toggle]');

  var currentTheme = function () {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  };

  var paintThemeButtons = function () {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    themeButtons.forEach(function (button) {
      var label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = 'Switch to ' + next + ' mode';
    });
  };

  var setTheme = function (theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FFFFFF' : '#14142A');

    try {
      if (theme === 'light') window.localStorage.setItem('ar-theme', 'light');
      else window.localStorage.removeItem('ar-theme');
    } catch (e) { /* storage blocked: the choice lasts for this page only */ }

    paintThemeButtons();
  };

  themeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  });
  paintThemeButtons();

  /* ---------------------------------------- billing period toggle ---- */

  var billToggle = document.getElementById('bill-toggle');
  var pricingSection = document.querySelector('.pricing');

  if (billToggle && pricingSection) {
    var billButtons = billToggle.querySelectorAll('[data-bill]');
    var applyBill = function (bill) {
      pricingSection.setAttribute('data-bill', bill);
      billButtons.forEach(function (button) {
        var active = button.getAttribute('data-bill') === bill;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      pricingSection.querySelectorAll('[data-m][data-a]').forEach(function (el) {
        el.textContent = el.getAttribute(bill === 'annual' ? 'data-a' : 'data-m');
      });
    };
    billButtons.forEach(function (button) {
      button.addEventListener('click', function () { applyBill(button.getAttribute('data-bill')); });
    });
    applyBill('monthly');
  }

  /* ------------------------------------------------- pricing toggle ---- */

  var priceToggle = document.getElementById('price-toggle');
  var pricing = document.querySelector('.pricing');

  if (priceToggle && pricing) {
    var buttons = priceToggle.querySelectorAll('[data-mode]');

    var applyMode = function (mode) {
      pricing.setAttribute('data-mode', mode);

      buttons.forEach(function (button) {
        var active = button.getAttribute('data-mode') === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      pricing.querySelectorAll('[data-onetime]').forEach(function (el) {
        var full = Number(el.getAttribute('data-onetime'));
        if (!full) return;
        // IRS Form 8826: 50% of eligible expenses over $250, capped at $5,000.
        var credit = Math.min(0.5 * Math.max(full - 250, 0), 5000);
        var net = Math.round(full - credit);
        el.textContent = '$' + (mode === 'credit' ? net : full).toLocaleString('en-US');
      });

      pricing.querySelectorAll('[data-was]').forEach(function (el) {
        el.hidden = mode !== 'credit';
      });
    };

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        applyMode(button.getAttribute('data-mode'));
      });
    });

    applyMode('standard');
  }

  /* The FORM 8826 button in the tax credit card: switches the pricing to the after-credit view; the link then
   * scrolls to the pricing toggles, with the new prices below them. */
  document.querySelectorAll('[data-apply-credit]').forEach(function (link) {
    link.addEventListener('click', function () {
      var creditButton = document.querySelector('#price-toggle [data-mode="credit"]');
      if (creditButton) creditButton.click();
    });
  });

  /* ------------------------------------------- overview deck overlay --- */
  /* "Overview" in the primary nav (site.json: nav[].deck) and "Why stores get
   * sued" under the hero open the overview deck (built to /deck/) full-screen over
   * whatever page the person is on, instead of navigating there. The href
   * stays a real "/deck/" link so it still does something reasonable
   * without JS. Registered before the smooth-anchor handler below and stops
   * the event outright, so that handler never also tries to scroll the page
   * underneath to #product while the overlay is opening on top of it. */
  var deckOverlay = document.getElementById('deck-overlay');
  var deckFrame = document.getElementById('deck-overlay-frame');
  var deckClose = document.getElementById('deck-overlay-close');
  var deckOpener = null;

  var openDeck = function (opener) {
    if (!deckOverlay) return;
    /* Phones never get the slide deck (server/app.js serves them the long-form
       page at /); the overlay would show them exactly the experience we route
       them away from. Send them to the deck's readable text version instead. */
    if (window.matchMedia('(max-width: 767px)').matches) {
      window.location.href = '/deck/#deck-text';
      return;
    }
    if (deckFrame && !deckFrame.getAttribute('src')) deckFrame.setAttribute('src', '/deck/');
    deckOpener = opener || null;
    deckOverlay.hidden = false;
    document.body.classList.add('deck-open');
    if (deckClose) deckClose.focus();
  };

  var closeDeck = function () {
    if (!deckOverlay || deckOverlay.hidden) return;
    deckOverlay.hidden = true;
    document.body.classList.remove('deck-open');
    if (deckOpener) deckOpener.focus();
  };

  if (deckOverlay) {
    document.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-open-deck]');
      if (!opener) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openDeck(opener);
    }, true);

    if (deckClose) deckClose.addEventListener('click', closeDeck);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !deckOverlay.hidden) closeDeck();
    });
  }

  /* ------------------------------------------------ smooth anchors ----- */

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#"], a[href^="/#"], a[href^="/home#"]');
    if (!link) return;

    /* The long-form page's section links are written /home#section so they work
       from the deck and from every other page. On the long-form page itself
       (served at / for phones and at /home otherwise) they are in-page anchors. */
    var hash = link.getAttribute('href').replace(/^\/(home)?/, '');
    if (hash === '#' || hash.length < 2) return;

    var target = document.querySelector(hash);
    if (!target) return; // let the browser navigate to the other page

    e.preventDefault();
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    });

    // scrollIntoView does not move focus, which strands keyboard and screen
    // reader users at the top of the document.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    history.replaceState(null, '', hash);
  });

  /* --------------------------------------------------- lead forms ------ */

  document.querySelectorAll('form[data-lead-form]').forEach(function (form) {
    var status = form.querySelector('[data-form-status]');
    var submit = form.querySelector('[type="submit"]');
    var loadedAt = form.querySelector('[name="formLoadedAt"]');
    if (loadedAt) loadedAt.value = String(Date.now());

    // Prefill from the query string so /signup?plan=growth lands on the right plan.
    var params = new URLSearchParams(location.search);
    // Pages with [data-intent] blocks show the copy for ?intent=lawsuit or ?intent=record
    // (the claim section and the Compliance Record both send people here), else the default.
    var intentBlocks = document.querySelectorAll('[data-intent]');
    if (intentBlocks.length) {
      var wanted = params.get('intent');
      var known = Array.prototype.some.call(intentBlocks, function (el) { return el.getAttribute('data-intent') === wanted; });
      var show = known ? wanted : 'default';
      Array.prototype.forEach.call(intentBlocks, function (el) { el.hidden = el.getAttribute('data-intent') !== show; });
      if (known) {
        var planField = form.querySelector('[name="plan"]');
        if (planField && planField.type === 'hidden') planField.value = wanted;
        try { document.title = (show === 'lawsuit' ? 'Served a demand letter? Talk to Accessrank now' : 'Request a sample Accessibility Compliance Record') + ' — Accessrank'; } catch (e) {}
      }
    }
    ['plan', 'intent'].forEach(function (key) {
      var value = params.get(key);
      if (!value) return;
      var field = form.querySelector('[name="' + key + '"]');
      if (field) field.value = value;
      var pill = document.querySelector('[data-plan-pill]');
      if (key === 'plan' && pill && value !== 'audit') pill.textContent = value.charAt(0).toUpperCase() + value.slice(1) + ' plan';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.dataset.busy === '1') return;

      form.dataset.busy = '1';
      if (submit) { submit.disabled = true; submit.dataset.label = (submit.innerText || submit.textContent).trim(); submit.textContent = 'Sending…'; }
      if (status) { status.textContent = ''; status.className = 'form-status'; }
      form.querySelectorAll('.field-error').forEach(function (el) { el.remove(); });
      form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });

      var payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });
      payload.consent = form.querySelector('[name="consent"]') ? form.querySelector('[name="consent"]').checked : true;
      payload.marketingOptIn = form.querySelector('[name="marketingOptIn"]')
        ? form.querySelector('[name="marketingOptIn"]').checked : false;

      // "Let the audit decide": run the free check on the store first, so the lead goes out with the
      // suggested plan attached and the visitor sees the placement on the thanks card. A failed scan
      // never blocks the enquiry; the lead is sent with plan "audit" and the specialist scopes it.
      var placement = null;
      var wantsPlacement = payload.plan === 'audit' && payload.website;

      // Progress while the store is scanned: the button shows a spinner and the status line walks
      // through the stages on a timer, since the scan itself is a single request of up to about 45 seconds.
      var progressTimers = [];
      var setProgress = function (label, note) {
        if (submit) { submit.classList.add('is-busy'); submit.textContent = label; }
        if (status && note != null) { status.textContent = note; status.className = 'form-status is-progress'; }
      };
      var clearProgress = function () {
        progressTimers.forEach(clearTimeout); progressTimers = [];
        if (submit) submit.classList.remove('is-busy');
        if (status && status.classList.contains('is-progress')) { status.textContent = ''; status.className = 'form-status'; }
      };
      var startScanProgress = function () {
        setProgress('Testing your store…', 'Loading your store in a real browser.');
        progressTimers.push(setTimeout(function () { setProgress('Testing your store…', 'Checking it against the WCAG 2.2 Level A and AA criteria.'); }, 7000));
        progressTimers.push(setTimeout(function () { setProgress('Testing your store…', 'Placing your store in a plan.'); }, 16000));
        progressTimers.push(setTimeout(function () { setProgress('Testing your store…', 'Still working. Larger stores take a little longer.'); }, 28000));
      };

      window.Accessrank.waitForToken(form, 45000).then(function (token) {
        if (token) payload.turnstileToken = token;
        if (!wantsPlacement) return null;
        startScanProgress();
        return window.Accessrank.post('/api/scan', { url: payload.website, turnstileToken: token || undefined, lighthouse: false })
          .then(function (scan) { return scan && scan.placement ? scan.placement : { failed: true, message: 'The scan returned no result.' }; })
          .catch(function (err) { return { failed: true, message: err && err.message ? err.message : 'The scan could not be completed.' }; });
      }).then(function (found) {
        placement = found;
        if (placement && placement.tier) {
          payload.plan = placement.tier;
          payload.intent = 'audit_placed';
          payload.placementNote = (placement.label || placement.tier) + ' \u2014 ' + (placement.reason || '')
            + (placement.overlayNote ? ' ' + placement.overlayNote : '');
        } else if (placement && placement.failed) {
          payload.intent = 'audit_scan_failed';
          payload.placementNote = 'Scan could not be completed: ' + placement.message;
        }
        clearProgress();
        setProgress('Sending…', null);
        // A Turnstile token is single-use and the scan just spent it, so the lead needs a fresh one;
        // re-sending the same token made Cloudflare reject every "Let the audit decide" enquiry.
        if (!wantsPlacement) return window.Accessrank.post('/api/lead', payload);
        return window.Accessrank.freshToken(form, 45000).then(function (token) {
          if (token) payload.turnstileToken = token;
          return window.Accessrank.post('/api/lead', payload);
        });
      }).then(function (data) {
        var success = form.parentElement.querySelector('[data-form-success]');
        if (success) {
          var failedSlot = success.querySelector('[data-placement-failed]');
          if (failedSlot && placement && placement.failed) {
            failedSlot.querySelector('[data-placement-failed-message]').textContent = placement.message;
            failedSlot.hidden = false;
          }
          var slot = success.querySelector('[data-placement]');
          if (slot && placement && placement.tier) {
            slot.querySelector('[data-placement-label]').textContent = placement.label || placement.tier;
            slot.querySelector('[data-placement-reason]').textContent = placement.reason || '';
            var overlayLine = slot.querySelector('[data-placement-overlay]');
            if (overlayLine) {
              var ovNames = placement.overlays && placement.overlays.length ? placement.overlays.join(' and ') : '';
              overlayLine.textContent = '';
              overlayLine.hidden = !ovNames;
              if (ovNames) {
                var tag = document.createElement('span');
                tag.className = 'ov-tag';
                tag.textContent = 'Overlay detected';
                var name = document.createElement('strong');
                name.textContent = ovNames;
                overlayLine.appendChild(tag);
                overlayLine.appendChild(name);
                overlayLine.appendChild(document.createTextNode(' is running on your store. An overlay sits on top of the page and leaves the code underneath unchanged, and that code is what the automated scans predatory ADA lawyers use will read. The specialist will plan fixes in the code itself.'));
              }
            }
            slot.hidden = false;
          }
          form.hidden = true;
          success.hidden = false;
          success.setAttribute('tabindex', '-1');
          success.focus();
        } else if (status) {
          status.textContent = 'Thanks — we will be in touch shortly.';
          status.className = 'form-status is-success';
        }
        return data;
      }).catch(function (err) {
        if (status) {
          status.textContent = err.message;
          status.className = 'form-status is-error';
        }
        if (err.field) {
          var field = form.querySelector('[name="' + err.field + '"]');
          if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
          }
        }
        if (window.turnstile) window.turnstile.reset();
      }).finally(function () {
        clearProgress();
        form.dataset.busy = '0';
        if (submit) { submit.disabled = false; submit.classList.remove('is-busy'); submit.textContent = submit.dataset.label || 'Send'; }
      });
    });
  });

  /* --------------------------------------------------------- shared ---- */

  window.Accessrank = window.Accessrank || {};

  /** POST JSON and turn a non-2xx response into a rejected Error carrying `code`/`field`. */
  window.Accessrank.post = function (path, payload) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.ok && data.ok) return data;
        var error = new Error(data.error || 'Something went wrong. Please try again.');
        error.code = data.code;
        error.field = data.field;
        error.status = response.status;
        error.retryAt = data.retryAt;
        throw error;
      });
    });
  };

  window.Accessrank.reducedMotion = function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /* ------------------------------------------------------ turnstile --- */
  /* Cloudflare Turnstile loads on demand, not with the page: its script sets a
   * third-party cookie (_cfuvid) and logs cookie issues, which cost Lighthouse
   * Best Practices 23 points for visitors who never touch a form. It now loads
   * the first time someone focuses or taps into a form that needs it (or when a
   * scan starts), which leaves it seconds to solve invisibly before submit. */
  var turnstileLoading = null;
  window.Accessrank.loadTurnstile = function () {
    if (!document.body.getAttribute('data-turnstile-key')) return Promise.resolve(false);
    if (turnstileLoading) return turnstileLoading;
    turnstileLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return turnstileLoading;
  };

  /**
   * Resolve with the Turnstile token inside `container`, waiting for it if needed.
   * Every widget is interaction-only (invisible unless Cloudflare wants a click),
   * so nothing tells the visitor the check is still running; submitting before
   * the token exists used to fail with "Please complete the verification check".
   * Resolves at once when Turnstile is off; after `ms` it resolves with whatever
   * is there and lets the server give its message.
   */
  window.Accessrank.waitForToken = function (container, ms) {
    window.Accessrank.loadTurnstile();
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        var field = container && container.querySelector('[name="cf-turnstile-response"]');
        var value = field ? field.value : '';
        if (value || !document.body.getAttribute('data-turnstile-key') || Date.now() - start > ms) return resolve(value);
        setTimeout(poll, 150);
      })();
    });
  };

  /**
   * Throw away the token already spent in `container` and wait for the widget to issue a new one.
   * For flows that verify twice from one form (the signup scan, then the lead).
   */
  window.Accessrank.freshToken = function (container, ms) {
    var widget = container && container.querySelector('.cf-turnstile');
    if (!window.turnstile || !widget) return window.Accessrank.waitForToken(container, ms);
    var field = container.querySelector('[name="cf-turnstile-response"]');
    if (field) field.value = '';
    try { window.turnstile.reset(widget); } catch (e) { /* not rendered; the poll gives up after ms */ }
    return window.Accessrank.waitForToken(container, ms);
  };

  function wantsTurnstile(target) {
    var form = target && target.closest ? target.closest('form') : null;
    return !!form && (form.id === 'audit-form' || !!form.querySelector('.cf-turnstile'));
  }
  ['focusin', 'pointerdown'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (wantsTurnstile(e.target)) window.Accessrank.loadTurnstile();
    }, { passive: true });
  });

}());


/* ---- audit.js ---- */
/*
 * Accessrank — hero audit widget and report lead capture.
 *
 * Replaces the original simulated demo, which ran a fake scan of "example.shop"
 * 800ms after page load with hardcoded results for every visitor. This calls the
 * real /api/scan endpoint, renders real axe-core findings, and only runs when a
 * person asks it to.
 *
 * The scan runs in a dialog (#scan-modal) so the homepage never reflows under
 * the visitor: progress first, then the scan summary beside the report form with
 * Access and Rank results below, or the reason the scan could not run. The card itself only keeps
 * the address field — plus a "View your results" button if the visitor closed
 * the dialog before the scan finished.
 *
 * The report flow is deliberately email-only: the PDF is never downloaded in the
 * browser, it is sent to the address the visitor gives. That is what makes the
 * one-report-per-email rule meaningful, and it is the point of the capture.
 */
(function () {
  'use strict';

  var card = document.getElementById('audit-card');
  if (!card) return;

  var form = document.getElementById('audit-form');
  var input = document.getElementById('audit-url');
  var button = document.getElementById('audit-submit');
  var status = document.getElementById('audit-status');
  var meta = document.getElementById('audit-meta');
  var results = document.getElementById('audit-results');
  var reportCta = document.getElementById('audit-report-cta');
  var errorBox = document.getElementById('audit-error');

  var modal = document.getElementById('scan-modal');
  // The partial sits inside .hero-audit, which has a transform — and a transformed
  // ancestor turns position:fixed into "fixed to that box" and caps z-index at its
  // stacking context, so the dialog neither covered the viewport nor sat above the
  // page (the risk strip took its clicks). As a direct child of <body> it does both.
  if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
  var panel = modal ? modal.querySelector('.scan-panel') : null;
  var views = {
    scanning: { node: document.getElementById('scan-progress'), title: 'scan-progress-title' },
    result: { node: document.getElementById('scan-result'), title: 'scan-result-title' },
    failed: { node: document.getElementById('scan-failed'), title: 'scan-failed-title' }
  };
  var stepsList = document.getElementById('scan-steps');
  var barFill = document.getElementById('scan-bar-fill');
  var live = document.getElementById('scan-live');

  var state = { scanning: false, scanId: null, result: null, host: '' };

  /**
   * Reset ONE Turnstile widget, by its container.
   *
   * Tokens are single-use: the server spends them at siteverify, but the widget
   * has no way to know and keeps offering the spent token until its ~5-minute
   * self-refresh. There are two widgets on this page (scan card + report modal),
   * and a bare `turnstile.reset()` resets whichever rendered FIRST — so the
   * modal's error path was resetting the card's widget while its own kept the
   * dead token. Every reset here names its widget.
   */
  function resetTurnstileIn(container) {
    if (!window.turnstile || !container) return;
    var widget = container.querySelector('.cf-turnstile');
    if (widget) try { window.turnstile.reset(widget); } catch (e) { /* not rendered yet */ }
  }

  // Token wait + on-demand loading of Turnstile live in site.js (Accessrank.waitForToken / loadTurnstile).
  function waitForToken(container, ms) { return window.Accessrank.waitForToken(container, ms); }

  /* ------------------------------------------------------------ util --- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setStatus(message, tone) {
    if (!status) return;
    status.textContent = message || '';
    status.className = 'scan-status' + (tone ? ' is-' + tone : '') + (message ? ' active' : '');
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function hostOf(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  var IMPACT_LABEL = {
    critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor'
  };

  /* ---------------------------------------------------------- views --- */

  /** Show one of the dialog's three views and label the dialog by its heading. */
  function setView(name) {
    if (!panel) return;
    panel.setAttribute('data-state', name);
    Object.keys(views).forEach(function (key) {
      if (views[key].node) views[key].node.hidden = key !== name;
    });
    modal.setAttribute('aria-labelledby', views[name].title);
  }

  function focusViewTitle(name) {
    var title = document.getElementById(views[name].title);
    if (title && modal && !modal.hidden) title.focus();
  }

  /* Honest progress: these are the phases the server actually works through. */
  var PHASES = [
    'Loading the page in a real browser',
    'Running axe-core against WCAG 2.2 A/AA',
    'Checking colour contrast and accessible names',
    'Reading SEO and AI agent signals',
    'Getting your Lighthouse score from Google',
    'Scoring'
  ];

  function renderSteps(current, done) {
    if (!stepsList) return;
    stepsList.innerHTML = '';
    PHASES.forEach(function (label, i) {
      var li = el('li', 'scan-step', label);
      li.setAttribute('data-step', done || i < current ? 'done' : i === current ? 'now' : 'todo');
      if (i === current && !done) li.setAttribute('aria-current', 'step');
      stepsList.appendChild(li);
    });
    // Never reaches 100% until the server answers: the bar is a pace, not a promise.
    if (barFill) barFill.style.setProperty('--pct', (done ? 100 : Math.min(90, 12 + current * 19)) + '%');
    if (live && !done) live.textContent = PHASES[current] + '…';
  }

  /* --------------------------------------------------------- render --- */

  /*
   * Result view: Access (accessibility) beside Rank (SEO and AI agent readiness).
   * Both halves are written into one grid as cells with a column (c1 / c2) and a row
   * (r1 heading, r2 headline, r3 first score and its caption, r4 second score, r5 findings), so their
   * scores share one baseline whatever the copy above them wraps to.
   * The Accessrank score is the accessibility score; SEO and AI agent readiness are
   * reported beside it and never blended in.
   */

  /* Same thresholds as band() in server/lib/scoring.js. */
  function toneOf(score) {
    if (score == null) return 'neutral';
    if (score >= 90) return 'good';
    if (score >= 75) return 'ok';
    if (score >= 50) return 'warn';
    return 'bad';
  }
  /* Lighthouse's own colour bands: 90–100 green, 50–89 orange, 0–49 red. */
  function lighthouseTone(score) {
    if (score == null) return 'neutral';
    if (score >= 90) return 'good';
    if (score >= 50) return 'warn';
    return 'bad';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function scoreBar(label, detail, value, tone) {
    var bar = el('div', 'ar-bar');
    bar.setAttribute('data-tone', tone);
    var top = el('div', 'ar-bar-top');
    var lab = el('p', 'ar-bar-label');
    lab.appendChild(el('strong', null, label));
    if (detail) lab.appendChild(el('span', null, detail));
    top.appendChild(lab);
    top.appendChild(el('span', 'ar-bar-num', value == null ? '—' : String(value)));
    bar.appendChild(top);
    var track = el('div', 'ar-bar-track');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', label + ': ' + (value == null ? 'not scored' : value + ' out of 100'));
    var fill = el('span', 'ar-bar-fill');
    fill.style.setProperty('--pct', (value || 0) + '%');
    track.appendChild(fill);
    bar.appendChild(track);
    return bar;
  }

  /* One native disclosure (keyboard and screen-reader support come from the browser). */
  function disclosure(badgeText, badgeKind, title, meta, body) {
    var d = el('details', 'ar-acc');
    var s = el('summary');
    var badge = el('span', 'ar-badge', badgeText);
    badge.setAttribute('data-kind', badgeKind);
    s.appendChild(badge);
    s.appendChild(el('span', 'ar-acc-title', title));
    if (meta) s.appendChild(el('span', 'ar-acc-meta', meta));
    var chev = el('span', 'ar-chev');
    chev.setAttribute('aria-hidden', 'true');
    s.appendChild(chev);
    d.appendChild(s);
    var b = el('div', 'ar-acc-body');
    b.appendChild(body);
    d.appendChild(b);
    return d;
  }

  function cell(col, row, child) {
    var c = el('div', 'ar-cell ar-' + col + ' ar-' + row);
    if (child) c.appendChild(child);
    return c;
  }

  function sectionHead(id, name, desc) {
    var h = el('div', 'ar-head');
    var t = el('h3', 'ar-name', name);
    t.id = id;
    h.appendChild(t);
    h.appendChild(el('p', 'ar-desc', desc));
    return h;
  }

  /*
   * Plain-language sentence for the summary's "first to fix", built from a check's id
   * and the scanner's short detail (e.g. "5 characters — aim for 20-65"). The detail
   * strings are written for the report table; a shopper-facing sentence needs to say
   * what the thing is and what good looks like.
   */
  function firstNum(text) {
    var m = /(\d+)/.exec(text || '');
    return m ? Number(m[1]) : null;
  }
  function plainFix(check) {
    var d = check.detail || '';
    var n = firstNum(d);
    switch (check.id) {
      case 'title':
        if (n && n > 65) return 'Your page title, the clickable headline in search results (not the site name shown above it), is ' +
          plural(n, 'character', 'characters') + ' long, so search results cut it off. Aim for 20 to 65.';
        return n ? 'Your page title, the clickable headline in search results (not the site name shown above it), is only ' +
          plural(n, 'character', 'characters') + ' long. Aim for 20 to 65.'
          : 'Your page has no title, the clickable headline in search results (not the site name shown above it).';
      case 'description':
        if (n && n > 165) return 'Your meta description, the summary shown under your headline in search results, is ' +
          plural(n, 'character', 'characters') + ' long, so search results cut it off. Aim for 70 to 165.';
        return n ? 'Your meta description, the summary shown under your headline in search results, is only ' +
          plural(n, 'character', 'characters') + ' long. Aim for 70 to 165.'
          : 'Your page has no meta description, the summary shown under your headline in search results.';
      case 'h1':
        // Read the count from the start only: "No H1 on the page" contains the 1 in "H1".
        n = /^(\d+) H1/.test(d) ? Number(/^(\d+)/.exec(d)[1]) : null;
        return n ? 'Your page has ' + n + ' main headings (H1). It should have exactly one.'
          : 'Your page has no main heading (H1).';
      case 'headings':
        return 'Your heading levels skip a step, which makes the page harder for search engines and screen readers to follow.';
      case 'imageAlt': {
        var m = /(\d+) of (\d+)/.exec(d);
        return m ? m[1] + ' of ' + m[2] + ' images have no text description (alt text) for search engines and screen readers.'
          : 'Images have no text description (alt text) for search engines and screen readers.';
      }
      case 'canonical':
        return 'Your page does not tell search engines which address is its main one (a canonical link).';
      case 'lang':
        return 'Your page does not declare what language it is in.';
      case 'viewport':
        return 'Your page is not set up to fit phone screens.';
      case 'structured':
        return 'Your page has no structured data, the code that describes your products to search engines.';
      case 'openGraph':
        return 'Your page is missing sharing tags (Open Graph), which set the preview when someone shares a link.';
      case 'https':
        return 'Your page loads over plain HTTP, not a secure HTTPS connection.';
      case 'indexable':
        return 'Your page is marked noindex, so search engines leave it out.';
      case 'linkText':
        return n ? plural(n, 'link uses', 'links use') + ' vague text like "click here" that does not say where it goes.'
          : 'Some links use vague text like "click here" that does not say where it goes.';
      case 'favicon':
        return 'Your page has no favicon, the small icon shown in browser tabs.';
      /* AI agent readiness checks (server/lib/agent.js) */
      case 'buttons':
        return 'Some buttons have no name, so AI assistants and screen readers cannot tell what they do.';
      case 'links':
        return 'Some links do not say where they go, so AI assistants and screen readers cannot follow them with confidence.';
      case 'forms':
        return 'Some form fields have no label, so AI assistants and screen readers cannot tell what to enter.';
      case 'structure':
        return 'Your page lacks a clear main region and heading structure for AI assistants to navigate.';
      case 'crawlableLinks':
        return 'Some links have no real address, so search and AI crawlers cannot follow them.';
      case 'crawlersAllowed':
        return (d || 'Search or AI crawlers are blocked') + ', so they cannot read your store.';
      case 'summary':
        return 'Your page is missing a title or summary that AI assistants use to describe it.';
      case 'language':
        return 'Your page does not declare what language it is in.';
      default:
        return check.label + (d ? ': ' + d.charAt(0).toLowerCase() + d.slice(1) : '') + '.';
    }
  }

  function renderResult(data) {
    if (results) results.innerHTML = '';

    var scores = data.scores || {};
    var a11y = data.accessibility || {};
    var seo = data.seo || {};
    var agent = data.agent && data.agent.total ? data.agent : null;
    var host = hostOf(data.origin);
    var issues = a11y.totalIssues || 0;
    var list = a11y.issues || [];

    var seoChecks = seo.checks || [];
    var seoWork = seoChecks.filter(function (c) { return c.status !== 'pass'; });
    var agentWork = agent ? agent.checks.filter(function (c) { return !c.pass; }) : [];
    var rankWork = seoWork.length + agentWork.length;
    var overlays = data.profile && data.profile.overlays ? data.profile.overlays : [];
    var overlayName = overlays.join(' and ');
    var rankTotal = seoChecks.length + (agent ? agent.checks.length : 0);

    /* Title: the store */
    var headline = document.getElementById('scan-result-title');
    if (headline) headline.textContent = host;

    /* Summary paragraph */
    var summary = document.getElementById('scan-summary');
    if (summary) {
      summary.textContent = '';
      var add = function (text, bold) {
        summary.appendChild(bold ? el('strong', null, text) : document.createTextNode(text));
      };
      if (issues) {
        add('We found ');
        add(plural(issues, 'accessibility issue', 'accessibility issues'), true);
        add(' on ' + host + '. ');
        if (list[0]) {
          add('The most serious: ');
          add(list[0].help.replace(/\.$/, ''), true);
          add(' (' + plural(list[0].nodes, 'element', 'elements') + '). ');
        }
        if (overlays.length) {
          add('Your ' + overlayName + ' overlay does not fix these.', true);
          add(' ');
        }
      } else {
        add('Automated testing found no WCAG failures on ' + host + '. ');
      }
      if (rankWork) {
        add('Your ranking needs work on ');
        var parts = [];
        if (seoWork.length) parts.push(plural(seoWork.length, 'SEO check', 'SEO checks'));
        if (agentWork.length) parts.push(plural(agentWork.length, 'AI agent check', 'AI agent checks'));
        parts.forEach(function (p, i) {
          if (i) add(' and ');
          add(p, true);
        });
        add('. ');
        var lead = seoWork[0] || agentWork[0];
        if (lead) {
          add('First to fix: ', true);
          add(plainFix(lead));
        }
      } else {
        add('Every SEO' + (agent ? ' and AI agent' : '') + ' check passed.');
      }
      // No widows: tie the last two words together so a lone word never ends the paragraph.
      var tail = summary.lastChild;
      if (tail && tail.nodeType === 3) tail.nodeValue = tail.nodeValue.replace(/ (\S+)\s*$/, '\u00a0$1');
    }

    /* Overlay notice: the free check names the widget, because a plaintiff's firm will too. */
    var ovSlot = document.getElementById('scan-overlay');
    if (ovSlot) {
      ovSlot.textContent = '';
      ovSlot.hidden = !overlays.length;
      if (overlays.length) {
        var ovHead = el('div', 'ov-head');
        var ovBadge = el('span', 'ar-badge', 'Overlay detected');
        ovBadge.setAttribute('data-kind', 'critical');
        ovHead.appendChild(ovBadge);
        var ovTitle = el('h3', null, overlayName + ' accessibility overlay');
        ovTitle.id = 'scan-overlay-title';
        ovHead.appendChild(ovTitle);
        ovSlot.appendChild(ovHead);
        var ovText = el('p');
        ovText.appendChild(document.createTextNode('An overlay is a widget that loads on top of your store. It does not change the code underneath, and that code is what automated scanners read, including the free scans predatory ADA lawyers use to pick targets. '));
        ovText.appendChild(el('strong', null, issues
          ? 'Every issue on this page is still there for them to find.'
          : 'It does not protect you from what those scans or a human tester find.'));
        ovSlot.appendChild(ovText);
      }
    }

    var grid = el('div', 'ar-grid');

    /* ---- Access ---- */
    grid.appendChild(cell('c1', 'r1', sectionHead('ar-access-title', 'Access', 'Can every shopper use your store?')));

    var aHead = el('p', 'ar-headline');
    if (issues) {
      aHead.appendChild(el('span', 'ar-bad', plural(issues, 'accessibility issue', 'accessibility issues')));
      aHead.appendChild(document.createTextNode(' found'));
    } else {
      aHead.textContent = 'No automated WCAG failures found';
    }
    grid.appendChild(cell('c1', 'r2', aHead));

    var aBars = el('div', 'ar-bars');
    // The caption describes OUR scan (axe-core, every page scanned, the element count), so it sits
    // directly under the Accessrank bar. Under the Lighthouse bar it read as Lighthouse's numbers.
    var arBar = scoreBar('Accessrank score', plural(data.pagesScanned || 1, 'page', 'pages'),
      scores.overall, toneOf(scores.overall));
    arBar.appendChild(el('p', 'ar-meta ar-bar-caption',
      'Automated accessibility score · best case. WCAG 2.2 A/AA with axe-core ' + (data.axeVersion || '') +
      (a11y.violationsTotal ? ' · ' + plural(a11y.violationsTotal, 'element', 'elements') + ' affected' : '')));
    aBars.appendChild(arBar);
    grid.appendChild(cell('c1', 'r3', aBars));
    // Second score on its own row (r4), so Lighthouse lines up with AI agent readiness
    // however many lines the caption above it wraps to.
    var lh = data.lighthouse && data.lighthouse.accessibility != null ? data.lighthouse.accessibility : null;
    if (lh != null) {
      var lhBars = el('div', 'ar-bars');
      lhBars.appendChild(scoreBar('Lighthouse score', '1 page', lh, lighthouseTone(lh)));
      grid.appendChild(cell('c1', 'r4', lhBars));
    }

    var aFind = el('div', 'ar-findings');
    if (list.length) {
      aFind.appendChild(el('p', 'ar-grp', a11y.criteriaFailed + ' of ' + a11y.criteriaEvaluated + ' checks not met'));
      ['critical', 'serious', 'moderate', 'minor'].forEach(function (impact) {
        var group = list.filter(function (i) { return i.impact === impact; });
        if (!group.length) return;
        var ul = el('ul', 'ar-rows');
        var elements = 0;
        group.forEach(function (issue) {
          elements += issue.nodes || 0;
          var li = el('li', 'ar-row');
          li.appendChild(el('span', 'ar-row-label', issue.help));
          var detail = plural(issue.nodes, 'element', 'elements');
          if (issue.criteria && issue.criteria.length) {
            detail += ' · WCAG ' + issue.criteria.join(', ') + ' (' + issue.level + ')';
          }
          li.appendChild(el('span', 'ar-row-meta', detail));
          ul.appendChild(li);
        });
        aFind.appendChild(disclosure(IMPACT_LABEL[impact], impact,
          plural(group.length, 'finding', 'findings'), plural(elements, 'element', 'elements'), ul));
      });
      if (issues > list.length) {
        aFind.appendChild(el('p', 'ar-more', '+ ' + (issues - list.length) + ' more issues in the full report'));
      }
    } else {
      aFind.appendChild(el('p', 'ar-clean',
        'Automated testing found nothing to fix. The full report covers what automated testing cannot see.'));
    }
    grid.appendChild(cell('c1', 'r5', aFind));

    /* ---- Rank ---- */
    grid.appendChild(cell('c2', 'r1', sectionHead('ar-rank-title', 'Rank', 'Can search and AI assistants find and recommend it?')));

    var rHead = el('p', 'ar-headline');
    if (rankWork) {
      rHead.appendChild(el('span', 'ar-warn', plural(rankWork, 'check', 'checks')));
      rHead.appendChild(document.createTextNode(' need' + (rankWork === 1 ? 's' : '') + ' work'));
    } else {
      rHead.textContent = 'Every check passed';
    }
    grid.appendChild(cell('c2', 'r2', rHead));

    var rBars = el('div', 'ar-bars');
    var seoScore = seo.score != null ? seo.score : scores.seo;
    var seoBar = scoreBar('SEO', 'on-page', seoScore, toneOf(seoScore));
    seoBar.appendChild(el('p', 'ar-meta ar-bar-caption', 'Our checks and scoring differ from Lighthouse, so scores may differ.'));
    rBars.appendChild(seoBar);
    grid.appendChild(cell('c2', 'r3', rBars));
    if (agent) {
      var agBars = el('div', 'ar-bars');
      agBars.appendChild(scoreBar('AI agent readiness', agent.passed + ' of ' + agent.total + ' checks', agent.score, toneOf(agent.score)));
      grid.appendChild(cell('c2', 'r4', agBars));
    }

    var rFind = el('div', 'ar-findings');
    if (rankTotal) rFind.appendChild(el('p', 'ar-grp', rankWork + ' of ' + rankTotal + ' checks need work'));

    if (seoChecks.length) {
      var seoUl = el('ul', 'ar-rows');
      (seoWork.length ? seoWork : seoChecks).forEach(function (c) {
        var li = el('li', 'ar-row');
        li.appendChild(el('span', 'ar-row-label', c.label));
        if (c.status !== 'pass' && c.detail) li.appendChild(el('span', 'ar-row-meta', c.detail));
        seoUl.appendChild(li);
      });
      rFind.appendChild(disclosure(seoWork.length ? 'Needs work' : 'Pass', seoWork.length ? 'work' : 'pass', 'SEO',
        seoWork.length ? seoWork.length + ' of ' + seoChecks.length + ' checks need work' : 'All ' + seoChecks.length + ' checks passed',
        seoUl));
    }

    if (agent) {
      var agentBody = el('div');
      agentBody.appendChild(el('p', 'ar-intro',
        'Can AI assistants and browsing agents read your store and complete tasks like finding a product or checking out?'));
      var agUl = el('ul', 'ar-checks');
      agent.checks.forEach(function (c) {
        var li = el('li', 'ar-check' + (c.pass ? ' is-pass' : ' is-fail'));
        var t = el('span', 'ar-check-text');
        t.appendChild(el('span', 'ar-row-label', c.label));
        if (!c.pass && c.detail) t.appendChild(el('span', 'ar-row-meta', c.detail));
        li.appendChild(t);
        li.appendChild(el('span', 'ar-check-status', c.pass ? 'Pass' : 'Needs work'));
        agUl.appendChild(li);
      });
      agentBody.appendChild(agUl);
      rFind.appendChild(disclosure(agentWork.length ? 'Needs work' : 'Pass', agentWork.length ? 'work' : 'pass',
        'AI agent readiness', agent.passed + ' of ' + agent.total + ' checks passed', agentBody));
    }
    grid.appendChild(cell('c2', 'r5', rFind));

    results.appendChild(grid);
  }

  /* ----------------------------------------------------------- scan --- */

  function runScan(url) {
    if (state.scanning) return;
    state.scanning = true;
    state.scanId = null;
    state.result = null;
    state.host = hostOf(url);

    button.disabled = true;
    button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = 'Scanning…';
    showError('');
    if (reportCta) reportCta.hidden = true;
    setStatus('', null);
    if (meta) meta.textContent = state.host;

    ['scan-progress-title', 'scan-failed-title'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = state.host;
    });
    resetReportForm();
    setView('scanning');
    var phase = 0;
    renderSteps(phase, false);
    openModal();
    focusViewTitle('scanning');

    var ticker = setInterval(function () {
      phase = Math.min(phase + 1, PHASES.length - 1);
      renderSteps(phase, false);
    }, 2600);

    var payload = { url: url };

    // 45s, not 10: on a slow connection Cloudflare's own check can take that long, and if it wants a
    // click the box appears in this view and the visitor needs time to answer it.
    waitForToken(views.scanning.node, 45000).then(function (token) {
      if (token) payload.turnstileToken = token;
      return window.Accessrank.post('/api/scan', payload);
    }).then(function (data) {
      state.scanId = data.scanId;
      state.result = data;
      renderSteps(PHASES.length - 1, true);
      renderResult(data);
      setView('result');
      if (modal && !modal.hidden) {
        if (live) live.textContent = '';
        focusViewTitle('result');
      } else {
        // The visitor closed the dialog mid-scan: never pop it back open on them.
        setStatus('Your results for ' + state.host + ' are ready.', 'done');
        if (reportCta) reportCta.hidden = false;
      }
    }).catch(function (err) {
      var msg = document.getElementById('scan-failed-msg');
      if (msg) msg.textContent = err.message;
      setView('failed');
      setStatus('', null);
      showError(err.message);
      if (input) input.setAttribute('aria-invalid', 'true');
      if (modal && !modal.hidden) focusViewTitle('failed');
      else if (input) input.focus();
    }).finally(function () {
      clearInterval(ticker);
      state.scanning = false;
      button.disabled = false;
      button.textContent = button.dataset.label || 'Scan';
      // Success or failure, the server has now spent this token (or rejected
      // it). Without this, the SECOND scan re-sends the used token and dies
      // with "That verification check expired" every time.
      resetTurnstileIn(views.scanning.node);
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = (input.value || '').trim();
      input.removeAttribute('aria-invalid');
      if (!url) {
        showError('Enter the address of the store you want to check.');
        input.focus();
        return;
      }
      runScan(url);
    });
  }

  /* -------------------------------------------------- report modal ----- */

  var modalForm = document.getElementById('report-form');
  var modalStatus = document.getElementById('report-status');
  var modalSuccess = document.getElementById('report-success');
  var modalClose = modal ? modal.querySelectorAll('[data-close-modal]') : [];
  var lastFocused = null;

  // `iframe` is here because the Turnstile widget renders one inside the
  // modal, and an iframe is a tab stop. Without it the focus trap did not
  // know the iframe existed, so a keyboard user tabbing through the report
  // dialog escaped into the page behind it — found the first time the tests
  // ran against a build with the captcha actually present.
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])';

  function modalFocusables() {
    return Array.prototype.filter.call(
      modal.querySelectorAll(FOCUSABLE),
      function (node) {
        return node.offsetParent !== null && node.className.indexOf('focus-sentinel') === -1;
      }
    );
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || !modal || modal.hidden) return;
    var items = modalFocusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /**
   * Sentinels close the gap enumeration cannot: Turnstile renders its widget
   * inside a CLOSED shadow root, so no querySelectorAll can see the iframe the
   * visitor tabs into — and one more Tab used to walk straight out of the
   * dialog into the page behind it. Two zero-size tabbable spans at the very
   * edges of the panel catch focus the moment it crosses either boundary and
   * hand it to the far end, whatever unknowable content sits in between.
   */
  function ensureSentinels() {
    var panel = modal.querySelector('.modal-panel') || modal;
    if (panel.querySelector('.focus-sentinel')) return;
    ['start', 'end'].forEach(function (edge) {
      var s = document.createElement('span');
      s.tabIndex = 0;
      s.className = 'focus-sentinel';
      s.addEventListener('focus', function () {
        var items = modalFocusables();
        if (!items.length) return;
        (edge === 'start' ? items[items.length - 1] : items[0]).focus();
      });
      if (edge === 'start') panel.insertBefore(s, panel.firstChild);
      else panel.appendChild(s);
    });

    /**
     * Recovery net for focus DROPPING, not crossing. A broken Turnstile widget
     * (e.g. its key rejects the current hostname) can swallow a Tab entirely:
     * focus falls to <body> mid-panel without ever reaching a sentinel, and no
     * focus event fires for body — so the only reliable hook is noticing,
     * just after a focusout, that the document lost track. When the widget is
     * healthy this never triggers: focus inside its closed shadow root reports
     * the host element, which is inside the modal.
     */
    modal.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!modal || modal.hidden) return;
        var active = document.activeElement;
        if (active && active !== document.body && modal.contains(active)) return;
        var items = modalFocusables();
        if (items.length) items[0].focus();
      }, 0);
    });
  }

  function openModal() {
    if (!modal) return;
    if (modal.hidden) lastFocused = document.activeElement;
    modal.hidden = false;
    ensureSentinels();
    document.body.classList.add('modal-open');

    var loadedAt = modalForm.querySelector('[name="formLoadedAt"]');
    if (loadedAt && !loadedAt.value) loadedAt.value = String(Date.now());

    // The form's Turnstile rendered while the dialog was hidden, and a hidden
    // widget never solves. Kick it now that it is visible: it solves invisibly
    // while the scan runs and the visitor reads, so the FIRST submit — the lead
    // capture — carries a token instead of failing with "complete the check".
    // Same for the scan's widget in the progress view.
    if (window.turnstile) {
      Array.prototype.forEach.call(modal.querySelectorAll('.cf-turnstile'), function (widget) {
        try {
          if (!window.turnstile.getResponse(widget)) window.turnstile.reset(widget);
        } catch (e) { /* not rendered yet — implicit render will pick it up */ }
      });
    }

    document.addEventListener('keydown', onModalKeydown);
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onModalKeydown);
    if (state.scanning) {
      setStatus('Still checking ' + state.host + '… your results will be ready here.', 'busy');
    } else if (state.scanId) {
      setStatus('', null);
      if (reportCta) reportCta.hidden = false;
    }
    var back = lastFocused && document.contains(lastFocused) && !lastFocused.disabled ? lastFocused : input;
    if (back && back.focus) back.focus();
  }

  /** A new scan starts with a clean form (a sent report must not carry over). */
  function resetReportForm() {
    if (!modalForm) return;
    modalForm.hidden = false;
    if (modalSuccess) modalSuccess.hidden = true;
    clearFieldErrors(modalForm);
    if (modalStatus) { modalStatus.textContent = ''; modalStatus.className = 'form-status'; }
    var loadedAt = modalForm.querySelector('[name="formLoadedAt"]');
    if (loadedAt) loadedAt.value = String(Date.now());
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    trapFocus(e);
  }

  if (reportCta) {
    reportCta.addEventListener('click', function () {
      if (!state.scanId) return;
      setView('result');
      openModal();
      focusViewTitle('result');
    });
  }

  var retry = document.getElementById('scan-retry');
  if (retry) {
    retry.addEventListener('click', function () {
      lastFocused = input;
      closeModal();
      if (input) input.select();
    });
  }

  Array.prototype.forEach.call(modalClose, function (node) {
    node.addEventListener('click', closeModal);
  });

  // Clicking the backdrop closes, but only the backdrop itself.
  if (modal) {
    modal.addEventListener('mousedown', function (e) {
      if (e.target === modal) closeModal();
    });
  }

  /* Clear any per-field error message and its aria wiring. */
  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (node) { node.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (node) {
      node.removeAttribute('aria-invalid');
      var describedBy = (node.getAttribute('aria-describedby') || '')
        .split(' ').filter(function (id) { return id && !/-error$/.test(id); }).join(' ');
      if (describedBy) node.setAttribute('aria-describedby', describedBy);
      else node.removeAttribute('aria-describedby');
    });
  }

  /**
   * Attach an error message directly beneath its field and wire it to the input
   * with aria-describedby, so a screen reader announces the reason along with
   * the field rather than leaving it in a status line elsewhere in the dialog.
   */
  function setFieldError(form, name, message) {
    var field = form.querySelector('[name="' + name + '"]');
    if (!field) return null;

    var id = (field.id || name) + '-error';
    var error = document.createElement('p');
    error.className = 'field-error';
    error.id = id;
    error.textContent = message;

    field.setAttribute('aria-invalid', 'true');
    var describedBy = (field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (describedBy.indexOf(id) === -1) describedBy.push(id);
    field.setAttribute('aria-describedby', describedBy.join(' '));

    var container = field.closest('.field') || field.parentNode;
    container.appendChild(error);
    return field;
  }

  /**
   * Validate everything at once and report every problem together. Submitting
   * to find one error, fixing it, then submitting to find the next is a
   * needlessly hostile loop — especially in a modal.
   */
  function validateReportForm(form) {
    var problems = [];
    var name = form.querySelector('[name="name"]');
    var email = form.querySelector('[name="email"]');
    var consent = form.querySelector('[name="consent"]');

    if (!name.value.trim() || name.value.trim().length < 2) {
      problems.push({ field: 'name', message: 'Enter your name.' });
    }
    // Deliberately permissive: the server is the authority. This only catches
    // the obvious cases so the visitor is not told "invalid" for a valid address.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) {
      problems.push({ field: 'email', message: 'Enter a valid email address.' });
    }
    if (!consent.checked) {
      problems.push({ field: 'consent', message: 'Please agree to the privacy policy so we can send your report.' });
    }
    return problems;
  }

  if (modalForm) {
    modalForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (modalForm.dataset.busy === '1') return;
      if (!state.scanId) {
        modalStatus.textContent = 'That scan expired. Close this and run the check again.';
        modalStatus.className = 'form-status is-error';
        return;
      }

      var submit = modalForm.querySelector('[type="submit"]');
      modalStatus.textContent = '';
      modalStatus.className = 'form-status';
      clearFieldErrors(modalForm);

      // Report every problem at once, each beside its own field.
      var problems = validateReportForm(modalForm);
      if (problems.length) {
        var firstField = null;
        problems.forEach(function (problem) {
          var field = setFieldError(modalForm, problem.field, problem.message);
          if (!firstField) firstField = field;
        });
        modalStatus.textContent = problems.length === 1
          ? 'Please correct the highlighted field.'
          : 'Please correct the ' + problems.length + ' highlighted fields.';
        modalStatus.className = 'form-status is-error';
        if (firstField) firstField.focus();
        return;
      }

      modalForm.dataset.busy = '1';
      submit.disabled = true;
      submit.dataset.label = submit.dataset.label || submit.textContent;
      submit.textContent = 'Building your report…';
      // Building the PDF and emailing it usually takes a few seconds, but can take longer when the
      // server is busy. Nothing on this side times out (the request waits for the server), so tell
      // the visitor it is still working rather than let a long wait look like a hang.
      var slowNote = setTimeout(function () {
        modalStatus.textContent = 'Still building your PDF report. This can take up to a minute, so keep this open.';
        modalStatus.className = 'form-status';
      }, 8000);

      var payload = { scanId: state.scanId };
      new FormData(modalForm).forEach(function (value, key) { payload[key] = value; });
      payload.consent = modalForm.querySelector('[name="consent"]').checked;
      var optIn = modalForm.querySelector('[name="marketingOptIn"]');
      payload.marketingOptIn = optIn ? optIn.checked : false;
      waitForToken(modalForm, 10000).then(function (token) {
        if (token) payload.turnstileToken = token;
        return window.Accessrank.post('/api/report', payload);
      }).then(function (data) {
        modalForm.hidden = true;
        modalSuccess.hidden = false;
        var target = document.getElementById('report-success-email');
        if (target) target.textContent = data.deliveredTo || 'your inbox';
        modalSuccess.setAttribute('tabindex', '-1');
        modalSuccess.focus();
      }).catch(function (err) {
        // The server is the authority — surface its message on the field it names.
        if (err.field && modalForm.querySelector('[name="' + err.field + '"]')) {
          var field = setFieldError(modalForm, err.field, err.message);
          modalStatus.textContent = 'Please correct the highlighted field.';
          modalStatus.className = 'form-status is-error';
          if (field) field.focus();
        } else {
          modalStatus.textContent = err.message;
          modalStatus.className = 'form-status is-error';
          modalStatus.setAttribute('tabindex', '-1');
          modalStatus.focus();
        }
        resetTurnstileIn(modal);
      }).finally(function () {
        clearTimeout(slowNote);
        if (modalStatus.className === 'form-status') modalStatus.textContent = '';
        modalForm.dataset.busy = '0';
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Email me the report';
      });
    });
  }

  /* Deep link: /#audit focuses the field so the nav CTA lands somewhere useful. */
  if (location.hash === '#audit' && input) {
    input.focus({ preventScroll: true });
  }
}());


/* ---- overlays.js ---- */
/*
 * overlays.js: behaviour for /overlays only. Builds the kinetic headline (per-letter reveal)
 * and sends the hero store address to the free-check widget further down the page.
 * Every selector is page-specific, so it is a no-op on every other page.
 */
(function () {
  'use strict';

  var heading = document.getElementById('ov-headline');
  if (heading) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lines = Array.prototype.slice.call(heading.querySelectorAll('[data-ov-text]'));
    var STAGGER = 18, OVERLAP = 0.55, START = 300;
    var offset = 0;
    lines.forEach(function (line) {
      var text = line.getAttribute('data-ov-text') || '';
      var n = 0;
      text.split(' ').forEach(function (word) {
        var w = document.createElement('span');
        w.className = 'kw';
        word.split('').forEach(function (ch) {
          var c = document.createElement('span');
          c.className = 'kc';
          c.textContent = ch;
          c.style.animationDelay = Math.round(START + offset + n * STAGGER) + 'ms';
          n += 1;
          w.appendChild(c);
        });
        line.appendChild(w);
      });
      offset += Math.round(text.replace(/ /g, '').length * STAGGER * OVERLAP);
      if (reduce) line.textContent = text;
    });
  }

  var form = document.querySelector('[data-ov-form]');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var mine = form.querySelector('input');
      var theirs = document.getElementById('audit-url');
      var submit = document.getElementById('audit-submit');
      var card = document.getElementById('audit-card');
      if (!theirs || !submit) { window.location.href = '/home#audit'; return; }
      theirs.value = mine ? mine.value.trim() : '';
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (theirs.value) submit.click(); else theirs.focus();
    });
  }
})();


/* ---- beta-prompt.js ---- */
/*
 * beta-prompt.js: a small, dismissible "apply for the beta" prompt on the home page only.
 * Shown once per visitor, after they have spent a while on the page or scrolled well down it,
 * never on arrival. Not modal: it takes no focus, covers no content, and Escape closes it.
 */
(function () {
  'use strict';
  if (location.pathname !== '/') return;
  var KEY = 'accessrank-beta-prompt';
  try { if (window.localStorage.getItem(KEY)) return; } catch (e) { /* storage blocked: still show once per page view */ }

  var shown = false;
  function remember() { try { window.localStorage.setItem(KEY, '1'); } catch (e) {} }

  var waiting = false;
  function consentOpen() { var c = document.getElementById('analytics-choice'); return !!(c && !c.hidden); }

  function show() {
    if (shown || document.getElementById('scan-modal') && !document.getElementById('scan-modal').hidden) return;
    // Never stack on top of the analytics choice: wait until the visitor has answered it.
    if (consentOpen()) {
      if (!waiting) {
        waiting = true;
        var poll = window.setInterval(function () {
          if (!consentOpen()) { window.clearInterval(poll); waiting = false; show(); }
        }, 1000);
      }
      return;
    }
    shown = true;
    var box = document.createElement('div');
    box.className = 'beta-prompt';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Beta applications');

    var title = document.createElement('p');
    title.className = 'beta-prompt-title';
    title.textContent = 'Accessrank is in private beta';
    var text = document.createElement('p');
    text.className = 'beta-prompt-text';
    text.textContent = 'We are taking on a small group of stores before our Q1 2027 launch. Apply to be a beta client.';
    var cta = document.createElement('a');
    cta.className = 'beta-prompt-cta';
    cta.href = '/beta';
    cta.textContent = 'Apply for the beta';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'beta-prompt-close';
    close.setAttribute('aria-label', 'Dismiss beta prompt');
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19"/></svg>';

    function dismiss() {
      remember();
      document.documentElement.style.removeProperty('--float-space');
      document.removeEventListener('keydown', onKey);
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    close.addEventListener('click', dismiss);
    cta.addEventListener('click', remember);
    document.addEventListener('keydown', onKey);

    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(cta);
    document.body.appendChild(box);
    // Lets the footer reserve room for the prompt so nothing at the end of the page sits underneath it.
    document.documentElement.style.setProperty('--float-space', (box.offsetHeight + 24) + 'px');
  }

  // The timed path: on a phone, only once the visitor has scrolled, so it never lands on the first screen.
  function showWhenSettled() {
    if (window.innerWidth > 600 || window.scrollY > 0) show();
    else window.setTimeout(showWhenSettled, 3000);
  }
  window.setTimeout(showWhenSettled, 20000);
  window.addEventListener('scroll', function onScroll() {
    var h = document.documentElement;
    if (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) > 0.5) {
      window.removeEventListener('scroll', onScroll);
      show();
    }
  }, { passive: true });
})();
