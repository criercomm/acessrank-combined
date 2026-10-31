-- Accessrank — notes live under files; team punch list
--
-- Reverses the append-only rule from 008: notes can now be edited and deleted by
-- any master operator. The author stays the person who first wrote the note; an
-- edit only moves `updated_at`.
--
-- * `file_id` is nullable. A note that belongs to no file is kept but not shown.
--   Deleting a file deletes its notes (ON DELETE CASCADE).
-- * `portal_team_tasks` is the punch list.
--
-- The two existing notes are attached to their files by matching the note text
-- and the file name. Each only moves when exactly one file matches; otherwise
-- it is left unattached (nothing is deleted) so it can be placed by hand.

BEGIN;

ALTER TABLE portal_team_notes
  ADD COLUMN IF NOT EXISTS file_id    uuid REFERENCES portal_team_files(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS portal_team_notes_file_idx ON portal_team_notes (file_id, created_at);

-- Backfill: Shopify readiness report note -> the one file whose name mentions Shopify or readiness.
UPDATE portal_team_notes n
   SET file_id = (SELECT f.id FROM portal_team_files f WHERE f.filename ILIKE '%shopify%' OR f.filename ILIKE '%readiness%')
 WHERE n.file_id IS NULL
   AND n.body ILIKE 'The readiness report is a brand new service%'
   AND (SELECT count(*) FROM portal_team_files f WHERE f.filename ILIKE '%shopify%' OR f.filename ILIKE '%readiness%') = 1;

-- Backfill: manual-testers scope note -> the one file whose name mentions cart test pages.
UPDATE portal_team_notes n
   SET file_id = (SELECT f.id FROM portal_team_files f WHERE f.filename ILIKE '%cart%')
 WHERE n.file_id IS NULL
   AND n.body ILIKE 'A more robust scope and requirements ask%'
   AND (SELECT count(*) FROM portal_team_files f WHERE f.filename ILIKE '%cart%') = 1;

CREATE TABLE IF NOT EXISTS portal_team_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz,
  text         text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  done         boolean NOT NULL DEFAULT false,
  done_at      timestamptz,
  author_name  text NOT NULL DEFAULT '',
  author_email text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS portal_team_tasks_created_idx ON portal_team_tasks (created_at);

-- Seed the first two tasks once.
INSERT INTO portal_team_tasks (text, author_name, author_email, created_at)
SELECT t.text, 'JP Lincoln', 'jp@accessrank.ai', now() + t.ord * interval '1 millisecond'
  FROM (VALUES
    (1, 'Review and integrate the Shopify agentic readiness report'),
    (2, 'Engage first manual testing with crowdsourced vendor')
  ) AS t(ord, text)
 WHERE NOT EXISTS (SELECT 1 FROM portal_team_tasks);

INSERT INTO schema_migrations (version) VALUES ('009_portal_team_notes_tasks')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
