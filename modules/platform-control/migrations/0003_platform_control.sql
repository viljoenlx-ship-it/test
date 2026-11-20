-- Platform control panel.
-- Operators are not tenant users. omnivate_app cannot read their tables.
-- Tenant writes still go through withTenant. Cross-tenant reads use the
-- security-definer functions at the bottom, each one a named operation.
-- Row-level security on tenant tables is unchanged for omnivate_app.

CREATE TABLE platform_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  totp_secret text NULL,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_operators_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT platform_operators_name_present CHECK (length(btrim(display_name)) > 0)
);

COMMENT ON TABLE platform_operators IS
  'Platform staff. Not a tenant user. Password and TOTP are not granted to omnivate_app.';

CREATE TABLE platform_roles (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  mfa_required boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE platform_roles IS
  'Platform Owner and Platform Support. MFA cannot be turned off.';

CREATE TABLE platform_operator_roles (
  operator_id uuid NOT NULL REFERENCES platform_operators (id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES platform_roles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, role_id)
);

CREATE TABLE platform_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES platform_operators (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_ip text NULL,
  user_agent text NULL
);

COMMENT ON TABLE platform_sessions IS
  'Operator session. Separate from tenant sessions and from the omnivate_session cookie.';

CREATE TABLE platform_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES platform_operators (id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('mfa_enroll', 'mfa_verify')),
  token_hash text NOT NULL UNIQUE,
  totp_secret text NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NULL REFERENCES platform_operators (id) ON DELETE RESTRICT,
  email text NOT NULL,
  succeeded boolean NOT NULL,
  request_ip text NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_login_attempts_email_lowercase CHECK (email = lower(email))
);

COMMENT ON TABLE platform_login_attempts IS
  'Operator sign-in attempts. omnivate_app cannot delete them.';

CREATE INDEX platform_login_attempts_email_idx
  ON platform_login_attempts (email, attempted_at);

CREATE FUNCTION platform_keep_mfa() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mfa_required IS NOT TRUE THEN
    RAISE EXCEPTION 'MFA is mandatory for every platform operator role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_roles_mandatory_mfa
  BEFORE INSERT OR UPDATE ON platform_roles
  FOR EACH ROW
  EXECUTE FUNCTION platform_keep_mfa();

INSERT INTO platform_roles (id, key, name, description, mfa_required) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'platform_owner',
    'Platform Owner',
    'Runs the control panel. Can change every client.',
    true
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'platform_support',
    'Platform Support',
    'Can look up clients, their people, and the audit. Cannot change them.',
    true
  );

ALTER TABLE audit_events
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE audit_events
  ADD COLUMN actor_kind text NOT NULL DEFAULT 'user',
  ADD COLUMN operator_id uuid NULL REFERENCES platform_operators (id) ON DELETE RESTRICT;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_kind_check
  CHECK (actor_kind IN ('user', 'operator', 'system'));

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_shape CHECK (
    (actor_kind = 'operator' AND operator_id IS NOT NULL AND actor_id IS NULL)
    OR (actor_kind = 'user' AND operator_id IS NULL)
    OR (actor_kind = 'system' AND actor_id IS NULL AND operator_id IS NULL)
  );

COMMENT ON COLUMN audit_events.actor_kind IS
  'user is a tenant person. operator is platform staff. system is seed or an unknown sign-in.';

COMMENT ON COLUMN audit_events.operator_id IS
  'Set when actor_kind is operator. Tenant actor_id stays null for those rows.';

CREATE INDEX audit_events_operator_idx ON audit_events (operator_id) WHERE operator_id IS NOT NULL;

