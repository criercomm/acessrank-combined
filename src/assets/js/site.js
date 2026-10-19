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
    var link = e.target.closest('a[href^="#"], a[href^="/#"]');
    if (!link) return;

    var hash = link.getAttribute('href').replace(/^\//, '');
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
      // through the stages on a timer, since the scan itself is a single request of 15–30 seconds.
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
        return window.Accessrank.post('/api/scan', { url: payload.website, turnstileToken: token || undefined })
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
        return window.Accessrank.post('/api/lead', payload);
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
            if (overlayLine) { overlayLine.textContent = placement.overlayNote || ''; overlayLine.hidden = !placement.overlayNote; }
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
