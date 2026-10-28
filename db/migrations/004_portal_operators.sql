-- Accessrank — portal operators
--
-- Until now the only team login was the single admin account configured by the
-- PORTAL_ADMIN_* secrets, and it could see every client. Operators are named
-- staff logins stored here:
--
--   master    manages the operators themselves and sees every client
--   operator  sees and works only the clients assigned to them
--
-- The PORTAL_ADMIN_* account is kept as the bootstrap owner: it can create the
-- first masters, and it is the way back in if every master is locked out.
--
-- * Passwords follow the same rule as client logins: scrypt hash only; a
--   generated password is shown once, at creation or reset.
-- * Assignments are plain rows in portal_operator_clients. Deleting either side
--   removes the row, so an assignment can never point at nothing.
-- * Sessions gain operator_id. A session is for exactly one kind of person.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_operators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  name            text NOT NULL,
  email           text NOT NULL,
  email_key       text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  password_set_by text NOT NULL DEFAULT 'admin' CHECK (password_set_by IN ('admin', 'user')),
  role            text NOT NULL DEFAULT 'operator' CHECK (role IN ('master', 'operator')),
  last_login_at   timestamptz
);

CREATE TABLE IF NOT EXISTS portal_operator_clients (
  operator_id uuid NOT NULL REFERENCES portal_operators(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES portal_clients(id)   ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, client_id)
);

CREATE INDEX IF NOT EXISTS portal_operator_clients_client_idx ON portal_operator_clients (client_id);

ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES portal_operators(id) ON DELETE CASCADE;

ALTER TABLE portal_sessions DROP CONSTRAINT IF EXISTS portal_sessions_role_check;
ALTER TABLE portal_sessions DROP CONSTRAINT IF EXISTS portal_sessions_check;
ALTER TABLE portal_sessions
  ADD CONSTRAINT portal_sessions_role_check CHECK (role IN ('client', 'admin', 'operator'));
ALTER TABLE portal_sessions
  ADD CONSTRAINT portal_sessions_check CHECK (
    (role = 'client'   AND user_id IS NOT NULL AND operator_id IS NULL) OR
    (role = 'admin'    AND user_id IS NULL     AND operator_id IS NULL) OR
    (role = 'operator' AND user_id IS NULL     AND operator_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS portal_sessions_operator_idx ON portal_sessions (operator_id);

INSERT INTO schema_migrations (version) VALUES ('004_portal_operators')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
