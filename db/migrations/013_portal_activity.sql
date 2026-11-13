-- Accessrank — the activity log: one running record per client of what was done, and when
--
-- * portal_activity: one row per event on a client's engagement. A scan was run, a fix was made,
--   a theme was published, a fix was re-tested, a person tested by hand, a client answered a
--   packet, an ACR was published. Each row says when the thing happened (happened_on) as well as
--   when it was written down (created_at), who or what wrote it (source: an operator, an agent or
--   the portal itself) and, for agents, which one.
-- * The log is append-only. There is no UPDATE or DELETE path in the application: a mistake is
--   corrected by a new row of kind 'correction' that points at the row it corrects (corrects_id).
--   This is the same rule the Accessibility Compliance Record follows for its remediation log.
-- * Team only. Nothing a client login can fetch reads this table.
-- * Rows go with the client (ON DELETE CASCADE), like files and approvals.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  client_id    uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('scan', 'fix', 'publish', 'verify', 'manual_test', 'note', 'correction', 'packet', 'approval', 'work', 'acr')),
  source       text NOT NULL DEFAULT 'operator' CHECK (source IN ('operator', 'agent', 'portal')),
  agent        text NOT NULL DEFAULT '' CHECK (char_length(agent) <= 80),
  happened_on  date NOT NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  details      text NOT NULL DEFAULT '' CHECK (char_length(details) <= 4000),
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrects_id  uuid REFERENCES portal_activity(id) ON DELETE SET NULL,
  author_name  text NOT NULL DEFAULT '',
  author_email text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS portal_activity_client_idx ON portal_activity (client_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('013_portal_activity')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
