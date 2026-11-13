-- Accessrank — evidence files on activity log entries
--
-- * One file may be attached to an entry: the scan's own export, a test report, a screenshot.
--   It is the evidence for that entry, kept with it, and team only like the rest of the log
--   (a client's own Files lists are visible to the client; these are not).
-- * A file is attached once and never replaced, in keeping with the append-only log. An entry
--   logged with the wrong file is corrected like any other: by a new entry.
-- * The bytes live on the row. Lists never select file_data.

BEGIN;

ALTER TABLE portal_activity
  ADD COLUMN IF NOT EXISTS file_name     text,
  ADD COLUMN IF NOT EXISTS file_type     text,
  ADD COLUMN IF NOT EXISTS file_size     integer CHECK (file_size IS NULL OR file_size > 0),
  ADD COLUMN IF NOT EXISTS file_data     bytea,
  ADD COLUMN IF NOT EXISTS file_added_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_added_by text;

INSERT INTO schema_migrations (version) VALUES ('014_portal_activity_files')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
