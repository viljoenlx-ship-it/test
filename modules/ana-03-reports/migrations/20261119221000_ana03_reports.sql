-- ANA-03 saved reports. Rows are archived, never deleted.
-- omnivate_app has no DELETE grant. The company app and the control panel
-- both write through withTenant, so row-level security still applies.

CREATE TABLE ana03_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  source_key text NOT NULL,
  definition jsonb NOT NULL,
  visibility text NOT NULL,
  owner_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  shared_roles text[] NOT NULL DEFAULT '{}',
  ready_key text NULL,
  archived_at timestamptz NULL,
  created_by_kind text NOT NULL,
  operator_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ana03_reports_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT ana03_reports_visibility CHECK (visibility IN ('private', 'roles', 'ready_made')),
  CONSTRAINT ana03_reports_kind CHECK (created_by_kind IN ('user', 'operator', 'system')),
  CONSTRAINT ana03_reports_definition_object CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT ana03_reports_private_owner CHECK (visibility <> 'private' OR owner_user_id IS NOT NULL)
);

COMMENT ON TABLE ana03_reports IS
  'Saved report definitions for ANA-03. Ready-made rows are shared with the company. Private rows stay with the owner.';

CREATE UNIQUE INDEX ana03_reports_ready_key
  ON ana03_reports (tenant_id, ready_key)
  WHERE ready_key IS NOT NULL AND archived_at IS NULL;

CREATE INDEX ana03_reports_tenant_idx
  ON ana03_reports (tenant_id)
  WHERE archived_at IS NULL;

ALTER TABLE ana03_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ana03_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY ana03_reports_isolation ON ana03_reports
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON ana03_reports TO omnivate_app;
