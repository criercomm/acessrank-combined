-- Accessrank — notes on punch list tasks
--
-- A note now belongs to either a file (009) or a task, never both. Deleting a
-- task deletes its notes (ON DELETE CASCADE), as deleting a file already does.
-- Existing notes are untouched.

BEGIN;

ALTER TABLE portal_team_notes
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES portal_team_tasks(id) ON DELETE CASCADE;

ALTER TABLE portal_team_notes DROP CONSTRAINT IF EXISTS portal_team_notes_one_parent;
ALTER TABLE portal_team_notes
  ADD CONSTRAINT portal_team_notes_one_parent CHECK (num_nonnulls(file_id, task_id) <= 1);

CREATE INDEX IF NOT EXISTS portal_team_notes_task_idx ON portal_team_notes (task_id, created_at);

INSERT INTO schema_migrations (version) VALUES ('010_portal_task_notes')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
