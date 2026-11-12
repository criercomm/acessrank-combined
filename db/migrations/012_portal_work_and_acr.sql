-- Accessrank — work to do on approved items, and the Accessibility Compliance Record (ACR) drafts
--
-- * portal_work_items: one row per report item the team has acted on. "done" means the change is
--   live on the client's store, not just finished in a test theme. acr_state tracks the item's
--   path into the ACR: 'none' (done, not queued), 'queued' (waiting for the next ACR update) or
--   'applied' (in a published ACR). The optional criterion and conformance are what the ACR's
--   conformance table should say for it; the note is the team's own, for the ACR log.
-- * portal_acr_drafts: the ACR file the next update is applied to, kept as versions. Team only:
--   nothing a client login can fetch ever reads this table. A row with published = true is the
--   ACR that was published to the client (a copy also goes to their Compliance files).
-- * Both cascade with the client (and work items with their report), like files and approvals.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_work_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  report_id     uuid NOT NULL REFERENCES portal_reports(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  item_key      text NOT NULL,
  done          boolean NOT NULL DEFAULT false,
  done_at       timestamptz,
  done_by_name  text NOT NULL DEFAULT '',
  done_by_email text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  criterion     text NOT NULL DEFAULT '' CHECK (char_length(criterion) <= 200),
  conformance   text NOT NULL DEFAULT '' CHECK (conformance IN ('', 'supports', 'partially_supports', 'does_not_support', 'not_applicable')),
  acr_state     text NOT NULL DEFAULT 'none' CHECK (acr_state IN ('none', 'queued', 'applied')),
  applied_at    timestamptz,
  UNIQUE (report_id, item_key)
);

CREATE INDEX IF NOT EXISTS portal_work_items_client_idx ON portal_work_items (client_id, acr_state);

CREATE TABLE IF NOT EXISTS portal_acr_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  client_id         uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  filename          text NOT NULL,
  content_type      text NOT NULL,
  size_bytes        integer NOT NULL CHECK (size_bytes > 0),
  data              bytea NOT NULL,
  uploaded_by_name  text NOT NULL DEFAULT '',
  uploaded_by_email text NOT NULL DEFAULT '',
  published         boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS portal_acr_drafts_client_idx ON portal_acr_drafts (client_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('012_portal_work_and_acr')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
