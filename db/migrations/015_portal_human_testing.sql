-- Accessrank — human testing and the VPAT, per client
--
-- * human_testing: the client has bought human testing (included on Growth and Scale, or added
--   to a plan). Only these clients are owed a VPAT, so the portal shows the VPAT slot only for them.
-- * vpat_file_id: which of the client's Compliance files is their current VPAT (Accessibility
--   Conformance Report). Cleared automatically if that file is deleted.

BEGIN;

ALTER TABLE portal_clients ADD COLUMN IF NOT EXISTS human_testing boolean NOT NULL DEFAULT false;
ALTER TABLE portal_clients ADD COLUMN IF NOT EXISTS vpat_file_id uuid REFERENCES portal_files(id) ON DELETE SET NULL;

INSERT INTO schema_migrations (version) VALUES ('015_portal_human_testing')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
