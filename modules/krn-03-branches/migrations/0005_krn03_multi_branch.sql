-- KRN-03 Multi-Branch & Inter-Company Structure.
-- Every company starts with one Head Office on its primary legal entity.
-- More branches stay hidden until the company turns multi-branch on.
-- Rows are archived, not deleted. omnivate_app has no DELETE grant.
-- Legal entities and the link table are groundwork. This module posts no inter-company transactions.

CREATE TABLE krn03_legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  registration_number text NULL,
  vat_number text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn03_legal_entities_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160)
);

COMMENT ON TABLE krn03_legal_entities IS
  'Legal entities inside one tenant. A branch belongs to one entity. No inter-company journals are posted here.';

CREATE UNIQUE INDEX krn03_legal_entities_one_primary
  ON krn03_legal_entities (tenant_id)
  WHERE is_primary AND archived_at IS NULL;

CREATE INDEX krn03_legal_entities_tenant_idx ON krn03_legal_entities (tenant_id);

CREATE TABLE krn03_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES krn03_legal_entities (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  address_line1 text NULL,
  address_line2 text NULL,
  city text NULL,
  province text NULL,
  postal_code text NULL,
  country char(2) NOT NULL DEFAULT 'ZA',
  contact_name text NULL,
  contact_email text NULL,
  contact_phone text NULL,
  active boolean NOT NULL DEFAULT true,
  is_head_office boolean NOT NULL DEFAULT false,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn03_branches_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT krn03_branches_code_shape CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  CONSTRAINT krn03_branches_country_shape CHECK (country ~ '^[A-Z]{2}$')
);

COMMENT ON TABLE krn03_branches IS
  'Places a company works from. Head Office is created with the company. Archive instead of delete.';

COMMENT ON COLUMN krn03_branches.code IS
  'Short branch code for later document numbers. Unique among branches that are not archived.';

CREATE UNIQUE INDEX krn03_branches_code_live
  ON krn03_branches (tenant_id, code)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX krn03_branches_one_head_office
  ON krn03_branches (tenant_id)
  WHERE is_head_office AND archived_at IS NULL;

CREATE INDEX krn03_branches_tenant_idx ON krn03_branches (tenant_id);

CREATE TABLE krn03_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  multi_branch_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE krn03_settings IS
  'One row per company. multi_branch_enabled false means people only work at Head Office and never see a branch picker.';

CREATE TABLE krn03_branch_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);

COMMENT ON TABLE krn03_branch_access IS
  'Which person may work at which branch once multi-branch is on. Owners bypass this through kernel admin. Revoke instead of delete.';

CREATE UNIQUE INDEX krn03_branch_access_live
  ON krn03_branch_access (tenant_id, user_id, branch_id)
  WHERE revoked_at IS NULL;

CREATE INDEX krn03_branch_access_tenant_idx ON krn03_branch_access (tenant_id);

