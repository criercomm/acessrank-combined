/*
 * Accessrank — hero audit widget and report lead capture.
 *
 * Replaces the original simulated demo, which ran a fake scan of "example.shop"
 * 800ms after page load with hardcoded results for every visitor. This calls the
 * real /api/scan endpoint, renders real axe-core findings, and only runs when a
 * person asks it to.
 *
 * The scan runs in a dialog (#scan-modal) so the homepage never reflows under
 * the visitor: progress first, then the results on the left and the report form
 * on the right, or the reason the scan could not run. The card itself only keeps
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

  /**
   * Resolve with the Turnstile token in `container`, waiting for it if needed.
   *
   * The widgets are interaction-only (invisible), so nothing on screen tells the
   * visitor the check is still running — a quick click on "Check my store" used
   * to read an empty token and get "Please complete the verification check".
   * Resolves at once when Turnstile is off (no data-turnstile-key); after `ms`
   * it resolves with whatever is there and lets the server give its message.
   */
  function waitForToken(container, ms) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        var field = container && container.querySelector('[name="cf-turnstile-response"]');
        var value = field ? field.value : '';
        if (value || !document.body.getAttribute('data-turnstile-key') || Date.now() - start > ms) return resolve(value);
        setTimeout(poll, 150);
      })();
    });
  }

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
    'Running axe-core against WCAG 2.2 AA',
    'Checking colour contrast and focus order',
    'Reading on-page SEO signals',
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

  function renderResult(data) {
    if (results) results.innerHTML = '';

    var scores = data.scores || {};
    var a11y = data.accessibility || {};
    var host = hostOf(data.origin);

    /* Headline — the sentence the visitor reads first */
    var headline = document.getElementById('scan-result-title');
    if (headline) {
      headline.textContent = '';
      var issues = a11y.totalIssues || 0;
      if (issues) {
        headline.appendChild(el('span', 'scan-headline-num', issues + (issues === 1 ? ' accessibility issue' : ' accessibility issues')));
        headline.appendChild(document.createTextNode(' found on ' + host));
      } else {
        headline.appendChild(document.createTextNode('No automated WCAG failures found on ' + host));
      }
    }

    /* Headline score */
    var head = el('div', 'result-head');
    var ring = el('div', 'score-ring');
    ring.setAttribute('data-tone', (scores.band && scores.band.tone) || 'neutral');
    ring.appendChild(el('span', 'score-value', scores.overall == null ? '—' : String(scores.overall)));
    ring.appendChild(el('span', 'score-outof', '/100'));
    head.appendChild(ring);

    var headText = el('div', 'result-head-text');
    headText.appendChild(el('p', 'result-band', (scores.band && scores.band.label) || 'Scored'));
    headText.appendChild(el('p', 'result-host', host));
    headText.appendChild(el(
      'p',
      'result-sub',
      data.pagesScanned + (data.pagesScanned === 1 ? ' page' : ' pages') +
      ' checked against WCAG 2.2 AA with axe-core ' + (data.axeVersion || '') +
      (a11y.violationsTotal ? ' · ' + a11y.violationsTotal + (a11y.violationsTotal === 1 ? ' element' : ' elements') + ' affected' : '')
    ));
    head.appendChild(headText);
    results.appendChild(head);

    /* Two sub-scores */
    var subs = el('div', 'score-split');
    [
      { label: 'Accessibility', value: scores.accessibility },
      { label: 'SEO', value: scores.seo }
    ].forEach(function (item) {
      var box = el('div', 'score-split-item');
      box.appendChild(el('span', 'split-label', item.label));
      box.appendChild(el('span', 'split-value', item.value == null ? '—' : String(item.value)));
      var track = el('div', 'split-track');
      var fill = el('span', 'split-fill');
      fill.style.setProperty('--pct', (item.value || 0) + '%');
      track.appendChild(fill);
      box.appendChild(track);
      subs.appendChild(box);
    });
    results.appendChild(subs);

    /* Failed success criteria — the thing a demand letter cites */
    if (a11y.failedCriteria && a11y.failedCriteria.length) {
      var crit = el('div', 'result-criteria');
      crit.appendChild(el('p', 'result-criteria-label',
        a11y.criteriaFailed + ' of ' + a11y.criteriaEvaluated + ' checks not met'));
      var list = el('ul', 'criteria-chips');
      a11y.failedCriteria.slice(0, 10).forEach(function (id) {
        list.appendChild(el('li', 'criteria-chip', 'WCAG ' + id));
      });
      crit.appendChild(list);
      results.appendChild(crit);
    }

    /* Top issues */
    if (a11y.issues && a11y.issues.length) {
      var issuesWrap = el('ul', 'audit-rows');
      a11y.issues.forEach(function (issue, index) {
        var row = el('li', 'audit-row');
        var badge = el('span', 'impact-badge', IMPACT_LABEL[issue.impact] || issue.impact);
        badge.setAttribute('data-impact', issue.impact);
        row.appendChild(badge);

        var body = el('span', 'row-body');
        body.appendChild(el('span', 'row-label', issue.help));
        var detail = issue.nodes + (issue.nodes === 1 ? ' element' : ' elements');
        if (issue.criteria && issue.criteria.length) {
          detail += ' · WCAG ' + issue.criteria.join(', ') + ' (' + issue.level + ')';
        }
        body.appendChild(el('span', 'row-meta', detail));
        row.appendChild(body);

        issuesWrap.appendChild(row);
        // Stagger only as decoration; content is already in the DOM for AT.
        if (!window.Accessrank.reducedMotion()) {
          row.style.setProperty('--i', String(index));
          row.classList.add('will-reveal');
          requestAnimationFrame(function () { row.classList.add('visible'); });
        }
      });
      results.appendChild(issuesWrap);

      if (a11y.totalIssues > a11y.issues.length) {
        results.appendChild(el(
          'p', 'result-more',
          '+ ' + (a11y.totalIssues - a11y.issues.length) + ' more issues in the full report'
        ));
      }
    } else {
      results.appendChild(el('p', 'result-clean',
        'Automated testing found nothing to fix. The full report covers the SEO checks and what automated testing cannot see.'));
    }

    var site = document.getElementById('report-site');
    if (site) site.textContent = host;
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

    waitForToken(card, 10000).then(function (token) {
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
      resetTurnstileIn(card);
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
    if (window.turnstile) {
      var widget = modal.querySelector('#report-form .cf-turnstile');
      try {
        if (widget && !window.turnstile.getResponse(widget)) window.turnstile.reset(widget);
      } catch (e) { /* not rendered yet — implicit render will pick it up */ }
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
    var phone = form.querySelector('[name="phone"]');
    var consent = form.querySelector('[name="consent"]');

    if (!name.value.trim() || name.value.trim().length < 2) {
      problems.push({ field: 'name', message: 'Enter your name.' });
    }
    // Deliberately permissive: the server is the authority. This only catches
    // the obvious cases so the visitor is not told "invalid" for a valid address.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) {
      problems.push({ field: 'email', message: 'Enter a valid email address.' });
    }
    if (phone.value.replace(/[^\d]/g, '').length < 7) {
      problems.push({ field: 'phone', message: 'Enter a phone number we can reach you on.' });
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
      submit.textContent = 'Sending…';

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
