-- Accessrank — notes on a client's files
--
-- Staff can add, edit and delete notes on the files in a client's Past approvals
-- and Other files. Notes are internal: they are never part of what a client
-- login can fetch.
--
-- * Deleting a file deletes its notes (ON DELETE CASCADE), as does deleting the client.
-- * The author is kept as plain text from the signed-in session, and stays the person who
--   first wrote the note; an edit only moves `updated_at`.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_file_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz,
  file_id      uuid NOT NULL REFERENCES portal_files(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author_name  text NOT NULL DEFAULT '',
  author_email text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS portal_file_notes_file_idx ON portal_file_notes (file_id, created_at);

INSERT INTO schema_migrations (version) VALUES ('011_portal_file_notes')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