CREATE TABLE krn03_current_branch (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES krn03_branches (id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

COMMENT ON TABLE krn03_current_branch IS
  'The branch a person is working in. Ignored while the company has a single branch.';

CREATE TABLE krn03_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES krn03_legal_entities (id) ON DELETE CASCADE,
  to_entity_id uuid NOT NULL REFERENCES krn03_legal_entities (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sister', 'parent')),
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krn03_entity_links_distinct CHECK (from_entity_id <> to_entity_id)
);

COMMENT ON TABLE krn03_entity_links IS
  'Groundwork for how legal entities in one tenant relate. KRN-03 does not post inter-company transactions.';

CREATE UNIQUE INDEX krn03_entity_links_live
  ON krn03_entity_links (tenant_id, from_entity_id, to_entity_id)
  WHERE archived_at IS NULL;

CREATE INDEX krn03_entity_links_tenant_idx ON krn03_entity_links (tenant_id);

CREATE FUNCTION krn03_reject_tenant_move() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A record cannot move to another company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION krn03_branch_entity_same_company() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A record cannot move to another company'
      USING ERRCODE = '23514';
  END IF;

  SELECT tenant_id INTO entity_tenant
  FROM krn03_legal_entities
  WHERE id = NEW.legal_entity_id;

  IF entity_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'A branch must belong to a legal entity in the same company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION krn03_access_same_company() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  branch_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A record cannot move to another company'
      USING ERRCODE = '23514';
  END IF;

  SELECT tenant_id INTO branch_tenant
  FROM krn03_branches
  WHERE id = NEW.branch_id;

  IF branch_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'That branch is not in this company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION krn03_link_same_company() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  from_tenant uuid;
  to_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A record cannot move to another company'
      USING ERRCODE = '23514';
  END IF;

  SELECT tenant_id INTO from_tenant FROM krn03_legal_entities WHERE id = NEW.from_entity_id;
  SELECT tenant_id INTO to_tenant FROM krn03_legal_entities WHERE id = NEW.to_entity_id;

  IF from_tenant IS DISTINCT FROM NEW.tenant_id OR to_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Related entities must belong to the same company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER krn03_legal_entities_no_move
  BEFORE UPDATE ON krn03_legal_entities
  FOR EACH ROW
  EXECUTE FUNCTION krn03_reject_tenant_move();

CREATE TRIGGER krn03_branches_same_company
  BEFORE INSERT OR UPDATE ON krn03_branches
  FOR EACH ROW
  EXECUTE FUNCTION krn03_branch_entity_same_company();

CREATE TRIGGER krn03_branch_access_same_company
  BEFORE INSERT OR UPDATE ON krn03_branch_access
  FOR EACH ROW
  EXECUTE FUNCTION krn03_access_same_company();

CREATE TRIGGER krn03_current_branch_same_company
  BEFORE INSERT OR UPDATE ON krn03_current_branch
  FOR EACH ROW
  EXECUTE FUNCTION krn03_access_same_company();

CREATE TRIGGER krn03_entity_links_same_company
  BEFORE INSERT OR UPDATE ON krn03_entity_links
  FOR EACH ROW
  EXECUTE FUNCTION krn03_link_same_company();

CREATE TRIGGER krn03_settings_no_move
  BEFORE UPDATE ON krn03_settings
  FOR EACH ROW
  EXECUTE FUNCTION krn03_reject_tenant_move();

-- Creates the primary legal entity, Head Office, and the single-branch setting.
-- Safe to call again. omnivate_app may only provision the company already on the transaction.
CREATE FUNCTION krn03_ensure_head_office(company_id uuid) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  entity_id uuid;
  branch_id uuid;
  company tenants%ROWTYPE;
BEGIN
  IF current_user = 'omnivate_app'
     AND app_current_tenant_id() IS DISTINCT FROM company_id THEN
    RAISE EXCEPTION 'Branch setup is limited to the current company'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.current_tenant_id', company_id::text, true);

  SELECT * INTO company FROM tenants WHERE id = company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company % was not found', company_id
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO krn03_settings (tenant_id)
  VALUES (company.id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT id INTO entity_id
  FROM krn03_legal_entities
  WHERE tenant_id = company.id AND is_primary AND archived_at IS NULL
  LIMIT 1;

  IF entity_id IS NULL THEN
    INSERT INTO krn03_legal_entities (
      tenant_id, name, registration_number, vat_number, is_primary
    ) VALUES (
      company.id,
      COALESCE(
        NULLIF(btrim(company.legal_name), ''),
        NULLIF(btrim(company.company_name), ''),
        company.display_name
      ),
      NULLIF(btrim(COALESCE(company.registration_number, '')), ''),
      NULLIF(btrim(COALESCE(company.vat_number, '')), ''),
      true
    )
    RETURNING id INTO entity_id;
  END IF;

  SELECT id INTO branch_id
  FROM krn03_branches
  WHERE tenant_id = company.id AND is_head_office AND archived_at IS NULL
  LIMIT 1;

  IF branch_id IS NULL THEN
    INSERT INTO krn03_branches (
      tenant_id, legal_entity_id, name, code,
      address_line1, address_line2, city, province, postal_code, country,
      contact_email, contact_phone, active, is_head_office
    ) VALUES (
      company.id,
      entity_id,
      'Head Office',
      'HO',
      company.address_line1,
      company.address_line2,
      company.address_city,
      company.address_province,
      company.address_postal_code,
      COALESCE(NULLIF(btrim(company.address_country), ''), 'ZA'),
      company.contact_email,
      company.contact_phone,
      true,
      true
    )
    RETURNING id INTO branch_id;
  END IF;

  RETURN branch_id;
END;
$$;

COMMENT ON FUNCTION krn03_ensure_head_office(uuid) IS
  'Gives a company its primary legal entity and Head Office. Does not turn on multi-branch.';

CREATE FUNCTION krn03_provision_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM krn03_ensure_head_office(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER krn03_tenant_provision
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION krn03_provision_tenant();

DO $$
DECLARE
  company_id uuid;
BEGIN
  FOR company_id IN SELECT id FROM tenants LOOP
    PERFORM krn03_ensure_head_office(company_id);
  END LOOP;
END
$$;

ALTER TABLE krn03_legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_legal_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_legal_entities_isolation ON krn03_legal_entities
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn03_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_branches_isolation ON krn03_branches
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn03_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_settings_isolation ON krn03_settings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn03_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_branch_access FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_branch_access_isolation ON krn03_branch_access
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn03_current_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_current_branch FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_current_branch_isolation ON krn03_current_branch
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn03_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn03_entity_links FORCE ROW LEVEL SECURITY;
CREATE POLICY krn03_entity_links_isolation ON krn03_entity_links
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON krn03_legal_entities TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn03_branches TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn03_settings TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn03_branch_access TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn03_current_branch TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn03_entity_links TO omnivate_app;

REVOKE ALL ON FUNCTION krn03_ensure_head_office(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn03_provision_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION krn03_reject_tenant_move() FROM PUBLIC;
REVOKE ALL ON FUNCTION krn03_branch_entity_same_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION krn03_access_same_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION krn03_link_same_company() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION krn03_ensure_head_office(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn03_provision_tenant() TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn03_reject_tenant_move() TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn03_branch_entity_same_company() TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn03_access_same_company() TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn03_link_same_company() TO omnivate_app;
