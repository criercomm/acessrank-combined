/* Accessrank — client portal: sign-in, a client's files, and the team admin page.
 *
 * Loaded only on pages marked `portal` in site.json (see shell.html), after
 * site.js. No framework, no dependencies.
 *
 * Every value that came from a person (client names, file names, emails) is
 * written with textContent, never as markup — so nothing a client or a teammate
 * types can become script on this page.
 */
(function () {
  'use strict';

  var A = window.Accessrank = window.Accessrank || {};

  /* ------------------------------------------------------------ helpers --- */

  /** The one place a page change happens. */
  function go(url) {
    if (typeof A.navigate === 'function') A.navigate(url);
    else window.location.assign(url);
  }

  /**
   * Call the portal API. Resolves with the response body; rejects with an Error
   * carrying `code`, `field` and `status`. `file` sends raw bytes instead of JSON.
   */
  function api(method, path, body, file) {
    var options = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (file) {
      options.headers['Content-Type'] = 'application/octet-stream';
      options.body = file;
    } else if (body !== undefined && body !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.ok && data.ok) return data;
        var error = new Error(data.error || 'Something went wrong. Please try again.');
        error.code = data.code;
        error.field = data.field;
        error.status = response.status;
        throw error;
      });
    }, function () {
      throw new Error('We couldn\u2019t reach the server. Check your connection and try again.');
    }).catch(function (error) {
      // The session ended while the page was open: back to sign-in, not a dead screen.
      if (error.code === 'signed_out') go('/client-login');
      throw error;
    });
  }

  /** Build an element. `props.text` sets textContent; everything else is an attribute. */
  function h(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      var value = props[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function setStatus(node, message, kind) {
    if (!node) return;
    node.textContent = message || '';
    node.classList.remove('is-error', 'is-success');
    if (message && kind) node.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  var dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  function formatDate(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '' : dateFormat.format(date);
  }

  var dateTimeFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  function formatDateTime(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
  }

  function fileKind(name) {
    var match = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function plural(count, word) { return count + ' ' + word + (count === 1 ? '' : 's'); }

  /**
   * Wire a form to an async handler: one submission at a time, a busy label on
   * the button, the server's message in the form's status line, and focus moved
   * to the field the server says is wrong.
   */
  function bindForm(form, busyLabel, handler) {
    if (!form) return;
    var status = form.querySelector('[data-form-status]');
    var submit = form.querySelector('[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1';

      var label = submit ? submit.textContent : '';
      if (submit) { submit.disabled = true; submit.textContent = busyLabel; }
      setStatus(status, '');
      form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });

      var values = {};
      new FormData(form).forEach(function (value, key) { values[key] = value; });

      Promise.resolve().then(function () { return handler(values); }).then(function (message) {
        if (typeof message === 'string') setStatus(status, message, 'success');
      }).catch(function (error) {
        setStatus(status, error.message, 'error');
        var field = error.field ? form.querySelector('[name="' + error.field + '"]') : null;
        if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
      }).then(function () {
        form.dataset.busy = '0';
        if (submit) { submit.disabled = false; submit.textContent = label; }
      });
    });
  }

  /**
   * Two-step destructive button: the first press arms it and offers Cancel, the
   * second runs `action`. Done in the page rather than with window.confirm so it
   * works the same for keyboard, screen reader and touch, and cannot be
   * suppressed by a browser's "don't show dialogs" setting.
   */
  function confirmable(button, confirmLabel, action) {
    var label = button.textContent;
    var baseClass = button.className;
    var cancel = null;
    var armed = false;

    function disarm() {
      if (!armed) return;
      armed = false;
      button.textContent = label;
      button.className = baseClass;
      if (cancel) { cancel.remove(); cancel = null; }
    }

    button.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        button.textContent = confirmLabel;
        button.className = 'btn-small btn-small--confirm';
        cancel = h('button', { type: 'button', class: 'btn-small', text: 'Cancel' });
        cancel.addEventListener('click', function () { disarm(); button.focus(); });
        button.insertAdjacentElement('afterend', cancel);
        return;
      }
      button.disabled = true;
      if (cancel) cancel.disabled = true;
      Promise.resolve().then(action).catch(function () { /* the action reports its own error */ }).then(function () {
        button.disabled = false;
        disarm();
      });
    });

    button.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && armed) { e.stopPropagation(); disarm(); }
    });
  }

  /** "3 approved, 1 changes requested" — or a plain "Not reviewed yet". */
  function progressText(progress) {
    if (!progress) return 'Not reviewed yet';
    var parts = [];
    if (progress.approved) parts.push(progress.approved + ' approved');
    if (progress.changes) parts.push(progress.changes + ' with changes requested');
    if (progress.comments) parts.push(plural(progress.comments, 'comment'));
    return parts.length ? parts.join(', ') : 'Not reviewed yet';
  }

  function reportRow(report, extraActions, opts) {
    opts = opts || {};
    var closed = report.status === 'closed';
    var open = h('a', {
      class: closed || opts.openLabel ? 'btn-small' : 'btn-small btn-small--brand',
      href: '/portal/report/' + encodeURIComponent(report.id),
      'aria-label': (opts.openLabel || (closed ? 'View' : 'Open report')) + ': ' + report.title,
      text: opts.openLabel || (closed ? 'View' : 'Open report')
    });
    var actions = [open];
    if (closed || opts.record) {
      actions.push(h('a', {
        class: 'btn-small',
        href: '/api/portal/reports/' + encodeURIComponent(report.id) + '/record',
        'aria-label': 'Download the approvals record for ' + report.title,
        text: 'Download record'
      }));
    }
    var reviewed = report.progress && report.progress.lastAt;
    var metaParts = [h('span', { text: closed && report.closedAt ? 'Closed ' + formatDate(report.closedAt) : 'Added ' + formatDate(report.createdAt) })];
    metaParts.push(h('span', { text: progressText(report.progress) + (reviewed ? ' \u00b7 last answered ' + formatDateTime(report.progress.lastAt) : '') }));
    var allActions = actions.concat(extraActions || []);
    return h('li', { 'data-report-id': report.id, class: allActions.length > 2 ? 'stack-actions' : '' }, [
      h('span', { class: 'file-badge', 'aria-hidden': 'true', text: 'HTML' }),
      h('div', { class: 'file-text' }, [
        h('p', { class: 'file-name', text: report.title }),
        h('p', { class: 'file-meta' }, metaParts)
      ]),
      h('div', { class: 'row-actions' }, allActions)
    ]);
  }

  var DECISION_TEXT = { approve: 'Approved', changes: 'Changes requested', comment: 'Comment' };

  function fileRow(file, extraActions) {
    var download = h('a', {
      class: 'btn-small',
      href: '/api/portal/files/' + encodeURIComponent(file.id),
      'aria-label': 'Download ' + file.name,
      text: 'Download'
    });
    return h('li', { 'data-file-id': file.id, class: (extraActions || []).length > 1 ? 'stack-actions' : '' }, [
      h('span', { class: 'file-badge', 'aria-hidden': 'true', text: fileKind(file.name) }),
      h('div', { class: 'file-text' }, [
        h('p', { class: 'file-name', text: file.name }),
        h('p', { class: 'file-meta' }, [
          h('span', { text: formatBytes(file.size) }),
          h('span', { text: 'Added ' + formatDate(file.createdAt) })
        ])
      ]),
      h('div', { class: 'row-actions' }, [download].concat(extraActions || []))
    ]);
  }

  function bindLogout(root) {
    var button = root.querySelector('[data-portal-logout]');
    if (!button) return;
    button.addEventListener('click', function () {
      button.disabled = true;
      api('POST', '/api/portal/logout').catch(function () { /* signed out either way */ }).then(function () {
        button.disabled = false;
        go('/client-login');
      });
    });
  }

  /* ------------------------------------------------------------ sign-in --- */

  function initLogin(form) {
    var toggle = form.querySelector('[data-password-toggle]');
    var password = form.querySelector('[name="password"]');

    if (toggle && password) {
      toggle.addEventListener('click', function () {
        var show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
        toggle.firstChild.textContent = show ? 'Hide' : 'Show';
      });
    }

    bindForm(form, 'Signing in\u2026', function (values) {
      return api('POST', '/api/portal/login', { email: values.email, password: values.password }).then(function (data) {
        if (password) { password.value = ''; password.type = 'password'; }
        go(data.next || '/portal');
      });
    });

    return { load: function () {} };
  }

  /* ------------------------------------------------------ client portal --- */

  /** The four sections a client sees: awaiting approval, compliance files, past approvals, other files. */
  function renderPortalSections(root, reports, allFiles) {
    var openReports = reports.filter(function (r) { return r.status !== 'closed'; });
    var pastReports = reports.filter(function (r) { return r.status === 'closed'; });
    var reportList = root.querySelector('[data-report-list]');
    clear(reportList);
    openReports.forEach(function (report) { reportList.appendChild(reportRow(report)); });
    root.querySelector('[data-reports-empty]').hidden = openReports.length > 0;
    root.querySelector('[data-report-count]').textContent = openReports.length ? plural(openReports.length, 'report') : '';

    var pastList = root.querySelector('[data-past-list]');
    clear(pastList);
    pastReports.forEach(function (report) { pastList.appendChild(reportRow(report)); });
    var pastFiles = allFiles.filter(function (f) { return f.area === 'approvals'; });
    pastFiles.forEach(function (file) { pastList.appendChild(fileRow(file)); });
    var pastTotal = pastReports.length + pastFiles.length;
    root.querySelector('[data-past-section]').hidden = pastTotal === 0;
    root.querySelector('[data-past-count]').textContent = pastTotal ? plural(pastTotal, 'record') : '';

    var compliance = allFiles.filter(function (f) { return f.area === 'compliance'; });
    var complianceList = root.querySelector('[data-compliance-list]');
    clear(complianceList);
    compliance.forEach(function (file) { complianceList.appendChild(fileRow(file)); });
    complianceList.hidden = compliance.length === 0;
    root.querySelector('[data-compliance-empty]').hidden = compliance.length > 0;
    root.querySelector('[data-compliance-count]').textContent = compliance.length ? plural(compliance.length, 'file') : '';

    var others = allFiles.filter(function (f) { return f.area !== 'compliance' && f.area !== 'approvals'; });

    var list = root.querySelector('[data-file-list]');
    var empty = root.querySelector('[data-files-empty]');
    var count = root.querySelector('[data-file-count]');
    clear(list);
    others.forEach(function (file) { list.appendChild(fileRow(file)); });
    var loading = root.querySelector('[data-files-loading]'); if (loading) loading.hidden = true;
    empty.hidden = others.length > 0;
    list.hidden = others.length === 0;
    count.textContent = others.length ? plural(others.length, 'file') : '';
  }

  function initFiles(root) {
    var status = root.querySelector('[data-portal-status]');
    var list = root.querySelector('[data-file-list]');
    var loading = root.querySelector('[data-files-loading]');
    var empty = root.querySelector('[data-files-empty]');
    var count = root.querySelector('[data-file-count]');
    var nudge = root.querySelector('[data-password-nudge]');
    var passwordForm = root.querySelector('[data-password-form]');

    bindLogout(root);

    bindForm(passwordForm, 'Changing\u2026', function (values) {
      return api('POST', '/api/portal/password', { current: values.current, next: values.next }).then(function () {
        passwordForm.reset();
        if (nudge) nudge.hidden = true;
        return 'Password changed. Use the new one next time you sign in.';
      });
    });

    // A team member opening /portal?as=<client id> sees exactly what that client sees.
    var asMatch = /^[0-9a-f-]{36}$/i.test(new URLSearchParams(location.search).get('as') || '') ? new URLSearchParams(location.search).get('as') : null;

    function render(data) {
      root.querySelector('[data-portal-client]').textContent = data.client.name;
      var user = root.querySelector('[data-portal-user]');
      clear(user);
      user.appendChild(document.createTextNode('Signed in as '));
      user.appendChild(h('strong', { text: data.user.email }));

      if (nudge) nudge.hidden = asMatch ? true : data.user.passwordSetBy !== 'admin';

      renderPortalSections(root, data.reports || [], data.files || []);
    }

    /** The team bar above the client's own page: who you are looking at, and the way back. */
    function mountViewAsBar(client) {
      var wrap = root.querySelector('.portal-wrap');
      var logins = client.users || [];
      var picker = h('select', { id: 'viewas-login', 'aria-label': 'Show the page as this login' }, logins.length
        ? logins.map(function (u) { return h('option', { value: u.email, text: u.name ? u.name + ' (' + u.email + ')' : u.email }); })
        : [h('option', { value: '', text: 'No logins yet' })]);
      picker.addEventListener('change', function () { render(viewData(client, picker.value)); });

      var bar = h('div', { class: 'viewas-bar', role: 'region', 'aria-label': 'Team view' }, [
        h('span', { class: 'viewas-label', text: 'Viewing as ' + client.name }),
        h('span', { class: 'viewas-note', text: 'This is the client\u2019s page. Nothing here can be changed.' }),
        h('label', { class: 'viewas-login', for: 'viewas-login' }, [h('span', { text: 'Login ' }), picker]),
        h('a', { class: 'btn-small', href: '/portal/client#client=' + encodeURIComponent(client.id), text: 'Back to ' + client.name }),
        h('a', { class: 'btn-small', href: '/portal/approvals', text: 'Exit' })
      ]);
      wrap.insertBefore(bar, wrap.firstChild);

      var out = root.querySelector('[data-portal-logout]');
      if (out) out.hidden = true;
      if (passwordForm) {
        Array.prototype.forEach.call(passwordForm.querySelectorAll('input, button'), function (el) { el.disabled = true; });
        setStatus(passwordForm.querySelector('[data-form-status]'), 'Password changes are turned off while you view this page as a team member.');
      }
    }

    function viewData(client, email) {
      var login = (client.users || []).filter(function (u) { return u.email === email; })[0] || (client.users || [])[0];
      return { client: client, user: { email: login ? login.email : 'no login yet' }, reports: client.reports || [], files: client.files || [] };
    }

    function loadAsTeam() {
      return api('GET', '/api/portal/admin/clients').then(function (data) {
        var client = data.clients.filter(function (c) { return c.id === asMatch; })[0];
        if (!client) { go('/portal/clients'); return; }
        mountViewAsBar(client);
        render(viewData(client));
      });
    }

    function load() {
      setStatus(status, '');
      return api('GET', '/api/portal/me').then(function (data) {
        if (data.role === 'client') { render(data); return; }
        if (asMatch) return loadAsTeam();
        go('/portal/approvals');
      }).catch(function (error) {
        if (error.code === 'signed_out') return;
        if (asMatch && error.status === 404) { go('/portal/clients'); return; }
        loading.hidden = true;
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  function initClientsList(root) {
    var status = root.querySelector('[data-portal-status]');
    var body = root.querySelector('[data-client-rows]');
    var loading = root.querySelector('[data-clients-loading]');
    var empty = root.querySelector('[data-clients-empty]');
    var table = root.querySelector('[data-clients-table]');
    var search = root.querySelector('[data-client-search]');
    var chips = Array.prototype.slice.call(root.querySelectorAll('[data-client-chip]'));
    var workedCol = root.querySelectorAll('[data-worked-col]');
    var state = { clients: [], filter: 'all', query: '', workers: {}, master: false };

    function openCount(c) { return (c.reports || []).filter(function (r) { return r.status !== 'closed'; }).length; }
    function lastActivity(c) {
      return (c.reports || []).reduce(function (best, r) {
        var at = r.progress && r.progress.lastAt;
        return at && (!best || at > best) ? at : best;
      }, null);
    }
    function awaiting(c) {
      return (c.reports || []).some(function (r) { return r.status !== 'closed' && !(r.progress && r.progress.lastAt); });
    }

    function visible() {
      var q = state.query.trim().toLowerCase();
      return state.clients.filter(function (c) {
        if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
        if (state.filter === 'open') return openCount(c) > 0;
        if (state.filter === 'nologin') return c.users.length === 0;
        return true;
      });
    }

    function render() {
      loading.hidden = true;
      var rows = visible();
      clear(body);
      empty.hidden = rows.length > 0;
      empty.textContent = state.clients.length ? 'No clients match.' : 'No clients yet. Use Create client to set up the first portal.';
      table.hidden = rows.length === 0;
      Array.prototype.forEach.call(workedCol, function (n) { n.hidden = !state.master; });
      rows.forEach(function (c) {
        var open = openCount(c);
        var last = lastActivity(c);
        var link = h('a', { class: 'client-link', href: '/portal/client#client=' + encodeURIComponent(c.id), text: c.name });
        var cells = [
          h('th', { scope: 'row' }, [link]),
          h('td', { text: open ? plural(open, 'open approval') : 'None open' }),
          h('td', { text: last ? formatDateTime(last) : (awaiting(c) ? 'Awaiting first answer' : '—') }),
          h('td', { text: c.users.length ? plural(c.users.length, 'login') : 'No logins' })
        ];
        if (state.master) {
          var names = state.workers[c.id] || [];
          cells.push(h('td', { text: names.length ? names.join(', ') : 'Every master' }));
        }
        cells.push(h('td', {}, [h('a', { class: 'btn-small', href: '/portal/client#client=' + encodeURIComponent(c.id), 'aria-label': 'Open ' + c.name, text: 'Open' })]));
        body.appendChild(h('tr', {}, cells));
      });
    }

    search.addEventListener('input', function () { state.query = search.value; render(); });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.getAttribute('data-client-chip');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        render();
      });
    });

    function load() {
      setStatus(status, '');
      return api('GET', '/api/portal/me').then(function (me) {
        if (me.role === 'client') { go('/portal'); return null; }
        state.master = !!me.isMaster;
        return state.master ? api('GET', '/api/portal/operators').then(function (d) { return d.operators || []; }, function () { return []; }) : [];
      }).then(function (operators) {
        if (operators === null) return null;
        state.workers = {};
        operators.forEach(function (op) {
          if (op.role === 'master') return;
          (op.clientIds || []).forEach(function (id) { (state.workers[id] = state.workers[id] || []).push(op.name); });
        });
        return api('GET', '/api/portal/admin/clients');
      }).then(function (data) {
        if (!data) return;
        state.clients = data.clients.slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        render();
      }).catch(function (error) {
        loading.hidden = true;
        if (error.code === 'signed_out') return;
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  /* ------------------------------------------------ team bar and approvals --- */

  /** Dialog for an operator choosing their own password (the owner's lives in server settings). */
  function openPasswordDialog(trigger) {
    var dialog = h('dialog', { class: 'team-dialog', 'aria-labelledby': 'pw-title' });
    var status = h('p', { class: 'form-status', 'data-form-status': true, role: 'alert', 'aria-live': 'assertive' });
    var form = h('form', { class: 'password-form', novalidate: true }, [
      h('h2', { id: 'pw-title', tabindex: '-1', text: 'Change your password' }),
      h('div', { class: 'field' }, [h('label', { for: 'dlg-pw-current', text: 'Current password' }), h('input', { type: 'password', id: 'dlg-pw-current', name: 'current', autocomplete: 'current-password', required: true })]),
      h('div', { class: 'field' }, [h('label', { for: 'dlg-pw-next', text: 'New password' }), h('input', { type: 'password', id: 'dlg-pw-next', name: 'next', autocomplete: 'new-password', minlength: '10', required: true }), h('p', { class: 'field-hint', text: 'At least 10 characters. Changing it signs you out on your other devices.' })]),
      status,
      h('div', { class: 'row-actions' }, [
        h('button', { class: 'btn-small btn-small--brand', type: 'submit', text: 'Change password' }),
        h('button', { class: 'btn-small', type: 'button', 'data-close': true, text: 'Close' })
      ])
    ]);
    dialog.appendChild(form);
    function close() { dialog.close ? dialog.close() : null; dialog.remove(); if (trigger && trigger.focus) trigger.focus(); }
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    form.querySelector('[data-close]').addEventListener('click', close);
    bindForm(form, 'Changing…', function (values) {
      return api('POST', '/api/portal/operator/password', { current: values.current, next: values.next }).then(function () {
        form.reset();
        return 'Password changed. Use the new one next time you sign in.';
      });
    });
    document.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    form.elements.current.focus();
  }

  /** The tab bar every team screen shares: tabs, Create client, and the account menu. */
  function initTeamNav() {
    var nav = document.querySelector('[data-team-nav]');
    if (!nav) return null;

    var here = location.pathname.replace(/\/+$/, '');
    Array.prototype.forEach.call(nav.querySelectorAll('[data-tab]'), function (link) {
      var path = link.getAttribute('href');
      // The client workspace belongs to the Clients tab.
      if (path === here || (path === '/portal/clients' && here === '/portal/client')) link.setAttribute('aria-current', 'page');
    });

    var badge = nav.querySelector('[data-approvals-badge]');
    function refreshBadge() {
      return api('GET', '/api/portal/admin/approvals').then(function (data) {
        var open = data.reports.filter(function (r) { return r.status !== 'closed'; }).length;
        badge.textContent = String(open);
        badge.hidden = open === 0;
        badge.setAttribute('aria-label', plural(open, 'open approval'));
      }, function () { /* the badge is a convenience */ });
    }

    var logout = nav.querySelector('[data-portal-logout]');
    logout.addEventListener('click', function () {
      logout.disabled = true;
      api('POST', '/api/portal/logout').catch(function () { /* signed out either way */ }).then(function () { go('/client-login'); });
    });

    var account = nav.querySelector('[data-team-account]');
    document.addEventListener('click', function (e) { if (account.open && !account.contains(e.target)) account.open = false; });
    account.addEventListener('keydown', function (e) { if (e.key === 'Escape' && account.open) { account.open = false; account.querySelector('summary').focus(); } });

    var pwButton = nav.querySelector('[data-account-password]');
    pwButton.addEventListener('click', function () { account.open = false; openPasswordDialog(account.querySelector('summary')); });

    nav.querySelector('[data-team-create-client]').addEventListener('click', function () {
      openCreateClient({ onCreated: function (client) { go('/portal/client#client=' + encodeURIComponent(client.id)); } });
    });

    api('GET', '/api/portal/me').then(function (me) {
      if (me.role === 'client') return;
      Array.prototype.forEach.call(nav.querySelectorAll('[data-team-master]'), function (n) { n.hidden = !me.isMaster; });
      nav.querySelector('[data-account-name]').textContent = (me.user && (me.user.name || me.user.email)) || 'Account';
      nav.querySelector('[data-account-email]').textContent = (me.user && me.user.email) || '';
      pwButton.hidden = me.role !== 'operator';
    }, function () {});

    refreshBadge();
    return { refreshBadge: refreshBadge };
  }

  /** One row of the Approvals table: the answers open in place; the rest sits under More. */
  function approvalEntry(report, hooks) {
    var closed = report.status === 'closed';
    var items = report.items.map(function (item) {
      var who = item.signerName + (item.decidedAt || item.savedAt ? ', ' + formatDateTime(item.decidedAt || item.savedAt) : '');
      return h('li', {}, [
        h('p', { class: 'approval-item-title' }, [
          h('strong', { text: item.title || item.key }),
          h('span', { text: ' — ' + (DECISION_TEXT[item.decision] || item.decision) + (item.choice ? ': ' + item.choice : '') })
        ]),
        item.comment ? h('p', { class: 'approval-comment', text: item.comment }) : null,
        h('p', { class: 'file-meta' }, [h('span', { text: who })])
      ]);
    });

    var answers = h('div', { class: 'approval-answers', hidden: true }, [
      items.length ? h('ul', { class: 'approval-items' }, items) : h('p', { class: 'portal-empty', text: 'No answers yet.' })
    ]);
    var toggle = h('button', { type: 'button', class: 'btn-small btn-small--brand', 'aria-expanded': 'false', 'aria-label': 'Open answers: ' + report.title, text: 'Open answers' });
    toggle.addEventListener('click', function () {
      var open = answers.hidden;
      answers.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Hide answers' : 'Open answers';
    });

    var record = h('a', { class: 'more-item', href: '/api/portal/reports/' + encodeURIComponent(report.id) + '/record', text: 'Download record' });
    var view = h('a', { class: 'more-item', href: '/portal/report/' + encodeURIComponent(report.id), text: closed ? 'View report' : 'Preview report' });
    var toggleState = h('button', { type: 'button', class: 'more-item', text: closed ? 'Reopen approval' : 'Close approval' });
    confirmable(toggleState, closed ? 'Confirm: reopen' : 'Confirm: move to past', function () {
      return api('PATCH', '/api/portal/admin/reports/' + encodeURIComponent(report.id), { status: closed ? 'open' : 'closed' }).then(function () {
        hooks.changed(closed ? report.title + ' is open again.' : report.title + ' moved to past approvals. The client can still view it, but can no longer change their answers.');
      }).catch(hooks.fail);
    });
    var remove = h('button', { type: 'button', class: 'more-item more-item--danger', text: 'Delete' });
    confirmable(remove, 'Confirm: delete report and its answers', function () {
      return api('DELETE', '/api/portal/admin/reports/' + encodeURIComponent(report.id)).then(function () {
        hooks.changed('Deleted ' + report.title + ' and its answers.');
      }).catch(hooks.fail);
    });
    var more = h('details', { class: 'more-menu' }, [
      h('summary', { 'aria-label': 'More actions for ' + report.title, text: 'More' }),
      h('div', { class: 'more-list' }, [view, record, toggleState, remove])
    ]);

    return h('li', { class: 'approval-row' }, [
      h('div', { class: 'approval-row-main' }, [
        h('div', { class: 'approval-row-text' }, [
          h('p', { class: 'approval-report', text: report.clientName + ': ' + report.title }),
          h('p', { class: 'file-meta' }, [
            h('span', { text: progressText(report.progress) }),
            closed && report.closedAt ? h('span', { text: 'Closed ' + formatDate(report.closedAt) }) : null,
            report.progress && report.progress.lastAt ? h('span', { text: 'Last answered ' + formatDateTime(report.progress.lastAt) }) : null
          ])
        ]),
        h('div', { class: 'row-actions' }, [toggle, more])
      ]),
      answers
    ]);
  }

  /** The screen masters and operators land on: open approvals, with Past approvals folded underneath. */
  function initApprovals(root) {
    var status = root.querySelector('[data-portal-status]');
    var list = root.querySelector('[data-approval-list]');
    var loading = root.querySelector('[data-approvals-loading]');
    var empty = root.querySelector('[data-approvals-empty]');
    var count = root.querySelector('[data-approvals-count]');
    var past = root.querySelector('[data-past-approvals]');
    var pastList = root.querySelector('[data-past-approval-list]');
    var pastCount = root.querySelector('[data-past-count]');

    var hooks = {
      changed: function (message) { setStatus(status, message, 'success'); return load(true); },
      fail: function (error) { if (error.code !== 'signed_out') setStatus(status, error.message, 'error'); throw error; }
    };

    function render(reports) {
      var openOnes = reports.filter(function (r) { return r.status !== 'closed'; });
      var pastOnes = reports.filter(function (r) { return r.status === 'closed'; });
      loading.hidden = true;
      clear(list);
      openOnes.forEach(function (r) { list.appendChild(approvalEntry(r, hooks)); });
      empty.hidden = openOnes.length > 0;
      list.hidden = openOnes.length === 0;
      count.textContent = openOnes.length ? plural(openOnes.length, 'open report') : '';

      clear(pastList);
      pastOnes.forEach(function (r) { pastList.appendChild(approvalEntry(r, hooks)); });
      past.hidden = pastOnes.length === 0;
      pastCount.textContent = pastOnes.length ? '(' + pastOnes.length + ')' : '';
    }

    function load(keepStatus) {
      if (keepStatus !== true) setStatus(status, '');
      return api('GET', '/api/portal/admin/approvals').then(function (data) {
        render(data.reports);
        if (A.portalTeam) A.portalTeam.refreshBadge();
      }).catch(function (error) {
        loading.hidden = true;
        if (error.code === 'signed_out') return;
        if (error.status === 404) { go('/portal'); return; }
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  function refreshBadge() {
    if (A.portalTeam && A.portalTeam.refreshBadge) A.portalTeam.refreshBadge();
  }

  /** One client's workspace: Approvals, Files and Logins, chosen by #client=<id>. */
  function initAdmin(root) {
    var state = { clients: [], selectedId: null, maxFileBytes: 25 * 1024 * 1024 };

    var status = root.querySelector('[data-portal-status]');
    var detail = root.querySelector('[data-detail]');
    var detailEmpty = root.querySelector('[data-detail-empty]');
    var detailName = root.querySelector('[data-detail-name]');
    var renameForm = root.querySelector('[data-rename-form]');
    var fileList = root.querySelector('[data-file-list]');
    var filesEmpty = root.querySelector('[data-files-empty]');
    var fileCount = root.querySelector('[data-file-count]');
    var loginList = root.querySelector('[data-login-list]');
    var loginsEmpty = root.querySelector('[data-logins-empty]');
    var loginCount = root.querySelector('[data-login-count]');
    var queue = root.querySelector('[data-upload-queue]');
    var inputs = root.querySelectorAll('[data-upload-input]');
    var dropCards = root.querySelectorAll('[data-drop-area]');
    var credential = root.querySelector('[data-credential]');
    var reportList = root.querySelector('[data-report-list]');
    var reportsEmpty = root.querySelector('[data-reports-empty]');
    var reportCount = root.querySelector('[data-report-count]');
    var pastList = root.querySelector('[data-past-list]');
    var pastEmpty = root.querySelector('[data-past-empty]');
    var pastCount = root.querySelector('[data-past-count]');
    var approvalFileList = root.querySelector('[data-approval-file-list]');
    var complianceList = root.querySelector('[data-compliance-list]');
    var complianceEmpty = root.querySelector('[data-compliance-empty]');
    var complianceCount = root.querySelector('[data-compliance-count]');

    function selected() {
      return state.clients.filter(function (c) { return c.id === state.selectedId; })[0] || null;
    }

    function sortClients() {
      state.clients.sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    }

    function fail(error) {
      if (error.code !== 'signed_out') setStatus(status, error.message, 'error');
      throw error;
    }

    /* ---- rendering ---- */

    function deleteFileButton(client, file) {
      var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Delete ' + file.name, text: 'Delete' });
      confirmable(remove, 'Confirm delete', function () {
        return api('DELETE', '/api/portal/admin/files/' + encodeURIComponent(file.id)).then(function () {
          client.files = client.files.filter(function (f) { return f.id !== file.id; });
          renderFiles(client);
          setStatus(status, 'Deleted ' + file.name + '.', 'success');
          root.querySelector('#admin-files-heading').focus();
        }).catch(fail);
      });
      return remove;
    }

    function moveFileButton(client, file, to) {
      var label = to === 'compliance' ? 'Move to Compliance' : 'Move to Other files';
      var button = h('button', { type: 'button', class: 'btn-small', 'aria-label': label + ': ' + file.name, text: label });
      button.addEventListener('click', function () {
        button.disabled = true;
        api('PATCH', '/api/portal/admin/files/' + encodeURIComponent(file.id), { area: to }).then(function (data) {
          file.area = data.file.area;
          renderFiles(client);
          setStatus(status, file.name + ' is now in ' + (to === 'compliance' ? 'Compliance files' : 'Other files') + '. The client sees the change straight away.', 'success');
        }).catch(function (e) { button.disabled = false; fail(e); });
      });
      return button;
    }

    /** Past approvals holds closed reports and uploaded completed approvals. */
    function renderPastSummary(client) {
      var closed = (client.reports || []).filter(function (r) { return r.status === 'closed'; }).length;
      var uploaded = client.files.filter(function (f) { return f.area === 'approvals'; }).length;
      var total = closed + uploaded;
      pastEmpty.hidden = total > 0;
      pastCount.textContent = total ? plural(total, 'record') : '';
    }

    function renderFiles(client) {
      var compliance = client.files.filter(function (f) { return f.area === 'compliance'; });
      var other = client.files.filter(function (f) { return f.area === 'files'; });
      var approvalFiles = client.files.filter(function (f) { return f.area === 'approvals'; });
      clear(fileList);
      other.forEach(function (file) { fileList.appendChild(fileRow(file, [moveFileButton(client, file, 'compliance'), deleteFileButton(client, file)])); });
      filesEmpty.hidden = other.length > 0;
      fileList.hidden = other.length === 0;
      clear(complianceList);
      compliance.forEach(function (file) { complianceList.appendChild(fileRow(file, [moveFileButton(client, file, 'files'), deleteFileButton(client, file)])); });
      complianceEmpty.hidden = compliance.length > 0;
      complianceList.hidden = compliance.length === 0;
      complianceCount.textContent = compliance.length ? plural(compliance.length, 'file') : '';
      clear(approvalFileList);
      approvalFiles.forEach(function (file) { approvalFileList.appendChild(fileRow(file, [deleteFileButton(client, file)])); });
      approvalFileList.hidden = approvalFiles.length === 0;
      renderPastSummary(client);
      fileCount.textContent = client.files.length ? plural(client.files.length, 'file') : '';
    }

    function setStatusButton(client, report, closing) {
      var button = h('button', {
        type: 'button', class: 'btn-small',
        'aria-label': (closing ? 'Close approval: ' : 'Reopen approval: ') + report.title,
        text: closing ? 'Close approval' : 'Reopen'
      });
      confirmable(button, closing ? 'Confirm: move to past approvals' : 'Confirm: reopen for answers', function () {
        return api('PATCH', '/api/portal/admin/reports/' + encodeURIComponent(report.id), { status: closing ? 'closed' : 'open' }).then(function (data) {
          report.status = data.report.status;
          report.closedAt = data.report.closedAt;
          renderReports(client);
          refreshBadge();
          setStatus(status, closing ? report.title + ' moved to past approvals. The client can still view it, but can no longer change their answers.' : report.title + ' is open again.', 'success');
        }).catch(fail);
      });
      return button;
    }

    function renderReports(client) {
      client.reports = client.reports || [];
      var openOnes = client.reports.filter(function (r) { return r.status !== 'closed'; });
      var pastOnes = client.reports.filter(function (r) { return r.status === 'closed'; });

      function deleteButton(report) {
        var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Delete ' + report.title, text: 'Delete' });
        confirmable(remove, 'Confirm: delete report and its answers', function () {
          return api('DELETE', '/api/portal/admin/reports/' + encodeURIComponent(report.id)).then(function () {
            client.reports = client.reports.filter(function (r) { return r.id !== report.id; });
            renderReports(client);
            refreshBadge();
            setStatus(status, 'Deleted ' + report.title + ' and its answers.', 'success');
            root.querySelector('#admin-reports-heading').focus();
          }).catch(fail);
        });
        return remove;
      }

      clear(reportList);
      openOnes.forEach(function (report) {
        reportList.appendChild(reportRow(report, [setStatusButton(client, report, true), deleteButton(report)], { openLabel: 'Preview', record: true }));
      });
      reportsEmpty.hidden = openOnes.length > 0;
      reportList.hidden = openOnes.length === 0;
      reportCount.textContent = openOnes.length ? plural(openOnes.length, 'report') : '';

      clear(pastList);
      pastOnes.forEach(function (report) {
        pastList.appendChild(reportRow(report, [setStatusButton(client, report, false), deleteButton(report)], { openLabel: 'View', record: true }));
      });
      pastList.hidden = pastOnes.length === 0;
      renderPastSummary(client);
    }

    function showCredential(title, email, password) {
      credential.querySelector('[data-credential-title]').textContent = title;
      credential.querySelector('[data-credential-email]').textContent = email;
      credential.querySelector('[data-credential-password]').textContent = password;
      credential.querySelector('[data-credential-copied]').textContent = '';
      credential.hidden = false;
      credential.focus();
    }

    function hideCredential() {
      // Take the password out of the page, not just out of sight.
      credential.querySelector('[data-credential-password]').textContent = '';
      credential.hidden = true;
    }

    function renderLogins(client) {
      clear(loginList);
      client.users.forEach(function (user) {
        var who = user.name || user.email;

        var reset = h('button', { type: 'button', class: 'btn-small', 'aria-label': 'Reset password for ' + who, text: 'Reset password' });
        confirmable(reset, 'Confirm reset', function () {
          return api('POST', '/api/portal/admin/logins/' + encodeURIComponent(user.id) + '/reset').then(function (data) {
            user.passwordSetBy = 'admin';
            renderLogins(client);
            setStatus(status, 'Password reset for ' + user.email + '. Their old password no longer works.', 'success');
            showCredential('New password for ' + who, user.email, data.password);
          }).catch(fail);
        });

        var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Remove login for ' + who, text: 'Remove' });
        confirmable(remove, 'Confirm remove', function () {
          return api('DELETE', '/api/portal/admin/logins/' + encodeURIComponent(user.id)).then(function () {
            client.users = client.users.filter(function (u) { return u.id !== user.id; });
            hideCredential();
            renderLogins(client);
            setStatus(status, 'Removed the login for ' + user.email + '.', 'success');
            root.querySelector('#admin-logins-heading').focus();
          }).catch(fail);
        });

        loginList.appendChild(h('li', {}, [
          h('div', {}, [
            h('p', { class: 'login-name', text: who }),
            h('p', { class: 'login-meta' }, [
              user.name ? h('span', { text: user.email }) : null,
              h('span', { text: user.lastLoginAt ? 'Last signed in ' + formatDate(user.lastLoginAt) : 'Hasn\u2019t signed in yet' }),
              h('span', { text: user.passwordSetBy === 'user' ? 'Set their own password' : 'Using the password we sent' })
            ])
          ]),
          h('div', { class: 'row-actions' }, [reset, remove])
        ]));
      });
      loginsEmpty.hidden = client.users.length > 0;
      loginList.hidden = client.users.length === 0;
      loginCount.textContent = client.users.length ? plural(client.users.length, 'login') : '';
    }

    function renderDetail() {
      var client = selected();
      detail.hidden = !client;
      detailEmpty.hidden = !!client;
      if (!client) return;

      detailName.textContent = client.name;
      document.title = client.name + ' \u2014 Accessrank team';
      var viewAs = root.querySelector('[data-view-as]');
      viewAs.setAttribute('href', '/portal?as=' + encodeURIComponent(client.id));
      renameForm.hidden = true;
      renderReports(client);
      renderFiles(client);
      renderLogins(client);
    }

    function select(id, moveFocus) {
      state.selectedId = id;
      hideCredential();
      clear(queue);
      renderDetail();
      if (moveFocus && selected()) detailName.focus();
    }

    /* ---- tabs ---- */

    var tabButtons = Array.prototype.slice.call(root.querySelectorAll('[data-tab-button]'));
    function showTab(name, moveFocus) {
      tabButtons.forEach(function (button) {
        var on = button.getAttribute('data-tab-button') === name;
        button.setAttribute('aria-selected', on ? 'true' : 'false');
        button.tabIndex = on ? 0 : -1;
        if (on && moveFocus) button.focus();
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-tab-panel]'), function (panel) {
        panel.hidden = panel.getAttribute('data-tab-panel') !== name;
      });
    }
    tabButtons.forEach(function (button, i) {
      button.addEventListener('click', function () { showTab(button.getAttribute('data-tab-button')); });
      button.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        showTab(tabButtons[(i + step + tabButtons.length) % tabButtons.length].getAttribute('data-tab-button'), true);
      });
    });

    root.querySelector('[data-rename-open]').addEventListener('click', function () {
      var field = renameForm.querySelector('[name="name"]');
      renameForm.hidden = false;
      field.value = selected().name;
      field.focus();
      field.select();
    });
    root.querySelector('[data-rename-cancel]').addEventListener('click', function () {
      renameForm.hidden = true;
      root.querySelector('[data-rename-open]').focus();
    });
    bindForm(renameForm, 'Saving\u2026', function (values) {
      var client = selected();
      return api('PATCH', '/api/portal/admin/clients/' + encodeURIComponent(client.id), { name: values.name }).then(function (data) {
        client.name = data.client.name;
        sortClients();
        render();
        setStatus(status, 'Renamed to ' + client.name + '.', 'success');
        detailName.focus();
      });
    });

    confirmable(root.querySelector('[data-delete-client]'), 'Confirm: delete client, logins and files', function () {
      var client = selected();
      return api('DELETE', '/api/portal/admin/clients/' + encodeURIComponent(client.id)).then(function () {
        go('/portal/clients');
      }).catch(fail);
    });

    /* ---- reports ---- */

    var addReport = root.querySelector('[data-add-report]');
    bindForm(addReport, 'Publishing\u2026', function (values) {
      var client = selected();
      var file = addReport.querySelector('[name="file"]').files[0];
      if (!file) {
        var err = new Error('Choose the HTML file to publish.');
        err.field = 'file';
        throw err;
      }
      if (file.size > state.maxFileBytes) {
        var big = new Error('That file is over the ' + formatBytes(state.maxFileBytes) + ' limit.');
        big.field = 'file';
        throw big;
      }
      var url = '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/reports?title=' + encodeURIComponent(values.title || '');
      return api('POST', url, null, file).then(function (data) {
        client.reports = client.reports || [];
        client.reports.unshift(data.report);
        addReport.reset();
        renderReports(client);
        refreshBadge();
        return 'Published. ' + client.name + ' will see it in their portal straight away.';
      });
    });

    /* ---- logins ---- */

    var addLogin = root.querySelector('[data-add-login]');
    bindForm(addLogin, 'Creating\u2026', function (values) {
      var client = selected();
      return api('POST', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/logins', {
        name: values.name, email: values.email
      }).then(function (data) {
        client.users.push(data.user);
        addLogin.reset();
        renderLogins(client);
        setStatus(status, 'Created a login for ' + data.user.email + '.', 'success');
        showCredential('Login created for ' + (data.user.name || data.user.email), data.user.email, data.password);
      });
    });

    credential.querySelector('[data-credential-dismiss]').addEventListener('click', function () {
      hideCredential();
      root.querySelector('#admin-logins-heading').focus();
    });

    credential.querySelector('[data-credential-copy]').addEventListener('click', function () {
      var copied = credential.querySelector('[data-credential-copied]');
      var text = [
        'Your Accessrank client portal',
        'Sign in: ' + window.location.origin + '/client-login',
        'Email: ' + credential.querySelector('[data-credential-email]').textContent,
        'Password: ' + credential.querySelector('[data-credential-password]').textContent,
        '',
        'You can change this password after you sign in.'
      ].join('\n');

      var done = function () { copied.textContent = 'Copied. Paste it into an email to the client.'; };
      var manual = function () {
        // Clipboard access refused: select the password so Ctrl/Cmd+C still works.
        var range = document.createRange();
        range.selectNodeContents(credential.querySelector('[data-credential-password]'));
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copied.textContent = 'Password selected \u2014 press Ctrl or Cmd + C to copy it.';
      };

      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
      else manual();
    });

    /* ---- uploads ---- */

    function uploadOne(client, file, area) {
      var state_ = h('span', { class: 'upload-state', text: 'Uploading\u2026' });
      var row = h('li', {}, [h('span', { class: 'upload-name', text: file.name }), state_]);
      queue.appendChild(row);

      var reject = function (message) {
        row.className = 'is-error';
        state_.textContent = message;
        return false;
      };

      if (file.size === 0) return Promise.resolve(reject('Empty file \u2014 skipped'));
      if (file.size > state.maxFileBytes) {
        return Promise.resolve(reject('Over the ' + formatBytes(state.maxFileBytes) + ' limit \u2014 skipped'));
      }

      var url = '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/files?name=' + encodeURIComponent(file.name) + '&area=' + encodeURIComponent(area);
      return api('POST', url, null, file).then(function (data) {
        client.files.unshift(data.file);
        row.className = 'is-done';
        state_.textContent = 'Added';
        if (client.id === state.selectedId) renderFiles(client);
        return true;
      }, function (error) {
        return reject(error.message);
      });
    }

    var uploading = false;

    function uploadFiles(files, area) {
      var client = selected();
      var batch = Array.prototype.slice.call(files || []);
      if (!client || !batch.length) return;
      if (uploading) {
        setStatus(status, 'Wait for the current upload to finish, then add more.', 'error');
        return;
      }

      uploading = true;
      clear(queue);
      setStatus(status, 'Uploading ' + plural(batch.length, 'file') + ' to ' + client.name + '\u2026');

      // One at a time, in order: a failure is then attributable to one file, and
      // a slow connection is not asked to carry several large uploads at once.
      var added = 0;
      batch.reduce(function (chain, file) {
        return chain.then(function () { return uploadOne(client, file, area); }).then(function (ok) { if (ok) added += 1; });
      }, Promise.resolve()).then(function () {
        uploading = false;
        Array.prototype.forEach.call(inputs, function (el) { el.value = ''; });
        var skipped = batch.length - added;
        setStatus(
          status,
          'Added ' + plural(added, 'file') + ' to ' + ({ compliance: 'Compliance files', approvals: 'Past approvals' }[area] || 'Other files') + (skipped ? '. ' + plural(skipped, 'file') + ' could not be added \u2014 see the list below.' : '.'),
          skipped ? 'error' : 'success'
        );
        // Successful rows have done their job; problems stay until the next batch.
        Array.prototype.slice.call(queue.querySelectorAll('.is-done')).forEach(function (row) { row.remove(); });
      });
    }

    Array.prototype.forEach.call(inputs, function (el) {
      el.addEventListener('change', function () { uploadFiles(el.files, el.getAttribute('data-upload-input')); });
    });

    // The whole window accepts a drop while a client is open, so a file let go a
    // little outside the box still lands — and never makes the browser navigate
    // away to display it.
    var hasFiles = function (e) {
      return !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
    };
    var depth = 0;
    var setOver = function (over) { Array.prototype.forEach.call(dropCards, function (c) { c.classList.toggle('is-ready', over); if (!over) c.classList.remove('is-over'); }); };
    var cardAt = function (e) { return e.target && e.target.closest ? e.target.closest('[data-drop-area]') : null; };
    var active = function () { return !!selected() && root.getClientRects().length > 0; };

    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e) || !active()) return;
      depth += 1;
      setOver(true);
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e) || !active()) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e) || !active()) return;
      e.preventDefault();
      var over = cardAt(e);
      Array.prototype.forEach.call(dropCards, function (c) { c.classList.toggle('is-over', c === over); });
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e) || !active()) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      var card = cardAt(e);
      if (!card) { setStatus(status, 'Drop files onto Past approvals, Compliance files or Other files.', 'error'); return; }
      uploadFiles(e.dataTransfer.files, card.getAttribute('data-drop-area'));
    });

    /* ---- load ---- */

    bindLogout(root);

    // Only masters add, rename or delete clients, and only masters see the operators page.
    function applyRole(me) {
      var master = !!me.isMaster;
      Array.prototype.forEach.call(root.querySelectorAll('[data-master-control]'), function (node) { node.hidden = !master; });
    }

    function load() {
      setStatus(status, '');
      api('GET', '/api/portal/me').then(function (me) { if (me.role !== 'client') applyRole(me); }, function () {});
      return api('GET', '/api/portal/admin/clients').then(function (data) {
        state.clients = data.clients;
        state.maxFileBytes = data.maxFileBytes || state.maxFileBytes;
        Array.prototype.forEach.call(root.querySelectorAll('[data-max-file]'), function (n) { n.textContent = formatBytes(state.maxFileBytes); });
        sortClients();
        var wanted = /client=([0-9a-f-]{36})/i.exec(location.hash || '');
        // No client chosen: the list is where you pick one.
        if (!wanted) { go('/portal/clients'); return; }
        state.selectedId = state.clients.some(function (c) { return c.id === wanted[1]; }) ? wanted[1] : null;
        hideCredential();
        renderDetail();
      }).catch(function (error) {
        if (error.code === 'signed_out') return;
        // A client login that reaches this page is told nothing about it.
        if (error.status === 404) { go('/portal'); return; }
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  /* ---------------------------------------------------------- operators --- */

  function initOperators(root) {
    var state = { operators: [], clients: [], openId: null, meEmail: '' };

    var status = root.querySelector('[data-portal-status]');
    var masterOnly = root.querySelector('[data-master-only]');
    var list = root.querySelector('[data-operator-list]');
    var loading = root.querySelector('[data-operators-loading]');
    var empty = root.querySelector('[data-operators-empty]');
    var count = root.querySelector('[data-operator-count]');
    var credential = root.querySelector('[data-credential]');
    var meta = root.querySelector('[data-operators-meta]');

    bindLogout(root);

    function fail(error) {
      if (error.code !== 'signed_out') setStatus(status, error.message, 'error');
      throw error;
    }

    function showCredential(title, email, password) {
      credential.querySelector('[data-credential-title]').textContent = title;
      credential.querySelector('[data-credential-email]').textContent = email;
      credential.querySelector('[data-credential-password]').textContent = password;
      credential.querySelector('[data-credential-copied]').textContent = '';
      credential.hidden = false;
      credential.focus();
    }
    function hideCredential() {
      credential.querySelector('[data-credential-password]').textContent = '';
      credential.hidden = true;
    }
    credential.querySelector('[data-credential-dismiss]').addEventListener('click', hideCredential);
    credential.querySelector('[data-credential-copy]').addEventListener('click', function () {
      var copied = credential.querySelector('[data-credential-copied]');
      var text = [
        'Your Accessrank team console',
        'Sign in: ' + window.location.origin + '/client-login',
        'Email: ' + credential.querySelector('[data-credential-email]').textContent,
        'Password: ' + credential.querySelector('[data-credential-password]').textContent,
        '',
        'You can change this password after you sign in.'
      ].join('\n');
      var done = function () { copied.textContent = 'Copied. Paste it into a private message to the operator.'; };
      var manual = function () {
        var range = document.createRange();
        range.selectNodeContents(credential.querySelector('[data-credential-password]'));
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copied.textContent = 'Password selected \u2014 press Ctrl or Cmd + C to copy it.';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
      else manual();
    });

    function clientName(id) {
      var match = state.clients.filter(function (c) { return c.id === id; })[0];
      return match ? match.name : '';
    }

    function assignedText(op) {
      if (op.role === 'master') return 'Sees every client';
      if (!op.clientIds.length) return 'No clients assigned yet';
      var names = op.clientIds.map(clientName).filter(Boolean).sort();
      return plural(op.clientIds.length, 'client') + ': ' + names.join(', ');
    }

    function assignPanel(op) {
      var boxes = state.clients.map(function (client) {
        var id = 'assign-' + op.id + '-' + client.id;
        var input = h('input', { type: 'checkbox', id: id, value: client.id, checked: op.clientIds.indexOf(client.id) !== -1 ? true : null });
        return h('li', {}, [h('label', { for: id, class: 'assign-option' }, [input, h('span', { text: client.name })])]);
      });
      var formStatus = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
      var save = h('button', { type: 'submit', class: 'btn-small btn-small--brand', text: 'Save assignments' });
      var cancel = h('button', { type: 'button', class: 'btn-small', text: 'Close' });
      var form = h('form', { class: 'assign-form', novalidate: true }, [
        h('p', { class: 'field-hint', text: op.role === 'master'
          ? 'Masters see every client, so assignments only matter if this person is later changed to an operator.'
          : 'This operator will see only the clients ticked here.' }),
        boxes.length ? h('ul', { class: 'assign-list' }, boxes) : h('p', { class: 'portal-empty', text: 'No clients yet. Add one on the Client portals page.' }),
        formStatus,
        h('div', { class: 'row-actions' }, [save, cancel])
      ]);
      cancel.addEventListener('click', function () { state.openId = null; render(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ids = Array.prototype.slice.call(form.querySelectorAll('input[type=checkbox]:checked')).map(function (i) { return i.value; });
        save.disabled = true;
        setStatus(formStatus, '');
        api('PUT', '/api/portal/operators/' + encodeURIComponent(op.id) + '/clients', { clientIds: ids }).then(function (data) {
          op.clientIds = data.operator.clientIds;
          setStatus(status, 'Saved. ' + op.name + ' now has ' + plural(op.clientIds.length, 'client') + '.', 'success');
          state.openId = null;
          render();
          var row = list.querySelector('[data-operator-id="' + op.id + '"] .assign-open');
          if (row) row.focus();
        }, function (error) {
          save.disabled = false;
          setStatus(formStatus, error.message, 'error');
        });
      });
      return form;
    }

    function operatorRow(op) {
      var isMe = op.email.toLowerCase() === state.meEmail;
      var role = h('span', { class: 'role-badge role-badge--' + op.role, text: op.role === 'master' ? 'Master' : 'Operator' });

      var assign = h('button', { type: 'button', class: 'btn-small assign-open', 'aria-expanded': state.openId === op.id ? 'true' : 'false', text: 'Assign clients' });
      assign.addEventListener('click', function () { state.openId = state.openId === op.id ? null : op.id; render(); });

      var toggle = h('button', { type: 'button', class: 'btn-small', text: op.role === 'master' ? 'Make operator' : 'Make master', 'aria-label': (op.role === 'master' ? 'Make ' : 'Make ') + op.name + (op.role === 'master' ? ' an operator' : ' a master') });
      confirmable(toggle, 'Confirm change', function () {
        return api('PATCH', '/api/portal/operators/' + encodeURIComponent(op.id), { role: op.role === 'master' ? 'operator' : 'master' }).then(function (data) {
          op.role = data.operator.role;
          render();
          setStatus(status, op.name + ' is now ' + (op.role === 'master' ? 'a master operator.' : 'an operator.'), 'success');
        }).catch(fail);
      });

      var reset = h('button', { type: 'button', class: 'btn-small', 'aria-label': 'Reset password for ' + op.name, text: 'Reset password' });
      confirmable(reset, 'Confirm reset', function () {
        return api('POST', '/api/portal/operators/' + encodeURIComponent(op.id) + '/reset').then(function (data) {
          op.passwordSetBy = 'admin';
          render();
          setStatus(status, 'Password reset for ' + op.email + '. Their old password no longer works.', 'success');
          showCredential('New password for ' + op.name, op.email, data.password);
        }).catch(fail);
      });

      var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Remove ' + op.name, text: 'Remove' });
      confirmable(remove, 'Confirm remove', function () {
        return api('DELETE', '/api/portal/operators/' + encodeURIComponent(op.id)).then(function () {
          state.operators = state.operators.filter(function (o) { return o.id !== op.id; });
          render();
          setStatus(status, 'Removed ' + op.name + '.', 'success');
          root.querySelector('#operators-heading').focus();
        }).catch(fail);
      });

      var actions = [assign];
      if (!isMe) actions.push(toggle, reset, remove);

      return h('li', { 'data-operator-id': op.id }, [
        h('div', { class: 'operator-main' }, [
          h('div', {}, [
            h('p', { class: 'login-name' }, [document.createTextNode(op.name + (isMe ? ' (you)' : '') + ' '), role]),
            h('p', { class: 'login-meta' }, [
              h('span', { text: op.email }),
              h('span', { text: op.lastLoginAt ? 'Last signed in ' + formatDateTime(op.lastLoginAt) : 'Hasn\u2019t signed in yet' }),
              h('span', { text: assignedText(op) })
            ])
          ]),
          h('div', { class: 'row-actions' }, actions)
        ]),
        state.openId === op.id ? assignPanel(op) : null
      ]);
    }

    function render() {
      loading.hidden = true;
      clear(list);
      state.operators.forEach(function (op) { list.appendChild(operatorRow(op)); });
      empty.hidden = state.operators.length > 0;
      list.hidden = state.operators.length === 0;
      count.textContent = state.operators.length ? plural(state.operators.length, 'operator') : '';
    }

    bindForm(root.querySelector('[data-add-operator]'), 'Adding\u2026', function (values) {
      return api('POST', '/api/portal/operators', { name: values.name, email: values.email, role: values.role }).then(function (data) {
        state.operators.push(data.operator);
        state.operators.sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        root.querySelector('[data-add-operator]').reset();
        render();
        setStatus(status, 'Added ' + data.operator.name + '.', 'success');
        showCredential('Login created for ' + data.operator.name, data.operator.email, data.password);
      });
    });

    function load() {
      setStatus(status, '');
      return api('GET', '/api/portal/me').then(function (me) {
        if (me.role === 'client') { go('/portal'); return null; }
        state.meEmail = (me.user.email || '').toLowerCase();
        if (!me.isMaster) { go('/portal/approvals'); return null; }
        masterOnly.hidden = false;
        return api('GET', '/api/portal/operators').then(function (data) {
          state.operators = data.operators;
          state.clients = data.clients;
          render();
        });
      }).catch(function (error) {
        if (error.code === 'signed_out') return;
        loading.hidden = true;
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  /* ----------------------------------------------------------- repository --- */

  /** The team repository: master operators add and delete files; nobody else sees it. */
  function initRepository(root) {
    var state = { files: [], maxFileBytes: 1024 * 1024 };
    var status = root.querySelector('[data-portal-status]');
    var list = root.querySelector('[data-repo-list]');
    var loading = root.querySelector('[data-repo-loading]');
    var empty = root.querySelector('[data-repo-empty]');
    var count = root.querySelector('[data-repo-count]');
    var queue = root.querySelector('[data-upload-queue]');
    var input = root.querySelector('[data-repo-input]');
    var drop = root.querySelector('[data-repo-drop]');
    var uploading = false;
    var notes = [];
    var noteForm = root.querySelector('[data-note-form]');
    var noteList = root.querySelector('[data-note-list]');
    var noteEmpty = root.querySelector('[data-notes-empty]');
    var noteCount = root.querySelector('[data-notes-count]');

    bindLogout(root);

    function render() {
      clear(list);
      loading.hidden = true;
      empty.hidden = state.files.length > 0;
      list.hidden = state.files.length === 0;
      count.textContent = state.files.length ? '(' + state.files.length + ')' : '';
      state.files.forEach(function (file) {
        var remove = h('button', { type: 'button', class: 'btn-small', 'aria-label': 'Delete ' + file.name, text: 'Delete' });
        confirmable(remove, 'Delete for everyone', function () {
          return api('DELETE', '/api/portal/team-files/' + encodeURIComponent(file.id)).then(function () {
            state.files = state.files.filter(function (f) { return f.id !== file.id; });
            render();
            setStatus(status, 'Deleted ' + file.name + '.', 'success');
          }, function (error) { setStatus(status, error.message, 'error'); throw error; });
        });
        list.appendChild(h('li', {}, [
          h('span', { class: 'file-badge', 'aria-hidden': 'true', text: fileKind(file.name) }),
          h('div', { class: 'file-text' }, [
            h('p', { class: 'file-name', text: file.name }),
            h('p', { class: 'file-meta' }, [
              h('span', { text: formatBytes(file.size) }),
              h('span', { text: 'Added ' + formatDate(file.createdAt) + (file.addedByName || file.addedByEmail ? ' by ' + (file.addedByName || file.addedByEmail) : '') })
            ])
          ]),
          h('div', { class: 'row-actions' }, [
            h('a', { class: 'btn-small', href: '/api/portal/team-files/' + encodeURIComponent(file.id), 'aria-label': 'Download ' + file.name, text: 'Download' }),
            remove
          ])
        ]));
      });
    }

    function uploadOne(file) {
      var note = h('span', { class: 'upload-state', text: 'Uploading\u2026' });
      var row = h('li', {}, [h('span', { class: 'upload-name', text: file.name }), note]);
      queue.appendChild(row);
      var reject = function (message) { row.className = 'is-error'; note.textContent = message; return false; };
      if (file.size === 0) return Promise.resolve(reject('Empty file \u2014 skipped'));
      if (file.size > state.maxFileBytes) return Promise.resolve(reject('Over the ' + formatBytes(state.maxFileBytes) + ' limit \u2014 skipped'));
      return api('POST', '/api/portal/team-files?name=' + encodeURIComponent(file.name), null, file).then(function (data) {
        state.files.unshift(data.file);
        row.remove();
        render();
        return true;
      }, function (error) { return reject(error.message); });
    }

    function uploadFiles(files) {
      var batch = Array.prototype.slice.call(files || []);
      if (!batch.length) return;
      if (uploading) { setStatus(status, 'Wait for the current upload to finish, then add more.', 'error'); return; }
      uploading = true;
      clear(queue);
      var added = 0;
      batch.reduce(function (chain, file) {
        return chain.then(function () { return uploadOne(file); }).then(function (ok) { if (ok) added += 1; });
      }, Promise.resolve()).then(function () {
        uploading = false;
        input.value = '';
        var skipped = batch.length - added;
        setStatus(status, 'Added ' + plural(added, 'file') + (skipped ? '. ' + plural(skipped, 'file') + ' could not be added \u2014 see the list above.' : '.'), skipped ? 'error' : 'success');
      });
    }

    /* ---- notes ---- */

    function noteRow(note) {
      return h('li', { class: 'note' }, [
        h('p', { class: 'note-body', text: note.body }),
        h('p', { class: 'file-meta' }, [
          h('span', { text: note.authorName || note.authorEmail }),
          note.authorName ? h('span', { text: note.authorEmail }) : null,
          h('span', { text: formatDateTime(note.createdAt) })
        ])
      ]);
    }

    function renderNotes() {
      clear(noteList);
      notes.forEach(function (n) { noteList.appendChild(noteRow(n)); });
      noteEmpty.hidden = notes.length > 0;
      noteList.hidden = notes.length === 0;
      noteCount.textContent = notes.length ? '(' + notes.length + ')' : '';
    }

    bindForm(noteForm, 'Posting…', function (values) {
      return api('POST', '/api/portal/team-notes', { body: values.body }).then(function (data) {
        notes.unshift(data.note);
        noteForm.reset();
        renderNotes();
        return 'Note posted.';
      });
    });

    input.addEventListener('change', function () { uploadFiles(input.files); });
    ['dragenter', 'dragover'].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      drop.addEventListener(type, function () { drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) { e.preventDefault(); uploadFiles(e.dataTransfer.files); });

    return {
      load: function () {
        api('GET', '/api/portal/me').then(function (me) {
          root.querySelector('[data-note-as]').textContent = 'Posting as ' + (me.user.name || me.user.email) + (me.user.name ? ' (' + me.user.email + ')' : '');
        }, function () {});
        api('GET', '/api/portal/team-notes').then(function (data) { notes = data.notes; renderNotes(); }, function (error) {
          if (error.code !== 'signed_out') setStatus(status, error.message, 'error');
        });
        return api('GET', '/api/portal/team-files').then(function (data) {
          state.files = data.files;
          state.maxFileBytes = data.maxFileBytes || state.maxFileBytes;
          root.querySelector('[data-max-file]').textContent = formatBytes(state.maxFileBytes);
          render();
        }, function (error) {
          loading.hidden = true;
          // Anyone who is not a master gets a 404 here: send them back to the console.
          if (error.status === 404) { go('/portal/approvals'); return; }
          if (error.code !== 'signed_out') setStatus(status, error.message, 'error');
        });
      }
    };
  }

  /* ------------------------------------------------- create-client dialog --- */

  /**
   * One dialog for creating a client portal, shared by every team screen. Step 1
   * collects the company, an optional first login and the operators who will
   * work on it; step 2 shows the new password once. `opts.onCreated(client)`
   * runs after the client exists, so the caller can refresh whatever it shows.
   */
  function openCreateClient(opts) {
    var previous = document.activeElement;
    var dialog = h('dialog', { class: 'team-dialog', 'aria-labelledby': 'cc-title' });
    var made = null;

    function close() {
      if (dialog.open && dialog.close) dialog.close();
      dialog.remove();
      if (made && opts.onCreated) opts.onCreated(made);
      if (previous && previous.focus) previous.focus();
    }
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });

    function field(id, label, props, hint) {
      var input = h('input', Object.assign({ id: id, type: 'text', autocomplete: 'off' }, props));
      return h('div', { class: 'field' }, [h('label', { for: id, text: label }), input, hint ? h('p', { class: 'field-hint', text: hint }) : null]);
    }

    function stepOne(operators) {
      clear(dialog);
      var status = h('p', { class: 'form-status', 'data-form-status': true, role: 'alert', 'aria-live': 'assertive' });
      var submit = h('button', { class: 'btn-small btn-small--brand', type: 'submit', text: 'Create client' });
      var cancel = h('button', { class: 'btn-small', type: 'button', text: 'Cancel' });
      cancel.addEventListener('click', close);

      var picks = h('fieldset', { class: 'dialog-picks' }, [h('legend', { text: 'Operators who will work on this client' })]);
      if (operators.length) {
        operators.forEach(function (op, i) {
          var id = 'cc-op-' + i;
          picks.appendChild(h('label', { class: 'dialog-pick', for: id }, [
            h('input', { type: 'checkbox', id: id, name: 'operatorIds', value: op.id }),
            h('span', { text: op.name })
          ]));
        });
      } else {
        picks.appendChild(h('p', { class: 'field-hint', text: 'No operators to assign. Masters already see every client.' }));
      }

      var form = h('form', { novalidate: true, class: 'login-form' }, [
        h('h2', { id: 'cc-title', tabindex: '-1', text: 'Create client' }),
        field('cc-name', 'Company name', { name: 'name', maxlength: '120', required: true }),
        h('p', { class: 'field-hint', text: 'First login for the client. Leave the email empty to add logins later.' }),
        field('cc-login-name', 'Contact name', { name: 'loginName', maxlength: '120' }),
        field('cc-login-email', 'Contact email', { name: 'loginEmail', type: 'email', autocapitalize: 'none', spellcheck: 'false' }),
        picks,
        status,
        h('div', { class: 'row-actions' }, [submit, cancel])
      ]);
      dialog.appendChild(form);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        submit.disabled = true;
        setStatus(status, '');
        form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
        var body = { name: form.elements.name.value };
        var email = form.elements.loginEmail.value.trim();
        if (email) body.login = { name: form.elements.loginName.value, email: email };
        body.operatorIds = Array.prototype.map.call(form.querySelectorAll('input[name="operatorIds"]:checked'), function (el) { return el.value; });

        api('POST', '/api/portal/admin/clients', body).then(function (data) {
          made = data.client;
          stepTwo(data);
        }, function (error) {
          var map = { email: 'loginEmail' };
          setStatus(status, error.message, 'error');
          var target = form.elements[map[error.field] || error.field];
          if (target) { target.setAttribute('aria-invalid', 'true'); target.focus(); }
        }).then(function () {
          form.dataset.busy = '0';
          submit.disabled = false;
        });
      });
      form.elements.name.focus();
    }

    function stepTwo(data) {
      clear(dialog);
      var login = data.login;
      var children = [h('h2', { id: 'cc-title', tabindex: '-1', text: data.client.name + ' is ready' })];
      var done = h('button', { class: 'btn-small btn-small--brand', type: 'button', text: 'Done' });
      done.addEventListener('click', close);

      if (login) {
        var text = [
          'Your Accessrank client portal',
          'Sign in: ' + window.location.origin + '/client-login',
          'Email: ' + login.user.email,
          'Password: ' + login.password,
          '',
          'You can choose your own password after signing in.'
        ].join('\n');
        var copied = h('span', { class: 'credential-copied', role: 'status', 'aria-live': 'polite' });
        var copy = h('button', { class: 'btn-small btn-small--brand', type: 'button', text: 'Copy sign-in details' });
        copy.addEventListener('click', function () {
          var ok = function () { copied.textContent = 'Copied.'; };
          var manual = function () { copied.textContent = 'Select the password above and copy it.'; };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, manual);
          else manual();
        });
        var mail = h('a', {
          class: 'btn-small',
          href: 'mailto:' + encodeURIComponent(login.user.email) + '?subject=' + encodeURIComponent('Your Accessrank client portal') + '&body=' + encodeURIComponent(text),
          text: 'Open an email'
        });
        children.push(
          h('div', { class: 'credential' }, [
            h('p', { class: 'credential-line' }, [h('span', { class: 'credential-label', text: 'Email' }), h('code', { text: login.user.email })]),
            h('p', { class: 'credential-line' }, [h('span', { class: 'credential-label', text: 'Password' }), h('code', { text: login.password })]),
            h('p', { class: 'credential-note', text: 'This password is shown once and can’t be looked up later. Send it to the client now.' })
          ]),
          h('div', { class: 'row-actions' }, [copy, mail, done, copied])
        );
      } else {
        children.push(h('p', { class: 'field-hint', text: 'The portal exists. Add the client’s logins from their page when you are ready.' }), h('div', { class: 'row-actions' }, [done]));
      }
      children.forEach(function (c) { dialog.appendChild(c); });
      dialog.querySelector('#cc-title').focus();
    }

    document.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    // The operator list is only needed for the assignment boxes; if it fails the dialog still works.
    api('GET', '/api/portal/operators').then(function (data) { return (data.operators || []).filter(function (op) { return op.role !== 'master'; }); }, function () { return []; }).then(stepOne);
  }

  /* --------------------------------------------------------------- boot --- */

  var views = {};
  var loginForm = document.querySelector('[data-portal-login]');
  var filesRoot = document.querySelector('[data-portal-files]');
  var adminRoot = document.querySelector('[data-portal-admin]');
  var operatorsRoot = document.querySelector('[data-portal-operators]');
  var clientViewRoot = document.querySelector('[data-portal-client-view]');
  var approvalsRoot = document.querySelector('[data-portal-approvals]');
  var repositoryRoot = document.querySelector('[data-portal-repository]');

  if (loginForm) views.login = initLogin(loginForm);
  if (filesRoot) views.files = initFiles(filesRoot);
  if (adminRoot) views.admin = initAdmin(adminRoot);
  if (operatorsRoot) views.operators = initOperators(operatorsRoot);
  if (clientViewRoot) views.clientView = initClientsList(clientViewRoot);
  if (approvalsRoot) views.approvals = initApprovals(approvalsRoot);
  if (repositoryRoot) views.repository = initRepository(repositoryRoot);

  A.portalTeam = initTeamNav();

  /** Reload one view's data (or all of them). */
  A.portal = {
    load: function (name) {
      Object.keys(views).forEach(function (key) { if (!name || name === key) views[key].load(); });
    }
  };

  if (A.portalAutoload !== false) A.portal.load();
}());
