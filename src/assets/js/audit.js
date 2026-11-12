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
