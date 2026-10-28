-- Accessrank — portal reports and approvals
--
-- A report is a single self-contained HTML page the team publishes into one
-- client's portal. The client opens it inside the portal (after signing in) and
-- records Approve / Request changes decisions on it. Those decisions land here
-- so the team can see them without anyone attaching or emailing a file.
--
-- * The report HTML lives in portal_reports.html. Listing queries never select
--   it, so a client with many reports stays cheap to list.
--
-- * portal_approvals is APPEND-ONLY. A client who changes their mind adds a new
--   row; the current answer for an item is its newest row, and the older rows
--   stay as the history for the Accessibility Compliance Record.
--
-- * Both tables hang off portal_clients with ON DELETE CASCADE, like files.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  client_id   uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  html        text NOT NULL
);

CREATE INDEX IF NOT EXISTS portal_reports_client_idx ON portal_reports (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  report_id    uuid NOT NULL REFERENCES portal_reports(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  -- Who clicked: the login behind the session, plus the name they typed.
  user_id      uuid REFERENCES portal_users(id) ON DELETE SET NULL,
  user_email   text NOT NULL,
  signer_name  text NOT NULL,
  -- Which question on the report ("d1", "d6", "c5") and the answer given.
  item_key     text NOT NULL,
  item_title   text NOT NULL DEFAULT '',
  decision     text NOT NULL CHECK (decision IN ('approve', 'changes', 'comment')),
  choice       text NOT NULL DEFAULT '',
  comment      text NOT NULL DEFAULT '',
  -- When the person made the decision in their browser (their clock).
  decided_at   timestamptz
);

CREATE INDEX IF NOT EXISTS portal_approvals_report_idx ON portal_approvals (report_id, item_key, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_approvals_client_idx ON portal_approvals (client_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('003_portal_reports')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
