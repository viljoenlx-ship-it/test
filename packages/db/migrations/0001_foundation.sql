-- Omnivate foundation.
-- GOV-01 tenant isolation, GOV-02 append-only audit, GOV-03 no hard delete of posted rows.
-- The API connects as omnivate_app. Migrations and the seed use the database owner.
-- Locally that owner is the postgres superuser, which bypasses row-level security.
-- On Render the owner is not a superuser. Do not point the API at either login.

-- Only the application role and the superuser should connect. PostgreSQL grants
-- CONNECT to PUBLIC by default, which would let any new role in.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO omnivate_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO omnivate_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_demo boolean NOT NULL,
  timezone text NOT NULL,
  currency_code char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenants IS
  'One row per customer organisation. Demo rows are fictional and marked is_demo.';

CREATE TABLE foundation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE foundation_notes IS
  'Fixture used to prove tenant isolation. Not a business module.';

CREATE INDEX foundation_notes_tenant_id_idx ON foundation_notes (tenant_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_data jsonb NULL,
  after_data jsonb NULL,
  request_ip text NULL,
  user_agent text NULL
);

COMMENT ON TABLE audit_events IS
  'GOV-02 append-only audit trail. Product retention is 5 to 7 years. actor_id is filled in by KRN-01.';

CREATE INDEX audit_events_tenant_occurred_idx ON audit_events (tenant_id, occurred_at);

CREATE TABLE foundation_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft', 'posted')),
  description text NOT NULL,
  amount_cents bigint NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'ZAR',
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foundation_postings_status_timestamp CHECK (
    (status = 'draft' AND posted_at IS NULL)
    OR (status = 'posted' AND posted_at IS NOT NULL)
  )
);

COMMENT ON TABLE foundation_postings IS
  'Fixture proving GOV-03. Posted invoices, bills, journals, and payslips reuse gov_reject_posted_delete().';

COMMENT ON COLUMN foundation_postings.amount_cents IS
  'Exact integer cents. Never a float. Foundation currency is ZAR; the code is char(3) for later multi-currency.';

CREATE INDEX foundation_postings_tenant_id_idx ON foundation_postings (tenant_id);

CREATE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app_current_tenant_id() IS
  'Tenant for this transaction. Empty or missing means no rows, which fails closed.';

CREATE FUNCTION gov_reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GOV-02: audit_events is append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION gov_reject_audit_mutation();

CREATE FUNCTION gov_reject_posted_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'GOV-03: posted records cannot be hard-deleted; reverse them instead'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION gov_reject_posted_delete() IS
  'Attach this trigger to every table whose posted rows must be reversed instead of deleted.';

CREATE TRIGGER foundation_postings_no_hard_delete
  BEFORE DELETE ON foundation_postings
  FOR EACH ROW
  EXECUTE FUNCTION gov_reject_posted_delete();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  FOR SELECT
  USING (id = app_current_tenant_id());

ALTER TABLE foundation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE foundation_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY foundation_notes_isolation ON foundation_notes
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_isolation ON audit_events
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE foundation_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE foundation_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY foundation_postings_isolation ON foundation_postings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT ON tenants TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON foundation_notes TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_events TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON foundation_postings TO omnivate_app;

REVOKE ALL ON schema_migrations FROM omnivate_app;
