-- KRN-02 Unified Party Directory.
-- One party can be a customer, a supplier, staff, and other at the same time (ABS-01).
-- Rows are archived, not deleted. omnivate_app has no DELETE on parties.
-- ID and passport numbers are stored for masking. They are not encrypted (GOV-04 is later)
-- and they are left out of audit JSON (ADR 0006).

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('organisation', 'person')),
  display_name text NOT NULL,
  legal_name text NULL,
  trading_name text NULL,
  given_name text NULL,
  family_name text NULL,
  registration_number text NULL,
  vat_number text NULL,
  id_number text NULL,
  passport_number text NULL,
  popia_consent boolean NOT NULL DEFAULT false,
  popia_consent_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_name_length CHECK (char_length(display_name) BETWEEN 2 AND 160),
  CONSTRAINT parties_shape CHECK (
    (
      kind = 'organisation'
      AND given_name IS NULL
      AND family_name IS NULL
      AND id_number IS NULL
      AND passport_number IS NULL
    )
    OR (
      kind = 'person'
      AND given_name IS NOT NULL
      AND family_name IS NOT NULL
      AND registration_number IS NULL
    )
  ),
  CONSTRAINT parties_popia_timestamp CHECK (
    (popia_consent = true AND popia_consent_at IS NOT NULL)
    OR (popia_consent = false AND popia_consent_at IS NULL)
  ),
  CONSTRAINT parties_archive_timestamp CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  )
);

COMMENT ON TABLE parties IS
  'KRN-02 contact master. Customers, suppliers, and staff are roles on this row, not separate tables.';

COMMENT ON COLUMN parties.id_number IS
  'South African ID for a person. Sensitive. Masked unless the caller holds krn.admin. Not copied into audit JSON.';

COMMENT ON COLUMN parties.passport_number IS
  'Passport number for a person. Sensitive. Masked unless the caller holds krn.admin. Not copied into audit JSON.';

COMMENT ON COLUMN parties.popia_consent IS
  'GOV-06 consent flag. popia_consent_at is the timestamped proof. Erasure is not implemented in this module.';

CREATE INDEX parties_tenant_status_idx ON parties (tenant_id, status);
CREATE INDEX parties_tenant_name_idx ON parties (tenant_id, lower(display_name));
CREATE INDEX parties_tenant_vat_idx ON parties (tenant_id, vat_number) WHERE vat_number IS NOT NULL;

CREATE TABLE party_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'supplier', 'staff', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, role)
);

COMMENT ON TABLE party_roles IS
  'Roles on one party. A single business or person can hold several at once.';

CREATE INDEX party_roles_tenant_role_idx ON party_roles (tenant_id, role);

CREATE TABLE party_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  name text NOT NULL,
  job_title text NULL,
  email text NULL,
  phone text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_contacts_email_lower CHECK (email IS NULL OR email = lower(email))
);

COMMENT ON TABLE party_contacts IS
  'People at a party, such as an accounts clerk. The party itself may be a person and still have none of these.';

CREATE INDEX party_contacts_party_idx ON party_contacts (party_id);

CREATE TABLE party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('physical', 'postal', 'billing', 'delivery')),
  line1 text NOT NULL,
  line2 text NULL,
  suburb text NULL,
  city text NOT NULL,
  province text NULL,
  postal_code text NULL,
  country char(2) NOT NULL DEFAULT 'ZA',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_addresses IS
  'Addresses for a party. country is ISO 3166-1 alpha-2. ZA is the South African default.';

CREATE INDEX party_addresses_party_idx ON party_addresses (party_id);

CREATE TABLE party_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('phone', 'email')),
  value text NOT NULL,
  label text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_channels_email_lower CHECK (kind <> 'email' OR value = lower(value))
);

COMMENT ON TABLE party_channels IS
  'Phone numbers and email addresses on the party, separate from people in party_contacts.';

CREATE INDEX party_channels_party_idx ON party_channels (party_id);
CREATE INDEX party_channels_email_idx ON party_channels (tenant_id, value) WHERE kind = 'email';

CREATE TABLE party_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, tag),
  CONSTRAINT party_tags_lower CHECK (tag = lower(tag))
);

COMMENT ON TABLE party_tags IS 'Short labels on a party, stored in lowercase.';

CREATE INDEX party_tags_tenant_tag_idx ON party_tags (tenant_id, tag);

CREATE TABLE party_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  body text NOT NULL,
  author_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_notes IS
  'Notes on a party. The app role can insert but not update or delete them.';

CREATE INDEX party_notes_party_idx ON party_notes (party_id, created_at);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
CREATE POLICY parties_isolation ON parties
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY party_roles_isolation ON party_roles
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY party_contacts_isolation ON party_contacts
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY party_addresses_isolation ON party_addresses
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY party_channels_isolation ON party_channels
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY party_tags_isolation ON party_tags
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE party_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY party_notes_isolation ON party_notes
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON parties TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON party_roles TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON party_contacts TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON party_addresses TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON party_channels TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON party_tags TO omnivate_app;
GRANT SELECT, INSERT ON party_notes TO omnivate_app;
