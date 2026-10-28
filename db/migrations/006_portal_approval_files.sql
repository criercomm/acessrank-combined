-- Accessrank — files kept with a client's past approvals
--
-- The team can upload completed approvals (for example a signed PDF a client
-- returned) into the client's Past approvals. They are ordinary portal files
-- with a third area, 'approvals', alongside 'files' and 'compliance'.

BEGIN;

ALTER TABLE portal_files DROP CONSTRAINT IF EXISTS portal_files_area_check;
ALTER TABLE portal_files
  ADD CONSTRAINT portal_files_area_check CHECK (area IN ('files', 'compliance', 'approvals'));

INSERT INTO schema_migrations (version) VALUES ('006_portal_approval_files')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
