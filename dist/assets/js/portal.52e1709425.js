/* ---- portal.js ---- */
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

  function fileRow(file, extraActions) {
    var download = h('a', {
      class: 'btn-small',
      href: '/api/portal/files/' + encodeURIComponent(file.id),
      'aria-label': 'Download ' + file.name,
      text: 'Download'
    });
    return h('li', { 'data-file-id': file.id }, [
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

    function render(data) {
      root.querySelector('[data-portal-client]').textContent = data.client.name;
      var user = root.querySelector('[data-portal-user]');
      clear(user);
      user.appendChild(document.createTextNode('Signed in as '));
      user.appendChild(h('strong', { text: data.user.email }));

      if (nudge) nudge.hidden = data.user.passwordSetBy !== 'admin';

      clear(list);
      data.files.forEach(function (file) { list.appendChild(fileRow(file)); });
      loading.hidden = true;
      empty.hidden = data.files.length > 0;
      list.hidden = data.files.length === 0;
      count.textContent = data.files.length ? plural(data.files.length, 'file') : '';
    }

    function load() {
      setStatus(status, '');
      return api('GET', '/api/portal/me').then(function (data) {
        if (data.role === 'admin') { go('/portal/admin'); return; }
        render(data);
      }).catch(function (error) {
        if (error.code === 'signed_out') return;
        loading.hidden = true;
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  /* -------------------------------------------------------------- admin --- */

  function initAdmin(root) {
    var state = { clients: [], selectedId: null, maxFileBytes: 25 * 1024 * 1024 };

    var status = root.querySelector('[data-portal-status]');
    var rail = root.querySelector('[data-client-list]');
    var railLoading = root.querySelector('[data-clients-loading]');
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
    var dropzone = root.querySelector('[data-dropzone]');
    var input = root.querySelector('[data-upload-input]');
    var credential = root.querySelector('[data-credential]');

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

    function renderRail() {
      clear(rail);
      state.clients.forEach(function (client) {
        var button = h('button', {
          type: 'button', class: 'client-button',
          'aria-current': client.id === state.selectedId ? 'true' : null
        }, [
          h('span', { class: 'client-button-name', text: client.name }),
          h('span', { class: 'client-button-meta', text: plural(client.files.length, 'file') + ', ' + plural(client.users.length, 'login') })
        ]);
        button.addEventListener('click', function () { select(client.id, true); });
        rail.appendChild(h('li', {}, [button]));
      });
    }

    function renderFiles(client) {
      clear(fileList);
      client.files.forEach(function (file) {
        var remove = h('button', { type: 'button', class: 'btn-small btn-small--danger', 'aria-label': 'Delete ' + file.name, text: 'Delete' });
        confirmable(remove, 'Confirm delete', function () {
          return api('DELETE', '/api/portal/admin/files/' + encodeURIComponent(file.id)).then(function () {
            client.files = client.files.filter(function (f) { return f.id !== file.id; });
            renderRail();
            renderFiles(client);
            setStatus(status, 'Deleted ' + file.name + '.', 'success');
            root.querySelector('#admin-files-heading').focus();
          }).catch(fail);
        });
        fileList.appendChild(fileRow(file, [remove]));
      });
      filesEmpty.hidden = client.files.length > 0;
      fileList.hidden = client.files.length === 0;
      fileCount.textContent = client.files.length ? plural(client.files.length, 'file') : '';
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
            renderRail();
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
      detailEmpty.hidden = !!client || state.clients.length > 0;
      if (!client) return;

      detailName.textContent = client.name;
      root.querySelector('[data-dropzone-client]').textContent = client.name;
      renameForm.hidden = true;
      renderFiles(client);
      renderLogins(client);
    }

    function render() {
      railLoading.hidden = true;
      renderRail();
      renderDetail();
    }

    function select(id, moveFocus) {
      state.selectedId = id;
      hideCredential();
      clear(queue);
      render();
      if (moveFocus && selected()) detailName.focus();
    }

    /* ---- clients ---- */

    bindForm(root.querySelector('[data-add-client]'), 'Adding\u2026', function (values) {
      return api('POST', '/api/portal/admin/clients', { name: values.name }).then(function (data) {
        state.clients.push(data.client);
        sortClients();
        root.querySelector('[data-add-client]').reset();
        setStatus(status, 'Added ' + data.client.name + '. Upload their files and create a login below.', 'success');
        select(data.client.id, true);
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
        state.clients = state.clients.filter(function (c) { return c.id !== client.id; });
        setStatus(status, 'Deleted ' + client.name + ', with its logins and files.', 'success');
        select(state.clients.length ? state.clients[0].id : null, false);
        root.querySelector('#clients-heading').focus();
      }).catch(fail);
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
        renderRail();
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

    function uploadOne(client, file) {
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

      var url = '/api/portal/admin/clients/' + encodeURIComponent(client.id) + '/files?name=' + encodeURIComponent(file.name);
      return api('POST', url, null, file).then(function (data) {
        client.files.unshift(data.file);
        row.className = 'is-done';
        state_.textContent = 'Added';
        renderRail();
        if (client.id === state.selectedId) renderFiles(client);
        return true;
      }, function (error) {
        return reject(error.message);
      });
    }

    var uploading = false;

    function uploadFiles(files) {
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
        return chain.then(function () { return uploadOne(client, file); }).then(function (ok) { if (ok) added += 1; });
      }, Promise.resolve()).then(function () {
        uploading = false;
        input.value = '';
        var skipped = batch.length - added;
        setStatus(
          status,
          'Added ' + plural(added, 'file') + ' to ' + client.name + (skipped ? '. ' + plural(skipped, 'file') + ' could not be added \u2014 see the list below.' : '.'),
          skipped ? 'error' : 'success'
        );
        // Successful rows have done their job; problems stay until the next batch.
        Array.prototype.slice.call(queue.querySelectorAll('.is-done')).forEach(function (row) { row.remove(); });
      });
    }

    input.addEventListener('change', function () { uploadFiles(input.files); });

    // The whole window accepts a drop while a client is open, so a file let go a
    // little outside the box still lands — and never makes the browser navigate
    // away to display it.
    var hasFiles = function (e) {
      return !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
    };
    var depth = 0;
    var setOver = function (over) { dropzone.classList.toggle('is-over', over); };
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
      if (hasFiles(e) && active()) e.preventDefault();
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e) || !active()) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      uploadFiles(e.dataTransfer.files);
    });

    /* ---- load ---- */

    bindLogout(root);

    function load() {
      setStatus(status, '');
      return api('GET', '/api/portal/admin/clients').then(function (data) {
        state.clients = data.clients;
        state.maxFileBytes = data.maxFileBytes || state.maxFileBytes;
        root.querySelector('[data-max-file]').textContent = formatBytes(state.maxFileBytes);
        sortClients();
        if (!selected()) state.selectedId = state.clients.length ? state.clients[0].id : null;
        hideCredential();
        render();
      }).catch(function (error) {
        if (error.code === 'signed_out') return;
        railLoading.hidden = true;
        // A client login that reaches this page is told nothing about it.
        if (error.status === 404) { go('/portal'); return; }
        setStatus(status, error.message, 'error');
      });
    }

    return { load: load };
  }

  /* --------------------------------------------------------------- boot --- */

  var views = {};
  var loginForm = document.querySelector('[data-portal-login]');
  var filesRoot = document.querySelector('[data-portal-files]');
  var adminRoot = document.querySelector('[data-portal-admin]');

  if (loginForm) views.login = initLogin(loginForm);
  if (filesRoot) views.files = initFiles(filesRoot);
  if (adminRoot) views.admin = initAdmin(adminRoot);

  /** Reload one view's data (or all of them). */
  A.portal = {
    load: function (name) {
      Object.keys(views).forEach(function (key) { if (!name || name === key) views[key].load(); });
    }
  };

  if (A.portalAutoload !== false) A.portal.load();
}());