ALTER TABLE tenants
  ADD COLUMN company_name text NOT NULL DEFAULT '',
  ADD COLUMN legal_name text NULL,
  ADD COLUMN trading_name text NULL,
  ADD COLUMN registration_number text NULL,
  ADD COLUMN vat_number text NULL,
  ADD COLUMN contact_email text NULL,
  ADD COLUMN contact_phone text NULL,
  ADD COLUMN address_line1 text NULL,
  ADD COLUMN address_line2 text NULL,
  ADD COLUMN address_city text NULL,
  ADD COLUMN address_province text NULL,
  ADD COLUMN address_postal_code text NULL,
  ADD COLUMN address_country text NOT NULL DEFAULT 'ZA',
  ADD COLUMN industry_preset text NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN package_key text NOT NULL DEFAULT 'core',
  ADD COLUMN suspended_at timestamptz NULL,
  ADD COLUMN archived_at timestamptz NULL,
  ADD COLUMN brand_primary text NOT NULL DEFAULT '#4338ca',
  ADD COLUMN brand_accent text NOT NULL DEFAULT '#0f766e',
  ADD COLUMN logo_storage_key text NULL,
  ADD COLUMN vat_rate_basis_points integer NOT NULL DEFAULT 1500,
  ADD COLUMN financial_year_start_month integer NOT NULL DEFAULT 3,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION tenants_fill_company_name() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_name IS NULL OR btrim(NEW.company_name) = '' THEN
    NEW.company_name := NEW.display_name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_fill_company_name
  BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_fill_company_name();

UPDATE tenants SET company_name = display_name WHERE btrim(company_name) = '';

