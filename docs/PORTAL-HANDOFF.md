# Client portal — handoff

Adds a password-protected client portal to accessrank.ai: a "Client login" link
in the main nav and footer, a sign-in page, a private file area per client, and
an admin page for managing clients, logins and uploads.

Written against commit `a71d101` of `criercomm/acessrank-combined`
("Deck: new cover copy…", 2026-09-28). If the repo has moved on since, diff the
eight replaced files before copying them over.

## Applying it

Every file in this bundle is a complete file at its path from the repo root.

> Copy the **files** into their matching folders. Do not drag the bundle's
> folders onto the repo's folders in Finder — "Replace" swaps the whole folder
> and deletes everything else in it. From a terminal,
> `cp -R accessrank-client-portal/. /path/to/acessrank-combined/` merges safely.

**New files (10)**

```
db/migrations/002_client_portal.sql
server/lib/portal.js
server/routes/portal.js
src/assets/css/portal.css
src/assets/js/portal.js
src/pages/client-login.html
src/pages/portal.html
src/pages/portal-admin.html
tests/unit/portal.test.js
tests/integration/portal.test.js
```

**Replaced files (8)**

```
server/app.js            mounts /api/portal and the page guards; rate limits
server/lib/config.js     adds the `portal` config block
build.mjs                emits portal.css / portal.js; robots rule
src/partials/shell.html  links those two files on portal pages only
src/data/site.json       nav + footer link; three page entries
fly.toml                 adds release_command (runs migrations on deploy)
README.md                "Client portal" section
docs/RUNBOOK.md          operating notes
```

`dist/` is not in the bundle. The Docker build regenerates it; locally, run
`npm run build`.

## Deploying

1. Set the admin sign-in (both, password 12+ characters):

   ```bash
   fly secrets set PORTAL_ADMIN_EMAIL="you@accessrank.ai" PORTAL_ADMIN_PASSWORD="..."
   ```

2. `fly deploy`. The new `release_command` in `fly.toml` runs
   `node scripts/migrate.mjs` first, which applies `002_client_portal.sql`. If
   you would rather not have migrations run on every deploy, remove the
   `[deploy]` block and run that script once by hand after deploying.

3. Sign in at `/client-login` with the admin email and password. You land on
   `/portal/admin`.

Without the two secrets the site deploys and runs as before; the admin page is
simply unreachable and no client can be created.

## Check before trusting it in production

- **Postgres.** The migration and every query were run against PGlite (an
  in-process Postgres), and the HTTP tests run on the in-memory store. Neither
  the real database nor the `pg` driver's handling of the `bytea` file column
  has been exercised. After the first deploy: create a client, upload a PDF,
  download it and confirm the bytes match.
- **`release_command`.** Not yet run on Fly. It needs `DATABASE_URL`, which
  production already requires.
- **`npm run verify`.** Unit tests (102), the portal end-to-end tests (15), the
  existing integration tests (40) and the link check pass. `npm run test:a11y`
  passes on the three new pages but fails on `/` and `/deck` for colour contrast
  inside the deck (`.counter-total`, `.mute`). That failure predates this change
  and will fail `verify` until the deck is fixed.

## Decisions still open

- **File storage** is Postgres with a 25 MB per-file cap (`PORTAL_MAX_FILE_MB`).
  Fine for reports and VPATs; move to object storage before hosting proof
  videos. Only `insertFile` / `getFile` in `server/lib/portal.js` would change.
- **No self-service "forgot password".** An admin presses *Reset password* and
  sends the new one.
- **One admin login**, from secrets. No per-teammate accounts.
- **No email** is sent by the portal: credentials are copied by hand, and
  nothing notifies a client when a file is added.

The full description — routes, security model, settings — is in the
"Client portal" section of `README.md`; day-to-day fixes are in `docs/RUNBOOK.md`.
