-- Accessrank — client portal
--
-- A client is a company. Each client has one private file area, and any number
-- of logins that can see it. Everything hangs off portal_clients with
-- ON DELETE CASCADE, so removing a client removes its logins, sessions and files
-- in one statement and nothing can be orphaned.
--
-- Design notes that matter for correctness:
--
-- * Passwords are never stored. `password_hash` is scrypt output with a per-user
--   salt (see server/lib/portal.js). The admin page shows a generated password
--   exactly once, at creation or reset; after that nobody can read it back.
--
-- * Session cookies hold a random token; only its SHA-256 is stored here. A
--   database leak therefore yields no usable session.
--
-- * The Accessrank admin login is NOT a row in portal_users — it comes from the
--   PORTAL_ADMIN_EMAIL / PORTAL_ADMIN_PASSWORD secrets, because it has to exist
--   before the first client does. Admin sessions are rows here with
--   role = 'admin' and a NULL user_id.
--
-- * File bytes live in `portal_files.data`. Listing queries never select that
--   column, so a client area with many files stays cheap to list.

BEGIN;

-- -------------------------------------------------------------- clients ----

CREATE TABLE IF NOT EXISTS portal_clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  name        text NOT NULL
);

DROP TRIGGER IF EXISTS portal_clients_set_updated_at ON portal_clients;
CREATE TRIGGER portal_clients_set_updated_at
  BEFORE UPDATE ON portal_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- users ----

CREATE TABLE IF NOT EXISTS portal_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  client_id      uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,

  name           text,
  -- `email` is what the person typed and what we display. `email_key` is the
  -- lower-cased form and is what sign-in matches on; UNIQUE means one email
  -- address can belong to exactly one client.
  email          text NOT NULL,
  email_key      text NOT NULL UNIQUE,

  password_hash  text NOT NULL,
  -- 'admin' until the person replaces the password they were sent.
  password_set_by text NOT NULL DEFAULT 'admin'
                  CHECK (password_set_by IN ('admin', 'user')),
  last_login_at  timestamptz
);

CREATE INDEX IF NOT EXISTS portal_users_client_idx ON portal_users (client_id, created_at);

-- ------------------------------------------------------------- sessions ----

CREATE TABLE IF NOT EXISTS portal_sessions (
  token_hash  text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  role        text NOT NULL CHECK (role IN ('client', 'admin')),
  user_id     uuid REFERENCES portal_users(id) ON DELETE CASCADE,
  ip_hash     text,
  -- A client session must point at a login; an admin session never does.
  CHECK ((role = 'client' AND user_id IS NOT NULL) OR (role = 'admin' AND user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS portal_sessions_expiry_idx ON portal_sessions (expires_at);
CREATE INDEX IF NOT EXISTS portal_sessions_user_idx   ON portal_sessions (user_id);

-- ---------------------------------------------------------------- files ----

CREATE TABLE IF NOT EXISTS portal_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  client_id     uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,

  filename      text    NOT NULL,
  content_type  text    NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  data          bytea   NOT NULL
);

CREATE INDEX IF NOT EXISTS portal_files_client_idx ON portal_files (client_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('002_client_portal')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
