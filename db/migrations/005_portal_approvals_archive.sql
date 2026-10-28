-- Accessrank — past approvals and compliance files
--
-- * A report is 'open' while the client is answering it and 'closed' once the
--   team has finished with it. Closed reports keep every answer as the record,
--   stay readable by the client, and no longer accept new answers.
-- * A client's files are split into two areas: ordinary 'files', and
--   'compliance' files (Accessibility Compliance Records, VPATs, accessibility
--   statements and the like) so they can be found in one place.

BEGIN;

ALTER TABLE portal_reports
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by text;

ALTER TABLE portal_files
  ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'files' CHECK (area IN ('files', 'compliance'));

CREATE INDEX IF NOT EXISTS portal_reports_status_idx ON portal_reports (client_id, status, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('005_portal_approvals_archive')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
