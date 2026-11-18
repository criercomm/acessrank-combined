-- Accessrank — VPAT drafts, built from a client's Evidence File and their human testing results
--
-- * portal_vpats: one row per VPAT (Accessibility Conformance Report). A client has at most one
--   open draft; each issued VPAT stays as a dated row. Team only: no client route reads this table.
--   The client sees an issued VPAT only as the PDF placed in their Compliance files (issued_file_id).
-- * data holds the report details (product, contact, evaluation methods, testers, dates) and one
--   entry per WCAG 2.2 Level A and AA criterion: its conformance level, remarks, where the answer
--   came from (the Evidence File, the testing vendor's sheet, or the team) and the evidence pointer.
-- * Cascades with the client. Deleting the issued file leaves the record and clears the pointer.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_vpats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  client_id        uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_name  text NOT NULL DEFAULT '',
  created_by_email text NOT NULL DEFAULT '',
  updated_by_name  text NOT NULL DEFAULT '',
  issued_at        timestamptz,
  issued_by_name   text NOT NULL DEFAULT '',
  issued_file_id   uuid REFERENCES portal_files(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_vpats_one_draft ON portal_vpats (client_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS portal_vpats_client_idx ON portal_vpats (client_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('016_portal_vpat')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
