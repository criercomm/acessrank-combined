-- Accessrank — the team repository
--
-- A shared drawer for master operators: files they add and delete for the team.
-- Not tied to any client, never visible to clients or to regular operators.
--
-- * File bytes live in `portal_team_files.data`; listing never selects it.
-- * Who added a file is kept as plain text (name and email) so the row still
--   says who it came from after that operator is removed.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_team_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  filename       text    NOT NULL,
  content_type   text    NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  data           bytea   NOT NULL,
  added_by_name  text    NOT NULL DEFAULT '',
  added_by_email text    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS portal_team_files_created_idx ON portal_team_files (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('007_portal_team_files')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
