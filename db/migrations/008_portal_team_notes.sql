-- Accessrank — team notes on the repository
--
-- A shared, append-only record for master operators. There is no update or
-- delete path. Author name and email are kept as plain text taken from the
-- signed-in session, so a note still says who wrote it after that operator is
-- removed.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_team_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author_name  text NOT NULL DEFAULT '',
  author_email text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS portal_team_notes_created_idx ON portal_team_notes (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('008_portal_team_notes')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
