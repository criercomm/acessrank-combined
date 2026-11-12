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
      var add = h('button', { type: 'button', class: 'btn-small btn-small--brand', text: 'Add to ACR update', disabled: !draft });
      var later = h('button', { type: 'button', class: 'btn-small', text: 'Done, not in ACR yet' });
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
          : 'This client has no ACR draft yet. Upload one on the client’s page (Approvals tab) to add changes to the ACR.' }),
        status,
        h('div', { class: 'row-actions' }, [add, later, cancel])
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
        add.disabled = true; later.disabled = true;
        setStatus(status, 'Saving…');
        saveWork(report, item, { done: true, queue: queue, criterion: criterion.value, conformance: select.value, note: note.value })
          .then(close, function (error) {
            add.disabled = !draft; later.disabled = false;
            setStatus(status, error.message, 'error');
          });
      }
      add.addEventListener('click', function () { save(true); });
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
      h('a', { class: 'work-acr-link', href: '/portal/client#client=' + encodeURIComponent(report.clientId), text: 'ACR for ' + report.clientName })
    ]));
    wrap.appendChild(h('div', { class: 'work-bar', 'aria-hidden': 'true' }, [bar]));
    wrap.appendChild(h('p', { class: 'field-hint', text: 'Tick an item only when the change is live on the store, not just finished in a test theme.' }));
    wrap.appendChild(list);

    function count() {
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
        w.acrState === 'none' ? h('button', { type: 'button', class: 'link-button', text: 'Add to ACR update', 'data-add-acr': true }) : null
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
    var busy = false;

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
          h('p', { class: 'file-meta', text: 'Live ' + formatDate(w.doneAt) + (w.doneByName ? ' · ' + w.doneByName : '') + (w.note ? ' · ' + w.note : '') })
        ]));
      });
      queueList.hidden = !acr.queue.length;
      queueEmpty.hidden = acr.queue.length > 0;
      queueCount.textContent = acr.queue.length ? '(' + acr.queue.length + ')' : '';
      // A button, not a link: the address needs the client id, and a placeholder href trips the link check.
      build.setAttribute('data-href', '/api/portal/admin/clients/' + encodeURIComponent(acr.client.id) + '/acr/update');
      build.disabled = !acr.queue.length;
    }

    function load() {
      var client = getClient();
      if (!client) return Promise.resolve();
      return api('GET', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/acr').then(render, function (error) {
        setStatus(status, error.message, 'error');
      });
    }

    function upload(input, path, done) {
      var file = input.files && input.files[0];
      var client = getClient();
      if (!file || !client || busy) return;
      busy = true;
      setStatus(status, 'Uploading ' + file.name + '…');
      api('POST', '/api/portal/admin/clients/' + encodeURIComponent(client.id) + path + '?name=' + encodeURIComponent(file.name), null, file)
        .then(function (data) { setStatus(status, done(file, data), 'success'); return load(); })
        .catch(function (error) { setStatus(status, error.message, 'error'); })
        .then(function () { busy = false; input.value = ''; });
    }

    build.addEventListener('click', function () {
      var href = build.getAttribute('data-href');
      if (href && !build.disabled) window.location.assign(href);
    });
    draftInput.addEventListener('change', function () {
      upload(draftInput, '/acr/drafts', function (file) { return file.name + ' is the new ACR draft. Queued changes apply to it.'; });
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

  /** One client's workspace: Approvals, Files and Logins, chosen by #client=<id>. */
  function initAdmin(root) {
    var state = { clients: [], selectedId: null, maxFileBytes: 25 * 1024 * 1024 };
    var acr = initAcrSection(root, function () { return selected(); }, function () { refreshBadge(); });

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