ALTER TABLE tenants
  ADD CONSTRAINT tenants_company_name_present CHECK (length(btrim(company_name)) > 0),
  ADD CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'archived')),
  ADD CONSTRAINT tenants_status_timestamps CHECK (
    (status = 'active' AND suspended_at IS NULL AND archived_at IS NULL)
    OR (status = 'suspended' AND suspended_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  ),
  ADD CONSTRAINT tenants_package_check CHECK (
    package_key IN ('core', 'essentials', 'operations', 'people', 'growth')
  ),
  ADD CONSTRAINT tenants_industry_check CHECK (
    industry_preset IS NULL OR industry_preset IN (
      'retail_hardware',
      'field_service',
      'manufacturing',
      'equipment_hire',
      'professional_services',
      'transport'
    )
  ),
  ADD CONSTRAINT tenants_country_check CHECK (address_country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT tenants_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT tenants_vat_check CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  ADD CONSTRAINT tenants_fy_check CHECK (financial_year_start_month BETWEEN 1 AND 12),
  ADD CONSTRAINT tenants_brand_primary_check CHECK (brand_primary ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT tenants_brand_accent_check CHECK (brand_accent ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT tenants_slug_check CHECK (slug ~ '^[a-z0-9-]{2,63}$');

CREATE INDEX tenants_status_name_idx ON tenants (status, company_name);

COMMENT ON COLUMN tenants.logo_storage_key IS
  'Tenant-scoped file key: <tenant id>/<file id>.<ext>. The browser never sends this path.';

COMMENT ON COLUMN tenants.vat_rate_basis_points IS
  'VAT rate in basis points. 1500 is 15%, the South Africa preset. Not a float.';

-- Operator creates and edits the tenant they name. They cannot see other tenants
-- in the same statement, because the policy still compares id to the transaction tenant.
CREATE POLICY tenants_insert ON tenants
  FOR INSERT
  WITH CHECK (id = app_current_tenant_id());

CREATE POLICY tenants_update ON tenants
  FOR UPDATE
  USING (id = app_current_tenant_id())
  WITH CHECK (id = app_current_tenant_id());

GRANT INSERT ON tenants TO omnivate_app;
GRANT UPDATE (
  slug,
  display_name,
  company_name,
  legal_name,
  trading_name,
  registration_number,
  vat_number,
  contact_email,
  contact_phone,
  address_line1,
  address_line2,
  address_city,
  address_province,
  address_postal_code,
  address_country,
  industry_preset,
  status,
  package_key,
  suspended_at,
  archived_at,
  brand_primary,
  brand_accent,
  logo_storage_key,
  timezone,
  currency_code,
  vat_rate_basis_points,
  financial_year_start_month,
  updated_at
) ON tenants TO omnivate_app;

GRANT INSERT, UPDATE ON roles TO omnivate_app;
GRANT INSERT, DELETE ON role_permissions TO omnivate_app;

-- Platform tables: forced row-level security and no policy for omnivate_app.
-- A direct SELECT is permission-denied. The functions below are the only door.

ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operators FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_operator_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operator_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_auth_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_login_attempts FORCE ROW LEVEL SECURITY;

-- Replace KRN lookups so a suspended or archived company cannot sign in.

DROP FUNCTION krn_tenant_by_slug(text);
CREATE FUNCTION krn_tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, slug text, display_name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.display_name, t.status
  FROM tenants AS t
  WHERE t.slug = p_slug;
$$;

DROP FUNCTION krn_login_memberships(uuid);
CREATE FUNCTION krn_login_memberships(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  membership_status text,
  mfa_required boolean,
  tenant_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.slug,
    t.display_name,
    m.status,
    COALESCE(bool_or(r.mfa_required), false),
    t.status
  FROM memberships AS m
  JOIN tenants AS t ON t.id = m.tenant_id
  LEFT JOIN user_roles AS ur ON ur.user_id = m.user_id AND ur.tenant_id = m.tenant_id
  LEFT JOIN roles AS r ON r.id = ur.role_id
  WHERE m.user_id = p_user_id
  GROUP BY t.id, t.slug, t.display_name, m.status, t.status;
$$;

DROP FUNCTION krn_session_by_token_hash(text);
CREATE FUNCTION krn_session_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  tenant_id uuid,
  email text,
  display_name text,
  user_status text,
  membership_status text,
  expires_at timestamptz,
  revoked_at timestamptz,
  expired boolean,
  tenant_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.user_id,
    s.tenant_id,
    u.email,
    u.display_name,
    u.status,
    m.status,
    s.expires_at,
    s.revoked_at,
    s.expires_at <= now(),
    t.status
  FROM sessions AS s
  JOIN users AS u ON u.id = s.user_id
  JOIN memberships AS m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
  JOIN tenants AS t ON t.id = s.tenant_id
  WHERE s.token_hash = p_token_hash;
$$;

DROP FUNCTION krn_invite_by_token_hash(text);
CREATE FUNCTION krn_invite_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role_id uuid,
  role_key text,
  role_name text,
  mfa_required boolean,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  tenant_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.tenant_id,
    t.display_name,
    i.email,
    i.role_id,
    r.key,
    r.name,
    r.mfa_required,
    i.expires_at,
    i.accepted_at,
    i.revoked_at,
    t.status
  FROM user_invites AS i
  JOIN tenants AS t ON t.id = i.tenant_id
  JOIN roles AS r ON r.id = i.role_id
  WHERE i.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION krn_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_login_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_session_by_token_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_invite_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION krn_tenant_by_slug(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_login_memberships(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_session_by_token_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_invite_by_token_hash(text) TO omnivate_app;

CREATE FUNCTION tenant_public_branding(p_slug text)
RETURNS TABLE (
  slug text,
  display_name text,
  brand_primary text,
  brand_accent text,
  has_logo boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.slug, t.display_name, t.brand_primary, t.brand_accent, t.logo_storage_key IS NOT NULL
  FROM tenants AS t
  WHERE t.slug = p_slug;
$$;

CREATE FUNCTION tenant_logo_key(p_slug text)
RETURNS TABLE (tenant_id uuid, logo_storage_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.logo_storage_key
  FROM tenants AS t
  WHERE t.slug = p_slug AND t.logo_storage_key IS NOT NULL;
$$;

CREATE FUNCTION platform_operator_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  password_hash text,
  status text,
  totp_secret text,
  totp_enabled boolean,
  role_keys text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.email,
    o.display_name,
    o.password_hash,
    o.status,
    o.totp_secret,
    o.totp_enabled,
    COALESCE(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), '{}')
  FROM platform_operators AS o
  LEFT JOIN platform_operator_roles AS por ON por.operator_id = o.id
  LEFT JOIN platform_roles AS r ON r.id = por.role_id
  WHERE o.email = lower(p_email)
  GROUP BY o.id;
$$;

CREATE FUNCTION platform_failure_count(p_email text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM platform_login_attempts
  WHERE email = lower(p_email)
    AND succeeded = false
    AND attempted_at > now() - interval '15 minutes'
    AND attempted_at > COALESCE((
      SELECT max(attempted_at)
      FROM platform_login_attempts
      WHERE email = lower(p_email) AND succeeded = true
    ), '-infinity'::timestamptz);
$$;

CREATE FUNCTION platform_record_attempt(
  p_email text,
  p_operator_id uuid,
  p_succeeded boolean,
  p_ip text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO platform_login_attempts (email, operator_id, succeeded, request_ip)
  VALUES (lower(p_email), p_operator_id, p_succeeded, p_ip);
$$;

CREATE FUNCTION platform_open_challenge(
  p_operator_id uuid,
  p_purpose text,
  p_token_hash text,
  p_totp_secret text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO platform_auth_challenges (operator_id, purpose, token_hash, totp_secret, expires_at)
  VALUES (p_operator_id, p_purpose, p_token_hash, p_totp_secret, p_expires_at)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION platform_challenge_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  purpose text,
  totp_secret text,
  failed_attempts integer,
  expires_at timestamptz,
  consumed_at timestamptz,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.operator_id, c.purpose, c.totp_secret, c.failed_attempts, c.expires_at, c.consumed_at, o.email
  FROM platform_auth_challenges AS c
  JOIN platform_operators AS o ON o.id = c.operator_id
  WHERE c.token_hash = p_token_hash;
$$;

CREATE FUNCTION platform_touch_challenge(
  p_id uuid,
  p_failed integer,
  p_consumed timestamptz
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE platform_auth_challenges
  SET failed_attempts = p_failed, consumed_at = p_consumed
  WHERE id = p_id;
$$;

CREATE FUNCTION platform_set_totp(p_operator_id uuid, p_secret text, p_enabled boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE platform_operators
  SET totp_secret = p_secret, totp_enabled = p_enabled
  WHERE id = p_operator_id;
$$;

CREATE FUNCTION platform_totp_secret(p_operator_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT totp_secret FROM platform_operators WHERE id = p_operator_id;
$$;

CREATE FUNCTION platform_open_session(
  p_operator_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_ip text,
  p_user_agent text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO platform_sessions (operator_id, token_hash, expires_at, request_ip, user_agent)
  VALUES (p_operator_id, p_token_hash, p_expires_at, p_ip, p_user_agent)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION platform_session_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  email text,
  display_name text,
  status text,
  role_keys text[],
  expires_at timestamptz,
  revoked_at timestamptz,
  expired boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.operator_id,
    o.email,
    o.display_name,
    o.status,
    COALESCE(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), '{}'),
    s.expires_at,
    s.revoked_at,
    s.expires_at <= now()
  FROM platform_sessions AS s
  JOIN platform_operators AS o ON o.id = s.operator_id
  LEFT JOIN platform_operator_roles AS por ON por.operator_id = o.id
  LEFT JOIN platform_roles AS r ON r.id = por.role_id
  WHERE s.token_hash = p_token_hash
  GROUP BY s.id, o.id;
$$;

CREATE FUNCTION platform_revoke_session(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE platform_sessions SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;
$$;

CREATE FUNCTION platform_insert_audit(
  p_tenant_id uuid,
  p_operator_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_ip text,
  p_user_agent text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO audit_events (
    tenant_id, actor_kind, actor_id, operator_id, action, entity_type, entity_id,
    before_data, after_data, request_ip, user_agent
  ) VALUES (
    p_tenant_id, 'operator', NULL, p_operator_id, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_ip, p_user_agent
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION platform_escape_like(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

CREATE FUNCTION platform_search_tenants(p_query text, p_status text, p_limit integer)
RETURNS TABLE (
  id uuid,
  slug text,
  company_name text,
  display_name text,
  status text,
  industry_preset text,
  package_key text,
  contact_email text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.slug, t.company_name, t.display_name, t.status, t.industry_preset,
    t.package_key, t.contact_email, t.created_at
  FROM tenants AS t
  WHERE (
    p_status = 'all'
    OR (p_status IN ('', 'open') AND t.status <> 'archived')
    OR t.status = p_status
  )
  AND (
    btrim(COALESCE(p_query, '')) = ''
    OR t.company_name ILIKE '%' || platform_escape_like(btrim(p_query)) || '%' ESCAPE '\'
    OR t.slug ILIKE '%' || platform_escape_like(btrim(p_query)) || '%' ESCAPE '\'
    OR COALESCE(t.legal_name, '') ILIKE '%' || platform_escape_like(btrim(p_query)) || '%' ESCAPE '\'
    OR COALESCE(t.trading_name, '') ILIKE '%' || platform_escape_like(btrim(p_query)) || '%' ESCAPE '\'
  )
  ORDER BY t.company_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
$$;

CREATE FUNCTION platform_search_audit(
  p_tenant_id uuid,
  p_actor text,
  p_action text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  occurred_at timestamptz,
  actor_kind text,
  actor_id uuid,
  operator_id uuid,
  actor_label text,
  action text,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.tenant_id,
    t.company_name,
    e.occurred_at,
    e.actor_kind,
    e.actor_id,
    e.operator_id,
    COALESCE(op.email, u.email, 'system'),
    e.action,
    e.entity_type,
    e.entity_id,
    e.before_data,
    e.after_data
  FROM audit_events AS e
  LEFT JOIN tenants AS t ON t.id = e.tenant_id
  LEFT JOIN platform_operators AS op ON op.id = e.operator_id
  LEFT JOIN users AS u ON u.id = e.actor_id
  WHERE (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
    AND (p_from IS NULL OR e.occurred_at >= p_from)
    AND (p_to IS NULL OR e.occurred_at < p_to)
    AND (
      btrim(COALESCE(p_action, '')) = ''
      OR e.action ILIKE '%' || platform_escape_like(btrim(p_action)) || '%' ESCAPE '\'
    )
    AND (
      btrim(COALESCE(p_actor, '')) = ''
      OR COALESCE(op.email, u.email, 'system') ILIKE '%' || platform_escape_like(btrim(p_actor)) || '%' ESCAPE '\'
    )
  ORDER BY e.occurred_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

CREATE FUNCTION platform_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tenantsActive', (SELECT count(*) FROM tenants WHERE status = 'active'),
    'tenantsSuspended', (SELECT count(*) FROM tenants WHERE status = 'suspended'),
    'tenantsArchived', (SELECT count(*) FROM tenants WHERE status = 'archived'),
    'users', (SELECT count(DISTINCT user_id) FROM memberships WHERE status = 'active')
  );
$$;

REVOKE ALL ON FUNCTION tenant_public_branding(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_logo_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_operator_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_failure_count(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_record_attempt(text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_open_challenge(uuid, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_challenge_by_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_touch_challenge(uuid, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_set_totp(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_totp_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_open_session(uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_session_by_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_revoke_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_insert_audit(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_escape_like(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_search_tenants(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_search_audit(uuid, text, text, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_dashboard() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION tenant_public_branding(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION tenant_logo_key(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_operator_by_email(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_failure_count(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_record_attempt(text, uuid, boolean, text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_open_challenge(uuid, text, text, text, timestamptz) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_challenge_by_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_touch_challenge(uuid, integer, timestamptz) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_set_totp(uuid, text, boolean) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_totp_secret(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_open_session(uuid, text, timestamptz, text, text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_session_by_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_revoke_session(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_insert_audit(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_search_tenants(text, text, integer) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_search_audit(uuid, text, text, timestamptz, timestamptz, integer) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_dashboard() TO omnivate_app;
