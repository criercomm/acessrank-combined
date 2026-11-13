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
    node.classList.remove('is-error', 'is-success', 'is-working');
    if (message && kind) node.classList.add(kind === 'error' ? 'is-error' : kind === 'busy' ? 'is-working' : 'is-success');
  }

  /**
   * Show that a button was pressed and its work is under way: a spinner, a "…ing" label and
   * aria-busy. Returns the function that puts the button back. Works on a <label> upload button too.
   */
  function working(button, label) {
    if (!button) return function () {};
    var text = button.textContent;
    button.classList.add('is-working');
    button.setAttribute('aria-busy', 'true');
    if (label) button.textContent = label;
    return function () {
      button.classList.remove('is-working');
      button.removeAttribute('aria-busy');
      // Only put the old words back if nothing else has relabelled the button meanwhile.
      if (label && button.textContent === label) button.textContent = text;
    };
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
        // A label can be worked out at click time, when it depends on state that changes on the page.
        button.textContent = typeof confirmLabel === 'function' ? confirmLabel() : confirmLabel;
        button.className = 'btn-small btn-small--confirm';
        cancel = h('button', { type: 'button', class: 'btn-small', text: 'Cancel' });
        cancel.addEventListener('click', function () { disarm(); button.focus(); });
        button.insertAdjacentElement('afterend', cancel);
        return;
      }
      button.disabled = true;
      if (cancel) cancel.disabled = true;
      var settle = working(button, 'Working…');
      Promise.resolve().then(action).catch(function () { /* the action reports its own error */ }).then(function () {
        settle();
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

  /* ---- the team's notes on a file: add, edit and delete (clients only read them, see fileRowWithClientNotes) ---- */

  function noteButton(label, name, extra) {
    return h('button', { type: 'button', class: 'btn-small' + (extra ? ' ' + extra : ''), 'aria-label': name, text: label });
  }

  function noteMetaLine(note) {
    var who = note.authorName || note.authorEmail;
    var when = formatDateTime(note.createdAt) + (note.updatedAt ? ' (edited)' : '');
    return h('p', { class: 'note-meta', title: note.updatedAt ? 'Edited ' + formatDateTime(note.updatedAt) : null, text: (who ? who + ' \u00b7 ' : '') + when });
  }

  /** The "Notes (n)" label for one file and the panel that opens under it on hover: the notes, each with Edit and Delete, and an add field. */
  function editableNotes(file, status) {
    file.notes = file.notes || [];
    var count = h('span', { class: 'notes-count' });
    var list = h('ul', { class: 'note-list', 'aria-label': 'Notes on ' + file.name });
    var input = h('input', { type: 'text', class: 'note-add-input', maxlength: '2000', autocomplete: 'off', placeholder: 'Add a note\u2026', 'aria-label': 'Add a note to ' + file.name });
    var addButton = h('button', { type: 'submit', class: 'btn-small btn-small--brand', 'aria-label': 'Add note to ' + file.name, text: 'Add note' });
    var form = h('form', { class: 'note-add', novalidate: 'novalidate' }, [input, addButton]);
    var panel = h('div', { class: 'file-notes-panel' }, [list, form]);

    function refresh() {
      count.textContent = file.notes.length ? 'Notes (' + file.notes.length + ')' : 'Notes (none yet)';
      clear(list);
      file.notes.forEach(function (note) { list.appendChild(row(note)); });
    }

    function row(note) {
      var li = h('li', { class: 'note' });
      var edit = noteButton('Edit', 'Edit note');
      var remove = noteButton('Delete', 'Delete note');

      confirmable(remove, 'Delete note', function () {
        return api('DELETE', '/api/portal/admin/file-notes/' + encodeURIComponent(note.id)).then(function () {
          file.notes = file.notes.filter(function (n) { return n.id !== note.id; });
          refresh();
          setStatus(status, 'Note deleted.', 'success');
        }, function (error) { setStatus(status, error.message, 'error'); });
      });

      edit.addEventListener('click', function () {
        clear(li);
        li.classList.add('is-editing');
        var area = h('textarea', { class: 'note-edit', rows: '1', maxlength: '2000', 'aria-label': 'Edit note' });
        area.value = note.body;
        var save = noteButton('Save', 'Save note', 'btn-small--brand');
        var cancel = noteButton('Cancel', 'Cancel editing');
        function grow() { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; }
        function commit() {
          var body = area.value.trim();
          if (!body) { setStatus(status, 'Write a note first, or use Delete.', 'error'); area.focus(); return; }
          save.disabled = true;
          api('PATCH', '/api/portal/admin/file-notes/' + encodeURIComponent(note.id), { body: body }).then(function (data) {
            file.notes = file.notes.map(function (n) { return n.id === note.id ? data.note : n; });
            refresh();
            setStatus(status, 'Note saved.', 'success');
          }, function (error) { setStatus(status, error.message, 'error'); save.disabled = false; area.focus(); });
        }
        area.addEventListener('input', grow);
        area.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); refresh(); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        });
        save.addEventListener('click', commit);
        cancel.addEventListener('click', refresh);
        li.appendChild(area);
        li.appendChild(h('div', { class: 'note-edit-actions' }, [save, cancel]));
        grow();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });

      li.appendChild(h('div', { class: 'note-main' }, [h('p', { class: 'note-body', text: note.body }), noteMetaLine(note)]));
      li.appendChild(h('div', { class: 'note-actions' }, [edit, remove]));
      return li;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = input.value.trim();
      if (!body) { setStatus(status, 'Write a note first.', 'error'); input.focus(); return; }
      addButton.disabled = true;
      api('POST', '/api/portal/admin/files/' + encodeURIComponent(file.id) + '/notes', { body: body }).then(function (data) {
        file.notes.push(data.note);
        input.value = '';
        refresh();
        setStatus(status, 'Note added to ' + file.name + '.', 'success');
      }, function (error) { setStatus(status, error.message, 'error'); }).then(function () { addButton.disabled = false; input.focus(); });
    });

    refresh();
    return { count: count, panel: panel };
  }

  /** A file row with "Notes (n)" beside its details; the notes and the add-note field open under it on hover or keyboard focus. */
  function fileRowWithEditableNotes(file, actions, status) {
    var notes = editableNotes(file, status);
    var li = fileRow(file, actions);
    li.classList.add('has-notes');
    var meta = li.querySelector('.file-meta');
    if (meta) meta.appendChild(notes.count);
    li.appendChild(h('div', { class: 'file-notes-hover' }, [h('div', { class: 'file-notes-hover-inner' }, [notes.panel])]));
    return li;
  }

  /** The four sections a client sees: awaiting approval, compliance files, past approvals, other files. */
  /** The team's notes on a file, read-only, for the client. Nothing when the file has none. */
  function fileRowWithClientNotes(file, actions) {
    var li = fileRow(file, actions);
    var notes = file.notes || [];
    if (!notes.length) return li;
    var list = h('ul', { class: 'note-list', 'aria-label': 'Notes on ' + file.name });
    notes.forEach(function (note) {
      var who = note.authorName || 'Accessrank team';
      var when = formatDateTime(note.createdAt) + (note.updatedAt ? ' (edited)' : '');
      list.appendChild(h('li', { class: 'note' }, [h('div', { class: 'note-main' }, [
        h('p', { class: 'note-body', text: note.body }),
        h('p', { class: 'note-meta', text: who + ' \u00b7 ' + when })
      ])]));
    });
    li.classList.add('has-notes');
    // "Notes (n)" sits with the file's details; the notes themselves open under the file on hover or keyboard focus.
    var meta = li.querySelector('.file-meta');
    if (meta) meta.appendChild(h('span', { class: 'notes-count', text: 'Notes (' + notes.length + ')' }));
    li.appendChild(h('div', { class: 'file-notes-hover' }, [h('div', { class: 'file-notes-hover-inner' }, [list])]));
    return li;
  }

  function renderPortalSections(root, reports, allFiles, team) {
    var rowActions = function (file) { return team ? [team.deleteButton(file)] : []; };
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
    pastFiles.forEach(function (file) { pastList.appendChild(team ? fileRowWithEditableNotes(file, [], team.status) : fileRowWithClientNotes(file)); });
    var pastTotal = pastReports.length + pastFiles.length;
    root.querySelector('[data-past-section]').hidden = pastTotal === 0;
    root.querySelector('[data-past-count]').textContent = pastTotal ? plural(pastTotal, 'record') : '';

    var compliance = allFiles.filter(function (f) { return f.area === 'compliance'; });
    var complianceList = root.querySelector('[data-compliance-list]');
    clear(complianceList);
    compliance.forEach(function (file) { complianceList.appendChild(fileRow(file, rowActions(file))); });
    complianceList.hidden = compliance.length === 0;
    root.querySelector('[data-compliance-empty]').hidden = compliance.length > 0;
    root.querySelector('[data-compliance-count]').textContent = compliance.length ? plural(compliance.length, 'file') : '';

    var others = allFiles.filter(function (f) { return f.area !== 'compliance' && f.area !== 'approvals'; });

    var list = root.querySelector('[data-file-list]');
    var empty = root.querySelector('[data-files-empty]');
    var count = root.querySelector('[data-file-count]');
    clear(list);
    others.forEach(function (file) { list.appendChild(team ? fileRowWithEditableNotes(file, rowActions(file), team.status) : fileRowWithClientNotes(file, rowActions(file))); });
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

    var team = null;

    function render(data) {
      root.querySelector('[data-portal-client]').textContent = data.client.name;
      var user = root.querySelector('[data-portal-user]');
      clear(user);
      user.appendChild(document.createTextNode('Signed in as '));
      user.appendChild(h('strong', { text: data.user.email }));

      if (nudge) nudge.hidden = asMatch ? true : data.user.passwordSetBy !== 'admin';

      renderPortalSections(root, data.reports || [], data.files || [], team);
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
        h('span', { class: 'viewas-note', text: 'This is the client\u2019s page. You can add and delete files in Compliance files and Other files; everything else here is read-only.' }),
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

    /** Team only: Add files beside Compliance files and Other files, and Delete on each row there. */
    function mountTeamFileControls(client) {
      var maxBytes = 25 * 1024 * 1024;
      var busy = false;
      var queue = h('ul', { class: 'upload-queue', 'aria-live': 'polite' });
      var wrap = root.querySelector('.portal-wrap');
      wrap.insertBefore(queue, status.nextSibling);

      function rerender() { render(viewData(client, (root.querySelector('#viewas-login') || {}).value)); }

      function uploadOne(file, area) {
        var state_ = h('span', { class: 'upload-state', text: 'Uploading\u2026' });
        var row = h('li', {}, [h('span', { class: 'upload-name', text: file.name }), state_]);
        queue.appendChild(row);
        var reject = function (message) { row.className = 'is-error'; state_.textContent = message; return false; };
        if (file.size === 0) return Promise.resolve(reject('Empty file \u2014 skipped'));
        if (file.size > maxBytes) return Promise.resolve(reject('Over the ' + formatBytes(maxBytes) + ' limit \u2014 skipped'));
        var url = '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/files?name=' + encodeURIComponent(file.name) + '&area=' + encodeURIComponent(area);
        return api('POST', url, null, file).then(function (data) {
          client.files = client.files || [];
          client.files.unshift(data.file);
          row.className = 'is-done';
          state_.textContent = 'Added';
          rerender();
          return true;
        }, function (error) { return reject(error.message); });
      }

      function uploadFiles(files, area) {
        var batch = Array.prototype.slice.call(files || []);
        if (!batch.length) return;
        if (busy) { setStatus(status, 'Wait for the current upload to finish, then add more.', 'error'); return; }
        busy = true;
        clear(queue);
        var added = 0;
        batch.reduce(function (chain, file) {
          return chain.then(function () { return uploadOne(file, area); }).then(function (ok) { if (ok) added += 1; });
        }, Promise.resolve()).then(function () {
          busy = false;
          setStatus(status, 'Added ' + plural(added, 'file') + ' to ' + (area === 'compliance' ? 'Compliance files' : 'Other files') + '.', added ? 'success' : 'error');
        });
      }

      [['compliance-heading', 'compliance', 'Add compliance files'], ['files-heading', 'files', 'Add other files']].forEach(function (cfg) {
        var heading = root.querySelector('#' + cfg[0]);
        var head = heading && heading.parentNode;
        if (!head) return;
        var id = 'team-upload-' + cfg[1];
        var input = h('input', { class: 'visually-hidden', type: 'file', id: id, multiple: 'multiple' });
        input.addEventListener('change', function () { uploadFiles(input.files, cfg[1]); input.value = ''; });
        head.appendChild(h('label', { class: 'btn-small upload-button', for: id, text: 'Add files', 'aria-label': cfg[2] }));
        head.appendChild(input);
      });

      team = {
        status: status,
        deleteButton: function (file) {
          var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Delete ' + file.name, text: 'Delete' });
          confirmable(remove, 'Confirm delete', function () {
            return api('DELETE', '/api/portal/admin/files/' + encodeURIComponent(file.id)).then(function () {
              client.files = (client.files || []).filter(function (f) { return f.id !== file.id; });
              rerender();
              setStatus(status, 'Deleted ' + file.name + '.', 'success');
            }).catch(function (error) { setStatus(status, error.message, 'error'); });
          });
          return remove;
        }
      };
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
        mountTeamFileControls(client);
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

    /** Owners only: Delete on each row. Two steps (Delete, then Confirm), the same as on the client's own page; removes the client, its logins and its files. */
    function deleteButton(c) {
      var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Delete ' + c.name, text: 'Delete' });
      confirmable(remove, 'Confirm: delete client, logins and files', function () {
        return api('DELETE', '/api/portal/admin/clients/' + encodeURIComponent(c.id)).then(function () {
          state.clients = state.clients.filter(function (x) { return x.id !== c.id; });
          render();
          setStatus(status, 'Deleted ' + c.name + ', its logins and its files.', 'success');
        }).catch(function (error) {
          if (error.code === 'signed_out') return;
          setStatus(status, error.message, 'error');
        });
      });
      return remove;
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
        var actions = [h('a', { class: 'btn-small', href: '/portal/client#client=' + encodeURIComponent(c.id), 'aria-label': 'Open ' + c.name, text: 'Open' })];
        if (state.master) actions.push(deleteButton(c));
        cells.push(h('td', {}, [h('div', { class: 'row-actions' }, actions)]));
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

  /* ------------------------------------------------ work to do and the ACR --- */

  var CONFORMANCE = [
    ['', 'Not part of the conformance table'],
    ['supports', 'Supports'],
    ['partially_supports', 'Partially supports'],
    ['does_not_support', 'Does not support'],
    ['not_applicable', 'Not applicable']
  ];
  var CONFORMANCE_TEXT = {};
  CONFORMANCE.forEach(function (c) { if (c[0]) CONFORMANCE_TEXT[c[0]] = c[1]; });

  function saveWork(report, item, body) {
    return api('PUT', '/api/portal/admin/reports/' + encodeURIComponent(report.id) + '/work/' + encodeURIComponent(item.key), body)
      .then(function (data) { item.work = data.work; return data.work; });
  }

  /**
   * The dialog shown when an item is ticked as done: what goes into the ACR, plus the optional
   * conformance entry and team note. Resolves with the saved work, or null when the tick is cancelled.
   */
  function openWorkDialog(report, item, trigger) {
    return new Promise(function (resolve) {
      var draft = report.acrDraft;
      var w = item.work || {};
      var id = 'work-' + report.id.slice(0, 8) + '-' + item.key;
      var status = h('p', { class: 'form-status', role: 'alert', 'aria-live': 'assertive' });
      var select = h('select', { id: id + '-conf', name: 'conformance' }, CONFORMANCE.map(function (c) {
        return h('option', { value: c[0], text: c[1], selected: (w.conformance || '') === c[0] });
      }));
      var criterion = h('input', { type: 'text', id: id + '-crit', name: 'criterion', maxlength: '200', autocomplete: 'off', placeholder: 'e.g. 1.1.1 Non-text Content (A)', value: w.criterion || '' });
      var note = h('textarea', { id: id + '-note', name: 'note', rows: '2', maxlength: '2000', placeholder: 'e.g. Checked with VoiceOver on iPhone' });
      note.value = w.note || '';
      var answer = (DECISION_TEXT[item.decision] || item.decision) + (item.choice ? ': ' + item.choice : '');
      // A typed answer (a contact name, a phone number) is information, not a change to the site.
      // The record states it already, so for those the safe choice is the first button.
      var infoOnly = item.decision === 'comment';
      var add = draft ? h('button', { type: 'button', class: 'btn-small' + (infoOnly ? '' : ' btn-small--brand'), text: 'Add to ACR update' }) : null;
      var later = h('button', { type: 'button', class: 'btn-small' + (infoOnly ? ' btn-small--brand' : ''), text: infoOnly ? 'Done, keep out of the ACR' : 'Done, not in ACR yet' });
      var cancel = h('button', { type: 'button', class: 'btn-small', text: 'Cancel, it is not live' });
      var dialog = h('dialog', { class: 'team-dialog work-dialog', 'aria-labelledby': id + '-title' }, [
        h('h2', { id: id + '-title', tabindex: '-1', text: 'Update the ACR for this item?' }),
        h('p', { class: 'work-dialog-item' }, [h('strong', { text: item.title || item.key })]),
        h('p', { class: 'file-meta' }, [h('span', { text: answer + ' · ' + item.signerName + (item.decidedAt || item.savedAt ? ', ' + formatDate(item.decidedAt || item.savedAt) : '') })]),
        item.comment ? h('p', { class: 'approval-comment', text: (item.decision === 'changes' ? 'Change requested: ' : item.decision === 'comment' ? 'Answer: ' : 'Client comment: ') + item.comment }) : null,
        h('div', { class: 'work-fields' }, [
          h('div', { class: 'field' }, [h('label', { for: id + '-crit', text: 'WCAG criterion (optional)' }), criterion]),
          h('div', { class: 'field' }, [h('label', { for: id + '-conf', text: 'Conformance after this change' }), select])
        ]),
        h('div', { class: 'field' }, [h('label', { for: id + '-note', text: 'Team note for the ACR (optional)' }), note]),
        h('p', { class: 'field-hint', text: draft
          ? 'Applied to ' + draft.name + ', uploaded ' + formatDate(draft.createdAt) + '.'
          : 'This client has no ACR draft yet, so nothing can be added to the ACR. Upload the draft at the top of Work to do, then use “Add to ACR update” on this item.' }),
        infoOnly ? h('p', { class: 'field-hint', text: 'This is an answer the client typed, not a change to the site. The ACR draft should already state it, so leave it out of the update unless it belongs in the remediation log.' }) : null,
        status,
        h('div', { class: 'row-actions' }, infoOnly || !draft ? [later, add, cancel] : [add, later, cancel])
      ]);
      var settled = false;
      function close(result) {
        if (settled) return;
        settled = true;
        if (dialog.open && dialog.close) dialog.close();
        dialog.remove();
        if (trigger && trigger.focus) trigger.focus();
        resolve(result);
      }
      function save(queue) {
        if (add) add.disabled = true;
        later.disabled = true;
        var settle = working(queue ? add : later, 'Saving…');
        setStatus(status, 'Saving…', 'busy');
        saveWork(report, item, { done: true, queue: queue, criterion: criterion.value, conformance: select.value, note: note.value })
          .then(close, function (error) {
            settle();
            if (add) add.disabled = false;
            later.disabled = false;
            setStatus(status, error.message, 'error');
          });
      }
      if (add) add.addEventListener('click', function () { save(true); });
      later.addEventListener('click', function () { save(false); });
      cancel.addEventListener('click', function () { close(null); });
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(null); });
      document.body.appendChild(dialog);
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('h2').focus();
    });
  }

  /** The Work to do list for one report: every answered item with a "done and live" tick. */
  function workPanel(report, onProgress) {
    var wrap = h('div', { class: 'work-panel', hidden: true });
    var summary = h('p', { class: 'work-progress', 'aria-live': 'polite' });
    var bar = h('span', { class: 'work-bar-fill' });
    var list = h('ul', { class: 'work-list' });
    wrap.appendChild(h('div', { class: 'work-head' }, [
      summary,
      h('a', { class: 'work-acr-link', href: '/portal/client#client=' + encodeURIComponent(report.clientId) + '&acr', text: 'ACR for ' + report.clientName })
    ]));
    wrap.appendChild(h('div', { class: 'work-bar', 'aria-hidden': 'true' }, [bar]));
    // Step 1 is the ACR draft: nothing can be added to the ACR without one, so it comes first.
    var gate = null;
    if (!report.acrDraft) {
      var gateId = 'gate-' + report.id.slice(0, 8);
      var gateInput = h('input', { class: 'visually-hidden', type: 'file', id: gateId, accept: '.html,.htm,.pdf,.docx,.doc,.odt,.rtf' });
      var gateStatus = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
      gate = h('div', { class: 'work-gate' }, [
        h('p', { text: 'Step 1: upload the ACR draft for ' + report.clientName + '.' }),
        h('p', { class: 'field-hint', text: 'Changes can only be added to the ACR once there is a draft to add them to. Upload it as its HTML page, prepared from the ACR template.' }),
        h('div', { class: 'row-actions' }, [h('label', { class: 'btn-small btn-small--brand upload-button', for: gateId, text: 'Upload ACR draft' }), gateInput]),
        gateStatus
      ]);
      gateInput.addEventListener('change', function () {
        var file = gateInput.files && gateInput.files[0];
        if (!file) return;
        var gateLabel = gate.querySelector('label');
        var settle = working(gateLabel, 'Uploading…');
        setStatus(gateStatus, 'Uploading ' + file.name + '…', 'busy');
        api('POST', '/api/portal/admin/clients/' + encodeURIComponent(report.clientId) + '/acr/drafts?name=' + encodeURIComponent(file.name), null, file)
          .then(function (data) {
            report.acrDraft = data.draft;
            var w = data.draft && data.draft.warnings;
            var done = h('div', { class: 'work-gate' }, [
              h('p', { text: file.name + ' is the ACR draft for ' + report.clientName + '.' }),
              w && w.length ? h('p', { class: 'field-hint acr-flag', text: 'Check before building: ' + w.join(' ') }) : null
            ]);
            gate.replaceWith(done);
            gate = done;
            render();
          }, function (error) { settle(); setStatus(gateStatus, error.message, 'error'); gateInput.value = ''; });
      });
      wrap.appendChild(gate);
    }
    wrap.appendChild(h('p', { class: 'field-hint', text: 'Tick an item only when the change is live on the store, not just finished in a test theme.' }));
    wrap.appendChild(list);
    // The next step, once something is queued: build the ACR update on the client's page.
    var acrHref = '/portal/client#client=' + encodeURIComponent(report.clientId) + '&acr';
    var nextText = h('span', {});
    var next = h('div', { class: 'work-next', hidden: true }, [
      nextText,
      h('a', { class: 'btn-small btn-small--brand', href: acrHref, text: 'Go to ACR update' })
    ]);
    wrap.appendChild(next);

    function count() {
      var queued = report.items.filter(function (i) { return i.work && i.work.acrState === 'queued'; }).length;
      next.hidden = queued === 0;
      nextText.textContent = plural(queued, 'change') + ' waiting in ' + report.clientName + '\u2019s ACR update. Next: build the updated ACR, check it, then publish it to the client.';
      var done = report.items.filter(function (i) { return i.work && i.work.done; }).length;
      summary.textContent = done + ' of ' + report.items.length + ' done';
      bar.style.width = (report.items.length ? (done / report.items.length) * 100 : 0) + '%';
      if (onProgress) onProgress(done, report.items.length);
    }

    function row(item) {
      var w = item.work || {};
      var id = 'done-' + report.id.slice(0, 8) + '-' + item.key;
      var box = h('input', { type: 'checkbox', id: id, checked: !!w.done });
      var answer = (DECISION_TEXT[item.decision] || item.decision) + (item.choice ? ': ' + item.choice : '');
      var stateText = !w.done ? '' : w.acrState === 'queued' ? 'In ACR update' : w.acrState === 'applied' ? 'In published ACR' : 'Done';
      var side = h('div', { class: 'work-side' }, w.done ? [
        h('span', { class: 'work-badge work-badge--' + (w.acrState || 'none'), text: stateText }),
        h('span', { class: 'file-meta', text: 'Live ' + formatDate(w.doneAt) + (w.doneByName ? ' · ' + w.doneByName : '') }),
        w.acrState === 'none' && report.acrDraft ? h('button', { type: 'button', class: 'link-button', text: 'Add to ACR update', 'data-add-acr': true }) : null
      ] : [h('span', { class: 'file-meta', text: 'Done and live on the store' })]);
      var li = h('li', { class: 'work-row' + (w.done ? ' is-done' : '') }, [
        box,
        h('label', { for: id }, [
          h('span', { class: 'work-title', text: item.title || item.key }),
          h('span', { class: 'file-meta', text: answer + ' · ' + item.signerName + (item.decidedAt || item.savedAt ? ', ' + formatDate(item.decidedAt || item.savedAt) : '') }),
          item.comment ? h('span', { class: 'work-comment', text: (item.decision === 'changes' ? 'Change requested: ' : item.decision === 'comment' ? 'Answer: ' : 'Client comment: ') + item.comment }) : null,
          w.done && (w.criterion || w.conformance) ? h('span', { class: 'file-meta', text: (w.criterion || 'Criterion not given') + (w.conformance ? ' → ' + CONFORMANCE_TEXT[w.conformance] : '') }) : null,
          w.done && w.note ? h('span', { class: 'file-meta', text: 'Team note: ' + w.note }) : null
        ]),
        side
      ]);
      box.addEventListener('change', function () {
        if (box.checked) {
          openWorkDialog(report, item, box).then(function (saved) { if (!saved) box.checked = false; render(); });
        } else {
          box.disabled = true;
          saveWork(report, item, { done: false }).then(render, function (error) { box.checked = true; box.disabled = false; alertError(error); });
        }
      });
      var addAcr = li.querySelector('[data-add-acr]');
      if (addAcr) addAcr.addEventListener('click', function () { openWorkDialog(report, item, addAcr).then(render); });
      return li;
    }

    function alertError(error) { summary.textContent = error.message; }

    function render() {
      clear(list);
      report.items.forEach(function (item) { list.appendChild(row(item)); });
      count();
    }

    render();
    return wrap;
  }

  /** The ACR section on a client's page: the draft, the queued changes, build and publish. */
  function initAcrSection(root, getClient, notify) {
    var section = root.querySelector('[data-acr]');
    if (!section) return { load: function () {} };
    var draftBox = section.querySelector('[data-acr-draft]');
    var history = section.querySelector('[data-acr-history]');
    var queueList = section.querySelector('[data-acr-queue]');
    var queueEmpty = section.querySelector('[data-acr-queue-empty]');
    var queueCount = section.querySelector('[data-acr-count]');
    var build = section.querySelector('[data-acr-build]');
    var draftInput = section.querySelector('[data-acr-draft-input]');
    var publishInput = section.querySelector('[data-acr-publish-input]');
    var status = section.querySelector('[data-acr-status]');
    var publishMerge = section.querySelector('[data-acr-publish-merge]');
    var publishUpload = section.querySelector('[data-acr-publish-upload]');
    var hint = section.querySelector('[data-acr-hint]');
    var stepsList = section.querySelector('[data-acr-steps]');
    var previewBox = section.querySelector('[data-acr-preview]');
    var closeBox = section.querySelector('[data-acr-close]');
    var busy = false;
    var current = null;
    var published = null; // { version, reports: [{ id, title }] } after a publish on this page

    // Publish stays off until the current queue has been built and checked. The queue's fingerprint
    // is remembered per client when Build is clicked; any change to the queue or the draft resets it.
    function queueSignature(acr) {
      var d = acr.drafts[0];
      return (d ? d.id : '') + '#' + acr.queue.map(function (w) { return w.reportId + '|' + w.key + '|' + w.doneAt; }).join(',');
    }
    function builtKey(acr) { return 'acr-built-' + acr.client.id; }
    function readBuilt(acr) { try { return window.localStorage.getItem(builtKey(acr)); } catch (e) { return null; } }
    function writeBuilt(acr) { try { window.localStorage.setItem(builtKey(acr), queueSignature(acr)); } catch (e) { /* storage off: Publish stays on after Build in this tab only */ } builtHere = queueSignature(acr); }
    var builtHere = null;
    function isBuilt(acr) { var sig = queueSignature(acr); return acr.queue.length > 0 && (readBuilt(acr) === sig || builtHere === sig); }

    function renderSteps(acr, merge) {
      var hasDraft = Boolean(acr.drafts[0]);
      var queued = acr.queue.length > 0;
      var built = merge ? isBuilt(acr) : queued;
      var steps = [
        ['Upload the ACR draft', hasDraft],
        ['Queue changes that are live', queued || Boolean(published)],
        [merge ? 'Build and check' : 'Build the change list', built || Boolean(published)],
        ['Publish to client', Boolean(published)],
        ['Close the approval', Boolean(published) && !published.reports.length]
      ];
      var next = -1;
      steps.forEach(function (s, i) { if (next < 0 && !s[1]) next = i; });
      clear(stepsList);
      steps.forEach(function (s, i) {
        var state = s[1] ? 'done' : i === next ? 'next' : '';
        stepsList.appendChild(h('li', { class: state ? 'is-' + state : '', 'aria-current': state === 'next' ? 'step' : null }, [
          h('span', { text: s[0] }),
          state ? h('span', { class: 'acr-step-state visually-hidden', text: state === 'done' ? '(done)' : '(next)' }) : null
        ]));
      });
    }

    function renderPreview(acr, merge) {
      clear(previewBox);
      previewBox.hidden = true;
      if (!merge || !acr.queue.length) return;
      var client = acr.client;
      api('GET', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/acr/preview').then(function (data) {
        var p = data.preview;
        if (!p || !p.mergeable || current !== acr) return;
        var items = p.items.map(function (it) {
          return h('li', {}, [
            h('span', { text: it.title + (it.places ? ' (completes ' + plural(it.places, 'place') + ' in the draft)' : '') }),
            it.flags.length ? h('span', { class: 'acr-flag', text: ' ' + it.flags.join(' ') }) : null
          ]);
        });
        previewBox.appendChild(h('p', { text: 'Build will issue Version ' + p.version + ' from ' + p.draftName + '. It adds ' + plural(p.items.length, 'row') + ' to the remediation log:' }));
        previewBox.appendChild(h('ul', {}, items));
        p.notes.forEach(function (n) { previewBox.appendChild(h('p', { class: 'acr-flag', text: n })); });
        if (p.items.some(function (it) { return it.flags.length; })) {
          previewBox.appendChild(h('p', { class: 'field-hint', text: 'Use “Take out of this update” on any item that should not become a log row.' }));
        }
        previewBox.hidden = false;
      }, function () { /* the preview is a help, not a gate */ });
    }

    function renderClose() {
      clear(closeBox);
      closeBox.hidden = !published || !published.reports.length;
      if (closeBox.hidden) return;
      closeBox.appendChild(h('p', { text: 'Last step: close the approval, so it moves to Past approvals.' }));
      var buttons = published.reports.map(function (r) {
        var b = h('button', { type: 'button', class: 'btn-small btn-small--brand', text: 'Close ' + r.title });
        b.addEventListener('click', function () {
          b.disabled = true;
          api('PATCH', '/api/portal/admin/reports/' + encodeURIComponent(r.id), { status: 'closed' }).then(function () {
            published.reports = published.reports.filter(function (x) { return x.id !== r.id; });
            setStatus(status, r.title + ' moved to past approvals.', 'success');
            if (notify) notify();
            renderClose();
            if (current) renderSteps(current, Boolean(current.drafts[0] && current.drafts[0].mergeable));
          }, function (error) { b.disabled = false; setStatus(status, error.message, 'error'); });
        });
        return b;
      });
      closeBox.appendChild(h('div', { class: 'row-actions' }, buttons));
    }

    function draftLink(d) {
      return h('a', { href: '/api/portal/admin/acr-drafts/' + encodeURIComponent(d.id), text: d.name });
    }

    function render(acr) {
      clear(draftBox);
      var d = acr.drafts[0];
      if (d) {
        draftBox.appendChild(h('p', { class: 'acr-draft-name' }, [draftLink(d)]));
        draftBox.appendChild(h('p', { class: 'file-meta', text: (d.published ? 'Published to client ' : 'Uploaded ') + formatDate(d.createdAt) + (d.uploadedByName ? ' by ' + d.uploadedByName : '') }));
      } else {
        draftBox.appendChild(h('p', { class: 'portal-empty', text: 'No ACR draft yet. Upload the latest ACR so finished work can be added to it.' }));
      }
      clear(history);
      acr.drafts.slice(1, 6).forEach(function (old, i) {
        history.appendChild(h('li', {}, [draftLink(old), h('span', { class: 'file-meta', text: ' · ' + formatDate(old.createdAt) + (old.published ? ' · published' : '') })]));
      });
      history.hidden = acr.drafts.length < 2;

      clear(queueList);
      acr.queue.forEach(function (w) {
        var answer = (DECISION_TEXT[w.decision] || w.decision) + (w.choice ? ': ' + w.choice : '');
        queueList.appendChild(h('li', {}, [
          h('p', { class: 'approval-item-title' }, [h('strong', { text: w.title })]),
          w.reportTitle ? h('p', { class: 'file-meta', text: 'From ' + w.reportTitle }) : null,
          h('p', { class: 'file-meta', text: answer + (w.comment ? ' · “' + w.comment + '”' : '') }),
          w.criterion || w.conformance ? h('p', { class: 'file-meta', text: (w.criterion || 'Criterion not given') + (w.conformance ? ' → ' + CONFORMANCE_TEXT[w.conformance] : '') }) : null,
          h('p', { class: 'file-meta', text: 'Live ' + formatDate(w.doneAt) + (w.doneByName ? ' · ' + w.doneByName : '') + (w.note ? ' · ' + w.note : '') }),
          h('button', { type: 'button', class: 'link-button', text: 'Take out of this update', 'aria-label': 'Take ' + w.title + ' out of this update', 'data-acr-unqueue': w.reportId + '|' + w.key })
        ]));
      });
      queueList.hidden = !acr.queue.length;
      queueEmpty.hidden = acr.queue.length > 0;
      queueCount.textContent = acr.queue.length ? '(' + acr.queue.length + ')' : '';
      // A button, not a link: the address needs the client id, and a placeholder href trips the link check.
      build.setAttribute('data-href', '/api/portal/admin/clients/' + encodeURIComponent(acr.client.id) + '/acr/update');
      build.disabled = !acr.queue.length;
      // An HTML draft is merged on the server: Build downloads the updated ACR, and Publish needs no upload.
      var merge = Boolean(d && d.mergeable);
      current = acr;
      build.textContent = merge ? 'Build updated ACR' : 'Build ACR update';
      publishMerge.hidden = !merge;
      publishMerge.disabled = !acr.queue.length || !isBuilt(acr);
      publishUpload.hidden = merge;
      hint.textContent = !d
        ? 'Upload the ACR draft first. Upload it as its HTML page and Build merges the queued changes into it; a PDF or Word draft gets a list of changes to apply by hand.'
        : merge
        ? (acr.queue.length && !isBuilt(acr) ? 'Build and check the ACR first: Publish turns on once you have built the current queue. ' : '') + 'Build updated ACR downloads the draft with every queued change merged in, as a PDF with the next version number. Check it, then Publish to client: the PDF (fonts embedded) and the HTML page both go to the client’s Compliance files, the merged version becomes the new draft, and the queued changes are marked as applied.'
        : 'This draft is not HTML, so Build ACR update downloads the queued changes as a dated PDF to apply by hand. Publish to client takes the updated ACR file: it goes to the client’s Compliance files, becomes the new draft, and the queued changes are marked as applied.';
      renderSteps(acr, merge);
      renderPreview(acr, merge);
      renderClose();
    }

    var loadedFor = null;
    function load() {
      var client = getClient();
      if (!client) return Promise.resolve();
      if (loadedFor !== client.id) { published = null; builtHere = null; loadedFor = client.id; }
      return api('GET', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/acr').then(render, function (error) {
        setStatus(status, error.message, 'error');
      });
    }

    function upload(input, path, done) {
      var file = input.files && input.files[0];
      var client = getClient();
      if (!file || !client || busy) return;
      busy = true;
      var settle = working(section.querySelector('label[for="' + input.id + '"]'), 'Uploading…');
      setStatus(status, 'Uploading ' + file.name + '…', 'busy');
      api('POST', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + path + '?name=' + encodeURIComponent(file.name), null, file)
        .then(function (data) { settle(); setStatus(status, done(file, data), 'success'); return load(); })
        .catch(function (error) { settle(); setStatus(status, error.message, 'error'); })
        .then(function () { busy = false; input.value = ''; });
    }

    // Taking an item out keeps it ticked as done and live; it just stays out of the ACR.
    queueList.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-acr-unqueue]') : null;
      if (!btn || busy) return;
      var parts = btn.getAttribute('data-acr-unqueue').split('|');
      busy = true;
      btn.disabled = true;
      var settle = working(btn, 'Taking out…');
      setStatus(status, 'Taking it out of this update…', 'busy');
      api('PUT', '/api/portal/admin/reports/' + encodeURIComponent(parts[0]) + '/work/' + encodeURIComponent(parts[1]), { done: true, queue: false })
        .then(function () { setStatus(status, 'Taken out of this update. It stays ticked as done and live.', 'success'); return load(); })
        .catch(function (error) { settle(); setStatus(status, error.message, 'error'); btn.disabled = false; })
        .then(function () { busy = false; });
    });

    // The file is fetched here, not opened as a link, so the page can show that Build is working
    // (printing the PDF takes a while) and say so when the download is ready or has failed.
    function fetchFile(href) {
      return fetch(href, { credentials: 'same-origin', headers: { Accept: 'application/pdf, application/json' } }).then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            var error = new Error(data.error || 'The ACR could not be built. Please try again.');
            error.code = data.code;
            if (error.code === 'signed_out') go('/client-login');
            throw error;
          });
        }
        var header = response.headers.get('Content-Disposition') || '';
        var star = header.match(/filename\*=UTF-8''([^;]+)/i);
        var plain = header.match(/filename="?([^";]+)"?/i);
        var name = 'ACR update.pdf';
        try { name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : name; } catch (e) { /* keep the fallback name */ }
        return response.blob().then(function (blob) { return { blob: blob, name: name }; });
      }, function () {
        throw new Error('We couldn’t reach the server. Check your connection and try again.');
      });
    }
    function saveFile(file) {
      var url = URL.createObjectURL(file.blob);
      var link = h('a', { href: url, download: file.name, hidden: true });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    build.addEventListener('click', function () {
      var href = build.getAttribute('data-href');
      if (!href || build.disabled || busy) return;
      var acr = current;
      var merge = Boolean(acr && acr.drafts[0] && acr.drafts[0].mergeable);
      busy = true;
      build.disabled = true;
      var settle = working(build, 'Building…');
      setStatus(status, merge ? 'Building the ACR. This can take up to a minute; the PDF downloads when it is ready.' : 'Building the list of changes…', 'busy');
      fetchFile(href).then(function (file) {
        saveFile(file);
        settle();
        if (acr && current === acr) {
          writeBuilt(acr);
          publishMerge.disabled = !acr.queue.length;
          renderSteps(acr, merge);
        }
        setStatus(status, file.name + ' downloaded. ' + (merge ? 'Open it and check it, then Publish to client.' : 'Apply the changes by hand, then Publish to client.'), 'success');
      }).catch(function (error) {
        settle();
        setStatus(status, error.message, 'error');
      }).then(function () {
        busy = false;
        build.disabled = !(current && current.queue.length);
      });
    });
    draftInput.addEventListener('change', function () {
      upload(draftInput, '/acr/drafts', function (file, data) {
        var w = data && data.draft && data.draft.warnings;
        return file.name + ' is the new ACR draft. Queued changes apply to it.' + (w && w.length ? ' Check before building: ' + w.join(' ') : '');
      });
    });
    publishMerge.addEventListener('click', function () {
      var client = getClient();
      if (!client || busy || publishMerge.disabled) return;
      busy = true;
      publishMerge.disabled = true;
      var settle = working(publishMerge, 'Publishing…');
      setStatus(status, 'Merging and publishing the ACR. This can take up to a minute…', 'busy');
      var seen = {};
      var reports = (current ? current.queue : []).filter(function (w) {
        if (!w.reportId || seen[w.reportId]) return false;
        seen[w.reportId] = true;
        return true;
      }).map(function (w) { return { id: w.reportId, title: w.reportTitle || 'the approval' }; });
      api('POST', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/acr/publish')
        .then(function (data) {
          settle();
          published = { version: data.version, reports: reports };
          if (notify) notify();
          setStatus(status, 'Version ' + data.version + ' published to the client’s Compliance files as ' + data.file.name + (data.htmlFile ? ' and ' + data.htmlFile.name : '') + '. ' + plural(data.applied, 'queued change') + ' marked as applied.', 'success');
          return load();
        })
        .catch(function (error) { settle(); setStatus(status, error.message, 'error'); publishMerge.disabled = !(current && current.queue.length); })
        .then(function () { busy = false; });
    });
    publishInput.addEventListener('change', function () {
      upload(publishInput, '/acr/publish', function (file, data) {
        if (notify) notify();
        return file.name + ' published to the client’s Compliance files. ' + plural(data.applied, 'queued change') + ' marked as applied.';
      });
    });

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

    var workMeta = h('span', {});
    var work = workPanel(report, function (done, total) { workMeta.textContent = done + ' of ' + total + ' done'; });
    var workToggle = h('button', { type: 'button', class: 'btn-small', 'aria-expanded': 'false', 'aria-label': 'Work to do: ' + report.title, text: 'Work to do', disabled: !report.items.length });
    workToggle.addEventListener('click', function () {
      var open = work.hidden;
      work.hidden = !open;
      workToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var record = h('a', { class: 'more-item', href: '/api/portal/reports/' + encodeURIComponent(report.id) + '/record', text: 'Download record' });
    var view = h('a', { class: 'more-item', href: '/portal/report/' + encodeURIComponent(report.id), text: closed ? 'View report' : 'Preview report' });
    var toggleState = h('button', { type: 'button', class: 'more-item', text: closed ? 'Reopen approval' : 'Close approval' });
    // Closing first and publishing later is allowed, but it is easy to forget the publish: say so.
    function closeLabel() {
      var unpublished = report.items.filter(function (i) { return i.work && i.work.acrState === 'queued'; }).length;
      return unpublished ? 'Confirm: move to past with ' + plural(unpublished, 'change') + ' not yet published in the ACR' : 'Confirm: move to past';
    }
    confirmable(toggleState, closed ? 'Confirm: reopen' : closeLabel, function () {
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
            report.progress && report.progress.lastAt ? h('span', { text: 'Last answered ' + formatDateTime(report.progress.lastAt) }) : null,
            report.items.length ? workMeta : null
          ])
        ]),
        h('div', { class: 'row-actions' }, [toggle, workToggle, more])
      ]),
      answers,
      work
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

  /* ----------------------------------------------------- activity log --- */

  /**
   * The client's activity log: the running, append-only record of the engagement. Operators add
   * the things only a person knows (a theme was published, a manual test was run); agents and the
   * portal add the rest through the same API.
   */
  function initActivitySection(root, getClient) {
    var section = root.querySelector('[data-activity]');
    if (!section) return { load: function () {} };
    var form = section.querySelector('[data-activity-form]');
    var formHeading = section.querySelector('#activity-form-heading');
    var kind = form.querySelector('[name="kind"]');
    var date = form.querySelector('[name="happenedOn"]');
    var title = form.querySelector('[name="title"]');
    var details = form.querySelector('[name="details"]');
    var corrects = form.querySelector('[name="correctsId"]');
    var fileInput = form.querySelector('[data-activity-file]');
    var fileHint = section.querySelector('[data-activity-file-hint]');
    var titleLabel = section.querySelector('[data-activity-title-label]');
    var titleHint = section.querySelector('[data-activity-title-hint]');
    var fixField = section.querySelector('[data-activity-fixes-field]');
    var fixList = section.querySelector('[data-activity-fix-list]');
    var stand = section.querySelector('[data-activity-stand]');
    var fixesLine = section.querySelector('[data-activity-fixes]');
    var needs = section.querySelector('[data-activity-needs]');
    var context = section.querySelector('[data-activity-context]');
    var list = section.querySelector('[data-activity-list]');
    var empty = section.querySelector('[data-activity-empty]');
    var count = section.querySelector('[data-activity-count]');
    var filter = section.querySelector('[data-activity-filter]');
    var csv = section.querySelector('[data-activity-csv]');
    var attach = section.querySelector('[data-activity-attach]');
    var status = section.querySelector('[data-activity-status]');
    var entries = [];
    var maxFileBytes = 25 * 1024 * 1024;
    var attachTo = null;       // the entry the shared file picker is attaching to
    var wantFixes = null;      // fix ids to tick when the form is next set to a manual test

    // What the one-line field asks for, and the best file to attach, by kind.
    var PROMPTS = {
      publish: ['Theme name', 'The name of the theme that is now live, as Shopify shows it.',
        'Best: a PNG screenshot of the Shopify Themes page showing the live theme.'],
      manual_test: ['What was tested', 'For example: Keyboard only, home page to cart.',
        'Best: a PDF of the test notes, or a PNG screenshot of what was found.'],
      note: ['Note', 'Anything the record should keep: a call, a decision, a date agreed.',
        'Best: a PDF, or a PNG screenshot, of whatever backs the note up.'],
      correction: ['What is wrong, and what is right', 'The entry you choose stays in the log, marked as corrected.',
        'Best: a PDF, or a PNG screenshot, that shows the right facts.']
    };
    var FILE_RULE = ' One file, up to {max}: JSON, PDF, PNG, JPG, WebP, HTML, CSV, XLSX or TXT.';
    var FILTERS = {
      test: function (e) { return e.kind === 'verify' || e.kind === 'manual_test'; },
      portal: function (e) { return e.source === 'portal'; },
      note: function (e) { return e.kind === 'note' || e.kind === 'correction'; }
    };
    function day(v) { return formatDate(v + 'T12:00:00'); }
    function localToday() {
      var d = new Date();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    function count1(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // Fixes a manual test can cover: live ones that are not yet passed.
    function testable() {
      return entries.filter(function (e) { return e.kind === 'fix' && (e.state === 'manual_pending' || e.state === 'awaiting_retest' || e.state === 'failed'); });
    }
    function renderFixChoices() {
      var fixes = testable();
      fixList.textContent = '';
      fixes.forEach(function (e, i) {
        var id = 'activity-fix-' + i;
        var box = h('input', { type: 'checkbox', id: id, name: 'fixIds', value: e.id });
        if (wantFixes && wantFixes.indexOf(e.id) !== -1) box.checked = true;
        fixList.appendChild(h('div', { class: 'field-check' }, [box, h('label', { for: id, text: e.title + ' (' + e.stateLabel.toLowerCase() + ')' })]));
      });
      fixField.hidden = kind.value !== 'manual_test' || !fixes.length;
    }
    function syncKind() {
      var p = PROMPTS[kind.value] || PROMPTS.note;
      titleLabel.textContent = p[0];
      titleHint.textContent = p[1];
      fileHint.textContent = p[2] + FILE_RULE.replace('{max}', formatBytes(maxFileBytes));
      Array.prototype.forEach.call(form.querySelectorAll('[data-activity-only]'), function (el) {
        el.hidden = el.getAttribute('data-activity-only') !== kind.value;
      });
      renderFixChoices();
    }
    kind.addEventListener('change', function () { wantFixes = null; syncKind(); });

    /** Set the form up for one kind of entry and take the operator to it. */
    function startEntry(kindValue, opts) {
      kind.value = kindValue;
      wantFixes = (opts && opts.fixIds) || null;
      syncKind();
      if (opts && opts.correctsId) corrects.value = opts.correctsId;
      setStatus(form.querySelector('[data-form-status]'), '');
      formHeading.scrollIntoView({ block: 'start' });
      (kindValue === 'correction' && opts && opts.correctsId ? title : title).focus();
    }

    function who(e) {
      if (e.source === 'portal') return 'Portal' + (e.authorName ? ' · ' + e.authorName : '');
      if (e.source === 'agent') return (e.agent || 'Agent') + (e.authorName ? ' for ' + e.authorName : '');
      return e.authorName || 'Accessrank team';
    }
    function dataLine(e) {
      var d = e.data || {};
      var parts = [];
      if (d.wcag) parts.push('WCAG ' + d.wcag);
      if (d.pages && d.pages.length) parts.push('Pages: ' + (Array.isArray(d.pages) ? d.pages.join(', ') : d.pages));
      if (d.theme && e.kind !== 'publish') parts.push('Theme: ' + d.theme);
      if (d.how) parts.push('How: ' + d.how);
      if (d.tool) parts.push('Tool: ' + d.tool + (d.version ? ' ' + d.version : ''));
      if (d.result) parts.push('Result: ' + ({ pass: 'no problems found', fail: 'problems found', manual_pending: 'needs a manual check' }[d.result] || d.result));
      if (d.tester) parts.push('Tested by: ' + d.tester);
      if (d.tools) parts.push('With: ' + d.tools);
      if (d.fixIds && d.fixIds.length) parts.push('Covers ' + count1(d.fixIds.length, 'fix', 'fixes'));
      if (d.files && d.files.length) parts.push('Files: ' + (Array.isArray(d.files) ? d.files.join(', ') : d.files));
      return parts.join(' · ');
    }

    function renderStand(s) {
      stand.hidden = !entries.length;
      if (!entries.length) return;
      var bits = [];
      [['not_live', 'built, not yet live'], ['awaiting_retest', 'live, awaiting re-test'], ['manual_pending', 'awaiting a manual check'],
        ['failed', 'did not pass a test'], ['flagged', 'corrected'], ['passed', 'passed']].forEach(function (pair) {
        if (s[pair[0]]) bits.push(s[pair[0]] + ' ' + pair[1]);
      });
      fixesLine.textContent = s.fixes ? count1(s.fixes, 'fix', 'fixes') + ' logged: ' + bits.join(' · ') + '.' : 'No fixes logged yet.';

      needs.textContent = '';
      function need(text, label, onClick) {
        var item = h('li', {}, [h('span', { text: text })]);
        if (label) {
          var b = h('button', { type: 'button', class: 'btn-small', text: label });
          b.addEventListener('click', onClick);
          item.appendChild(b);
        }
        needs.appendChild(item);
      }
      if (s.not_live) {
        need(count1(s.not_live, 'fix is', 'fixes are') + ' built but not live. Publish the theme, then log it here.', 'Log theme published', function () { startEntry('publish'); });
      }
      var manual = entries.filter(function (e) { return e.kind === 'fix' && (e.state === 'manual_pending' || e.state === 'failed'); });
      if (manual.length) {
        need(count1(manual.length, 'fix needs', 'fixes need') + ' a person to check. Test, then log the result.', 'Log manual test', function () {
          startEntry('manual_test', { fixIds: manual.map(function (e) { return e.id; }) });
        });
      }
      if (s.flagged) need(count1(s.flagged, 'corrected fix needs', 'corrected fixes need') + ' reading before the record is issued.');
      if (s.awaiting_retest) need(count1(s.awaiting_retest, 'fix is', 'fixes are') + ' live and waiting for a re-test. The agent logs that; nothing for you to do.');
      needs.hidden = !needs.children.length;

      var ctx = [];
      if (s.liveTheme) ctx.push('Live theme: ' + s.liveTheme.name.replace(/^Theme published: /, '') + ', since ' + day(s.liveTheme.on));
      if (s.lastScan) ctx.push('Last scan: ' + day(s.lastScan.on) + ', ' + s.lastScan.title);
      context.textContent = ctx.join(' · ');
      context.hidden = !ctx.length;
    }

    function renderList() {
      var correctedBy = {};
      entries.forEach(function (e) { if (e.correctsId) correctedBy[e.correctsId] = e; });
      var test = FILTERS[filter.value] || (filter.value ? function (e) { return e.kind === filter.value; } : function () { return true; });
      var shown = entries.filter(test);
      list.textContent = '';
      shown.forEach(function (e) {
        var target = e.correctsId ? entries.filter(function (x) { return x.id === e.correctsId; })[0] : null;
        var extra = dataLine(e);
        var actions = [];
        if (e.file) {
          actions.push(h('a', { class: 'link-button', href: '/api/portal/admin/activity/' + encodeURIComponent(e.id) + '/file', text: 'Evidence: ' + e.file.name + ' (' + formatBytes(e.file.size) + ')' }));
        } else {
          var add = h('button', { type: 'button', class: 'link-button', text: 'Attach evidence', 'aria-label': 'Attach an evidence file to: ' + e.title });
          add.addEventListener('click', function () { attachTo = { entry: e, button: add }; attach.value = ''; attach.click(); });
          actions.push(add);
        }
        if (e.kind !== 'correction' && !correctedBy[e.id] && e.source !== 'portal') {
          var fix = h('button', { type: 'button', class: 'link-button', text: 'Correct this', 'aria-label': 'Add a correction to: ' + e.title });
          fix.addEventListener('click', function () { startEntry('correction', { correctsId: e.id }); });
          actions.push(fix);
        }
        list.appendChild(h('li', correctedBy[e.id] ? { class: 'is-corrected' } : {}, [
          h('p', { class: 'activity-meta' }, [
            h('span', { class: 'activity-kind', text: e.kindLabel }),
            h('span', { text: day(e.happenedOn) }),
            h('span', { text: who(e) }),
            e.stateLabel && !correctedBy[e.id] ? h('span', { class: 'activity-state' + (e.state === 'passed' ? ' is-passed' : ''), text: e.state === 'passed' ? 'Passed ' + day(e.stateLabel.slice(-10)) : e.stateLabel }) : null
          ]),
          h('p', { class: 'activity-title', text: e.title }),
          e.details ? h('p', { class: 'file-meta', text: e.details }) : null,
          extra ? h('p', { class: 'file-meta', text: extra }) : null,
          target ? h('p', { class: 'file-meta', text: 'Corrects: ' + target.title + ' (' + day(target.happenedOn) + ')' }) : null,
          correctedBy[e.id] ? h('p', { class: 'file-meta activity-flag', text: 'Corrected on ' + day(correctedBy[e.id].happenedOn) + ': ' + correctedBy[e.id].title }) : null,
          h('p', { class: 'activity-entry-actions' }, actions)
        ]));
      });
      list.hidden = !shown.length;
      empty.hidden = shown.length > 0;
      empty.textContent = entries.length ? 'No entries of that kind.' : 'Nothing logged yet. Entries appear here as work is done.';
      count.textContent = entries.length ? count1(entries.length, 'entry', 'entries') : '';
    }
    filter.addEventListener('change', renderList);

    function render(data) {
      entries = data.entries || [];
      if (data.maxFileBytes) maxFileBytes = data.maxFileBytes;
      var client = getClient();
      csv.hidden = !entries.length;
      if (client) csv.setAttribute('href', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/activity?format=csv');
      var corrected = {};
      entries.forEach(function (e) { if (e.correctsId) corrected[e.correctsId] = true; });
      var keep = corrects.value;
      corrects.textContent = '';
      entries.filter(function (e) { return e.kind !== 'correction' && !corrected[e.id] && e.source !== 'portal'; }).slice(0, 200).forEach(function (e) {
        corrects.appendChild(h('option', { value: e.id, text: day(e.happenedOn) + ' · ' + e.kindLabel + ' · ' + e.title.slice(0, 90) }));
      });
      if (keep) corrects.value = keep;
      renderStand(data.summary || {});
      renderList();
      syncKind();
    }

    var loadedFor = null;
    function load() {
      var client = getClient();
      if (!client) return Promise.resolve();
      if (loadedFor !== client.id) {
        loadedFor = client.id;
        form.reset();
        filter.value = '';
        wantFixes = null;
        date.value = localToday();
        date.setAttribute('max', localToday());
        setStatus(status, '');
      }
      return api('GET', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/activity').then(render, function (error) {
        setStatus(status, error.message, 'error');
      });
    }

    function checkFile(file) {
      if (!file) return null;
      if (!/\.(json|pdf|png|jpe?g|webp|html?|csv|xlsx|txt)$/i.test(file.name)) return 'Attach a JSON, PDF, PNG, JPG, WebP, HTML, CSV, XLSX or TXT file.';
      if (file.size > maxFileBytes) return 'That file is over ' + formatBytes(maxFileBytes) + '. Attach a smaller one.';
      if (!file.size) return 'That file is empty.';
      return null;
    }
    function sendFile(entryId, file) {
      return api('POST', '/api/portal/admin/activity/' + encodeURIComponent(entryId) + '/file?name=' + encodeURIComponent(file.name), null, file);
    }

    bindForm(form, 'Adding…', function (values) {
      var client = getClient();
      if (!client) return null;
      var text = String(values.title || '').trim();
      if (!text) {
        var missing = new Error(values.kind === 'publish' ? 'Enter the name of the theme that is now live.' : values.kind === 'manual_test' ? 'Say what was tested.' : 'Say what happened, in a line.');
        missing.field = 'title';
        throw missing;
      }
      var file = fileInput.files && fileInput.files[0];
      var problem = checkFile(file);
      if (problem) throw new Error(problem);
      var body = { kind: values.kind, happenedOn: values.happenedOn || null, title: text, details: values.details || '' };
      if (values.kind === 'publish') { body.title = 'Theme published: ' + text; body.data = { theme: text }; }
      if (values.kind === 'correction') body.correctsId = values.correctsId || null;
      if (values.kind === 'manual_test') {
        var ids = Array.prototype.map.call(form.querySelectorAll('[name="fixIds"]:checked'), function (b) { return b.value; });
        body.data = { result: values.result, fixIds: ids };
        if (values.tester) body.data.tester = values.tester;
        if (values.tools) body.data.tools = values.tools;
      }
      return api('POST', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/activity', body).then(function (data) {
        var added = data.entry.kindLabel + ' added to the log.';
        var after = file
          ? sendFile(data.entry.id, file).then(function () { return added + ' ' + file.name + ' attached.'; },
            function (error) { return added + ' The file did not attach (' + error.message + '). Use Attach evidence on the entry.'; })
          : Promise.resolve(added);
        return after.then(function (message) {
          var keepKind = kind.value;
          var keepDate = date.value;
          form.reset();
          kind.value = keepKind;
          date.value = keepDate;
          wantFixes = null;
          return load().then(function () { return message; });
        });
      });
    });

    // One shared picker attaches a file to an entry that has none (an agent's scan, say).
    attach.addEventListener('change', function () {
      var file = attach.files && attach.files[0];
      var target = attachTo;
      if (!file || !target) return;
      var problem = checkFile(file);
      if (problem) { setStatus(status, problem, 'error'); return; }
      var settle = working(target.button, 'Attaching…');
      target.button.disabled = true;
      setStatus(status, 'Attaching ' + file.name + '…', 'busy');
      sendFile(target.entry.id, file).then(function () {
        setStatus(status, file.name + ' attached to “' + target.entry.title + '”.', 'success');
        return load();
      }, function (error) {
        settle();
        target.button.disabled = false;
        setStatus(status, error.message, 'error');
      });
    });

    return { load: load };
  }

  /** One client's workspace: Approvals, Files and Logins, chosen by #client=<id>. */
  function initAdmin(root) {
    var state = { clients: [], selectedId: null, maxFileBytes: 25 * 1024 * 1024 };
    var acr = initAcrSection(root, function () { return selected(); }, function () { refreshBadge(); });
    var activity = initActivitySection(root, function () { return selected(); });

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

    /* ---- notes on Other files and Past approvals: the team adds, edits and deletes; the client reads them ---- */

    function fileRowWithNotes(client, file, actions) { return fileRowWithEditableNotes(file, actions, status); }

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
      other.forEach(function (file) { fileList.appendChild(fileRowWithNotes(client, file, [moveFileButton(client, file, 'compliance'), deleteFileButton(client, file)])); });
      filesEmpty.hidden = other.length > 0;
      fileList.hidden = other.length === 0;
      clear(complianceList);
      compliance.forEach(function (file) { complianceList.appendChild(fileRow(file, [moveFileButton(client, file, 'files'), deleteFileButton(client, file)])); });
      complianceEmpty.hidden = compliance.length > 0;
      complianceList.hidden = compliance.length === 0;
      complianceCount.textContent = compliance.length ? plural(compliance.length, 'file') : '';
      clear(approvalFileList);
      approvalFiles.forEach(function (file) { approvalFileList.appendChild(fileRowWithNotes(client, file, [deleteFileButton(client, file)])); });
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
      acr.load();
      activity.load();
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
        renderDetail();
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
        // Arriving from Work to do (#client=…&acr): land on the ACR section.
        if (/[#&]acr\b/.test(location.hash || '') && selected()) {
          var acrHeading = root.querySelector('#admin-acr-heading');
          if (acrHeading) { acrHeading.scrollIntoView({ block: 'start' }); acrHeading.focus({ preventScroll: true }); }
        }
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

  /** The team repository: master operators keep files, notes under each file, and a punch list; nobody else sees it. */
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
    var tasks = [];
    var threads = {};
    var taskList = root.querySelector('[data-task-list]');
    var taskEmpty = root.querySelector('[data-tasks-empty]');
    var taskCount = root.querySelector('[data-tasks-count]');
    var taskForm = root.querySelector('[data-task-form]');
    var taskInput = root.querySelector('[data-task-input]');

    bindLogout(root);

    function fail(error) { setStatus(status, error.message, 'error'); throw error; }

    /** A small button with a visible text label and a longer accessible name. */
    function smallButton(label, name, extra) {
      return h('button', { type: 'button', class: 'btn-small' + (extra ? ' ' + extra : ''), 'aria-label': name, text: label });
    }

    /**
     * "Replace file": pick a new file and it takes the old one's place. The notes under the
     * file stay with it, and the name, size and date follow the new file. The picker is a
     * real file input kept off-screen and opened by a normal button.
     */
    function replaceButton(file) {
      var button = smallButton('Replace file', 'Replace ' + file.name);
      var input = h('input', { type: 'file', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
      button.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var chosen = input.files && input.files[0];
        input.value = '';
        if (!chosen) return;
        if (chosen.size === 0) { setStatus(status, chosen.name + ' is empty, so ' + file.name + ' was not replaced.', 'error'); return; }
        if (chosen.size > state.maxFileBytes) {
          setStatus(status, chosen.name + ' is over the ' + formatBytes(state.maxFileBytes) + ' limit, so ' + file.name + ' was not replaced.', 'error');
          return;
        }
        button.disabled = true;
        setStatus(status, 'Replacing ' + file.name + '\u2026');
        api('PUT', '/api/portal/team-files/' + encodeURIComponent(file.id) + '?name=' + encodeURIComponent(chosen.name), null, chosen).then(function (data) {
          var oldName = file.name;
          file.name = data.file.name;
          file.size = data.file.size;
          file.createdAt = data.file.createdAt;
          file.addedByName = data.file.addedByName;
          file.addedByEmail = data.file.addedByEmail;
          render();
          setStatus(status, 'Replaced ' + oldName + ' with ' + data.file.name + '. Its notes stay with it.', 'success');
          var row = list.querySelector('button[aria-label="Replace ' + data.file.name.replace(/"/g, '\\"') + '"]');
          if (row) row.focus();
        }, function (e) { button.disabled = false; fail(e); });
      });
      return h('span', { class: 'replace-file' }, [button, input]);
    }

    function render() {
      clear(list);
      forgetThreads('file:');
      loading.hidden = true;
      empty.hidden = state.files.length > 0;
      list.hidden = state.files.length === 0;
      count.textContent = state.files.length ? '(' + state.files.length + ')' : '';
      state.files.forEach(function (file) {
        var remove = h('button', { type: 'button', class: 'btn-small', 'aria-label': 'Delete ' + file.name + ' and its notes', text: 'Delete' });
        confirmable(remove, 'Delete file and notes', function () {
          return api('DELETE', '/api/portal/team-files/' + encodeURIComponent(file.id)).then(function () {
            state.files = state.files.filter(function (f) { return f.id !== file.id; });
            notes = notes.filter(function (n) { return n.fileId !== file.id; });
            render();
            setStatus(status, 'Deleted ' + file.name + ' and its notes.', 'success');
          }, fail);
        });
        var replace = replaceButton(file);
        var panel = threadFor('file:' + file.id, { fileId: file.id }, file.name);
        list.appendChild(h('li', {}, [
          h('div', { class: 'file-row' }, [
            h('span', { class: 'file-badge', 'aria-hidden': 'true', text: fileKind(file.name) }),
            h('div', { class: 'file-text' }, [
              h('p', { class: 'file-name', text: file.name }),
              h('p', { class: 'file-meta' }, [
                h('span', { text: formatBytes(file.size) }),
                h('span', { text: 'Added ' + formatDate(file.createdAt) + (file.addedByName || file.addedByEmail ? ' by ' + (file.addedByName || file.addedByEmail) : '') })
              ])
            ]),
            h('div', { class: 'row-actions' }, [
              threads['file:' + file.id].heading,
              h('a', { class: 'btn-small', href: '/api/portal/team-files/' + encodeURIComponent(file.id), 'aria-label': 'Download ' + file.name, text: 'Download' }),
              replace,
              remove
            ])
          ]),
          panel
        ]));
        renderThread('file:' + file.id);
      });
    }

    /* ---- notes under each file and each task ---- */

    function noteKey(n) { return n.fileId ? 'file:' + n.fileId : 'task:' + n.taskId; }

    function forgetThreads(prefix) {
      Object.keys(threads).forEach(function (key) { if (key.indexOf(prefix) === 0) delete threads[key]; });
    }

    /** The folded notes panel for one file or one task. `target` is { fileId } or { taskId }. */
    function threadFor(key, target, name) {
      var heading = h('span', { class: 'notes-count' });
      var noteInput = h('input', {
        type: 'text', class: 'note-add-input', maxlength: '2000', autocomplete: 'off',
        placeholder: 'Add a note…', 'aria-label': 'Add a note to ' + name
      });
      var addButton = h('button', { type: 'submit', class: 'btn-small btn-small--brand', 'aria-label': 'Add note to ' + name, text: 'Add note' });
      var form = h('form', { class: 'note-add', novalidate: true }, [noteInput, addButton]);
      var noteList = h('ul', { class: 'note-list', 'aria-label': 'Notes on ' + name });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = noteInput.value.trim();
        if (!body) { setStatus(status, 'Write a note first.', 'error'); noteInput.focus(); return; }
        addButton.disabled = true;
        api('POST', '/api/portal/team-notes', { fileId: target.fileId, taskId: target.taskId, body: body }).then(function (data) {
          notes.push(data.note);
          noteInput.value = '';
          renderThread(key);
          setStatus(status, 'Note added to ' + name + '.', 'success');
        }, function (error) { setStatus(status, error.message, 'error'); }).then(function () { addButton.disabled = false; noteInput.focus(); });
      });
      threads[key] = { heading: heading, list: noteList };
      return h('div', { class: 'file-notes' }, [h('div', { class: 'file-notes-inner' }, [noteList, form])]);
    }

    function renderThread(key) {
      var thread = threads[key];
      if (!thread) return;
      var mine = notes.filter(function (n) { return noteKey(n) === key; });
      thread.heading.textContent = mine.length ? 'Notes (' + mine.length + ')' : 'Notes (none yet)';
      clear(thread.list);
      mine.forEach(function (n) { thread.list.appendChild(noteRow(n)); });
    }

    function noteMeta(note) {
      var who = note.authorName || note.authorEmail;
      var when = formatDateTime(note.createdAt) + (note.updatedAt ? ' (edited)' : '');
      return h('p', { class: 'note-meta', title: note.updatedAt ? 'Edited ' + formatDateTime(note.updatedAt) : null, text: who + ' · ' + when });
    }

    function noteRow(note) {
      var li = h('li', { class: 'note' });
      var edit = smallButton('Edit', 'Edit note');
      var remove = smallButton('Delete', 'Delete note');

      confirmable(remove, 'Delete note', function () {
        return api('DELETE', '/api/portal/team-notes/' + encodeURIComponent(note.id)).then(function () {
          notes = notes.filter(function (n) { return n.id !== note.id; });
          renderThread(noteKey(note));
          setStatus(status, 'Note deleted.', 'success');
        }, fail);
      });

      edit.addEventListener('click', function () {
        clear(li);
        li.classList.add('is-editing');
        var area = h('textarea', { class: 'note-edit', rows: '1', maxlength: '2000', 'aria-label': 'Edit note' });
        area.value = note.body;
        var save = smallButton('Save', 'Save note', 'btn-small--brand');
        var cancel = smallButton('Cancel', 'Cancel editing');
        function grow() { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; }
        function done() { renderThread(noteKey(note)); }
        function commit() {
          var body = area.value.trim();
          if (!body) { setStatus(status, 'Write a note first, or use Delete.', 'error'); area.focus(); return; }
          save.disabled = true;
          api('PATCH', '/api/portal/team-notes/' + encodeURIComponent(note.id), { body: body }).then(function (data) {
            notes = notes.map(function (n) { return n.id === note.id ? data.note : n; });
            done();
            setStatus(status, 'Note saved.', 'success');
          }, function (error) { setStatus(status, error.message, 'error'); save.disabled = false; area.focus(); });
        }
        area.addEventListener('input', grow);
        area.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); done(); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        });
        save.addEventListener('click', commit);
        cancel.addEventListener('click', done);
        li.appendChild(area);
        li.appendChild(h('div', { class: 'note-edit-actions' }, [save, cancel]));
        grow();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });

      li.appendChild(h('div', { class: 'note-main' }, [h('p', { class: 'note-body', text: note.body }), noteMeta(note)]));
      li.appendChild(h('div', { class: 'note-actions' }, [edit, remove]));
      return li;
    }

    /* ---- punch list ---- */

    function renderTasks() {
      clear(taskList);
      forgetThreads('task:');
      var open = tasks.filter(function (t) { return !t.done; }).length;
      taskEmpty.hidden = tasks.length > 0;
      taskList.hidden = tasks.length === 0;
      taskCount.textContent = tasks.length ? '(' + open + ' open of ' + tasks.length + ')' : '';
      tasks.forEach(function (t) { taskList.appendChild(taskRow(t)); });
    }

    function replaceTask(task) { tasks = tasks.map(function (t) { return t.id === task.id ? task : t; }); }

    function taskRow(task) {
      var li = h('li', { class: 'task' + (task.done ? ' is-done' : '') });
      var row = h('div', { class: 'task-row' });
      var panel = threadFor('task:' + task.id, { taskId: task.id }, task.text);
      var check = h('input', { type: 'checkbox', class: 'task-check', 'aria-label': (task.done ? 'Mark not done: ' : 'Mark done: ') + task.text });
      check.checked = task.done;
      check.addEventListener('change', function () {
        check.disabled = true;
        api('PATCH', '/api/portal/team-tasks/' + encodeURIComponent(task.id), { done: check.checked }).then(function (data) {
          replaceTask(data.task);
          renderTasks();
        }, function (error) { setStatus(status, error.message, 'error'); check.checked = !check.checked; check.disabled = false; });
      });

      var edit = smallButton('Edit', 'Edit task: ' + task.text);
      var remove = smallButton('Delete', 'Delete task and its notes: ' + task.text);
      confirmable(remove, 'Delete task and notes', function () {
        return api('DELETE', '/api/portal/team-tasks/' + encodeURIComponent(task.id)).then(function () {
          tasks = tasks.filter(function (t) { return t.id !== task.id; });
          notes = notes.filter(function (n) { return n.taskId !== task.id; });
          renderTasks();
          setStatus(status, 'Task and its notes deleted.', 'success');
        }, fail);
      });

      edit.addEventListener('click', function () {
        clear(row);
        var field = h('input', { type: 'text', class: 'task-edit', maxlength: '300', autocomplete: 'off', 'aria-label': 'Edit task' });
        field.value = task.text;
        var save = smallButton('Save', 'Save task', 'btn-small--brand');
        var cancel = smallButton('Cancel', 'Cancel editing');
        function commit() {
          var text = field.value.trim();
          if (!text) { setStatus(status, 'Write the task first, or use Delete.', 'error'); field.focus(); return; }
          save.disabled = true;
          api('PATCH', '/api/portal/team-tasks/' + encodeURIComponent(task.id), { text: text }).then(function (data) {
            replaceTask(data.task);
            renderTasks();
            setStatus(status, 'Task saved.', 'success');
          }, function (error) { setStatus(status, error.message, 'error'); save.disabled = false; field.focus(); });
        }
        field.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); renderTasks(); }
          else if (e.key === 'Enter') { e.preventDefault(); commit(); }
        });
        save.addEventListener('click', commit);
        cancel.addEventListener('click', renderTasks);
        row.appendChild(h('span', { class: 'task-check-spacer', 'aria-hidden': 'true' }));
        row.appendChild(field);
        row.appendChild(h('div', { class: 'task-actions is-editing' }, [save, cancel]));
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      });

      var who = task.authorName || task.authorEmail;
      row.appendChild(check);
      row.appendChild(h('div', { class: 'task-main' }, [
        h('p', { class: 'task-text', text: task.text }),
        h('p', { class: 'note-meta', text: 'Added' + (who ? ' by ' + who : '') + ' ' + formatDate(task.createdAt) + (task.updatedAt ? ' (edited)' : '') })
      ]));
      row.appendChild(threads['task:' + task.id].heading);
      row.appendChild(h('div', { class: 'task-actions' }, [edit, remove]));
      li.appendChild(row);
      li.appendChild(panel);
      renderThread('task:' + task.id);
      return li;
    }

    taskForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = taskInput.value.trim();
      if (!text) { setStatus(status, 'Write the task first.', 'error'); taskInput.focus(); return; }
      var button = taskForm.querySelector('[type="submit"]');
      button.disabled = true;
      api('POST', '/api/portal/team-tasks', { text: text }).then(function (data) {
        tasks.push(data.task);
        taskInput.value = '';
        renderTasks();
        setStatus(status, 'Task added.', 'success');
      }, function (error) { setStatus(status, error.message, 'error'); }).then(function () { button.disabled = false; taskInput.focus(); });
    });

    /* ---- uploads ---- */

    function uploadOne(file) {
      var note = h('span', { class: 'upload-state', text: 'Uploading…' });
      var row = h('li', {}, [h('span', { class: 'upload-name', text: file.name }), note]);
      queue.appendChild(row);
      var reject = function (message) { row.className = 'is-error'; note.textContent = message; return false; };
      if (file.size === 0) return Promise.resolve(reject('Empty file — skipped'));
      if (file.size > state.maxFileBytes) return Promise.resolve(reject('Over the ' + formatBytes(state.maxFileBytes) + ' limit — skipped'));
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
        setStatus(status, 'Added ' + plural(added, 'file') + (skipped ? '. ' + plural(skipped, 'file') + ' could not be added — see the list above.' : '.'), skipped ? 'error' : 'success');
      });
    }

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
        function quiet(error) { if (error.code !== 'signed_out') setStatus(status, error.message, 'error'); }
        return Promise.all([api('GET', '/api/portal/team-files'), api('GET', '/api/portal/team-notes'), api('GET', '/api/portal/team-tasks')]).then(function (results) {
          state.files = results[0].files;
          tasks = results[2].tasks;
          state.maxFileBytes = results[0].maxFileBytes || state.maxFileBytes;
          notes = results[1].notes;
          root.querySelector('[data-max-file]').textContent = formatBytes(state.maxFileBytes);
          render();
          renderTasks();
        }, function (error) {
          loading.hidden = true;
          // Anyone who is not a master gets a 404 here: send them back to the console.
          if (error.status === 404) { go('/portal/approvals'); return; }
          quiet(error);
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
