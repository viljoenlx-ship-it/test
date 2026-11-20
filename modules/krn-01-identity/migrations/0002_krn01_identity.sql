-- KRN-01 Identity, Users & Zero-Trust RBAC.
-- Users are global people. Membership is what makes a person belong to a tenant.
-- A user with no membership in the current tenant is invisible. No tenant set means no rows.
-- Password hashes and TOTP secrets are not granted to omnivate_app. Credential changes go
-- through the security-definer functions below, which the migration role owns.
-- The API still connects as omnivate_app and still sets the tenant from the session.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  totp_secret text NULL,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_display_name_present CHECK (length(btrim(display_name)) > 0)
);

COMMENT ON TABLE users IS
  'One login per person. Not tenant-owned. Visibility is through memberships and row-level security.';

COMMENT ON COLUMN users.password_hash IS
  'Argon2id PHC string. omnivate_app cannot select this column.';

COMMENT ON COLUMN users.totp_secret IS
  'Base32 TOTP secret. Null until enrollment finishes. omnivate_app cannot select this column.';

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

COMMENT ON TABLE memberships IS
  'A person inside one company. Deactivated members stay in the list and cannot sign in.';

CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE INDEX memberships_tenant_id_idx ON memberships (tenant_id);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  mfa_required boolean NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

COMMENT ON TABLE roles IS
  'Seeded from blueprint tab 7. mfa_required is mandatory for tenant_owner and accountant.';

CREATE INDEX roles_tenant_id_idx ON roles (tenant_id);

CREATE TABLE role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  scope text NOT NULL,
  modules text[] NOT NULL,
  action text NOT NULL CHECK (
    action IN ('admin', 'read', 'operate', 'post', 'approve', 'submit', 'self', 'counseling')
  ),
  access_label text NOT NULL,
  approval_limit_cents bigint NULL,
  UNIQUE (tenant_id, role_id, scope, action)
);

COMMENT ON TABLE role_permissions IS
  'Granular grants. approval_limit_cents is an integer cent cap for approve. Null is uncapped.';

COMMENT ON COLUMN role_permissions.approval_limit_cents IS
  'Exact integer cents. Never a float. Null means this grant is not amount-capped.';

CREATE INDEX role_permissions_role_idx ON role_permissions (tenant_id, role_id);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  assigned_by uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, role_id)
);

COMMENT ON TABLE user_roles IS
  'Roles a member holds in one tenant. Effective access is the union. Deny by default.';

CREATE INDEX user_roles_member_idx ON user_roles (tenant_id, user_id);

CREATE TABLE user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  invited_by uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_email_lowercase CHECK (email = lower(email))
);

COMMENT ON TABLE user_invites IS
  'Onboarding token. Only the hash is stored. The link is handed to the mailer.';

CREATE INDEX user_invites_tenant_id_idx ON user_invites (tenant_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_ip text NULL,
  user_agent text NULL
);

COMMENT ON TABLE sessions IS
  'Opaque session. The cookie holds the raw token. The database holds the hash. Short-lived.';

CREATE INDEX sessions_member_idx ON sessions (tenant_id, user_id);

CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('mfa_enroll', 'mfa_verify')),
  token_hash text NOT NULL UNIQUE,
  totp_secret text NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth_challenges IS
  'Password succeeded, session not issued yet. Enrollment secret lives here until confirmed.';

CREATE INDEX auth_challenges_tenant_id_idx ON auth_challenges (tenant_id);

CREATE TABLE login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  email text NOT NULL,
  succeeded boolean NOT NULL,
  request_ip text NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_attempts_email_lowercase CHECK (email = lower(email))
);

COMMENT ON TABLE login_attempts IS
  'Sign-in successes and failures. The app role cannot delete them, so a lockout cannot be wiped.';

CREATE INDEX login_attempts_email_idx ON login_attempts (tenant_id, email, attempted_at);

CREATE TABLE sod_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  action_a text NOT NULL,
  action_b text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sod_rules_ordered CHECK (action_a < action_b),
  UNIQUE (tenant_id, action_a, action_b)
);

COMMENT ON TABLE sod_rules IS
  'GOV-07 maker-checker pairs. Modules later audit the same action keys on one entity.';

CREATE INDEX sod_rules_tenant_id_idx ON sod_rules (tenant_id);

CREATE TABLE tenant_modules (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  module_id text NOT NULL,
  active boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_id)
);

COMMENT ON TABLE tenant_modules IS
  'Which modules a tenant has switched on. KRN-01 is always on.';

CREATE INDEX tenant_modules_tenant_id_idx ON tenant_modules (tenant_id);

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_id_fk
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT;

COMMENT ON COLUMN audit_events.actor_id IS
  'KRN-01 user who performed the action. Null for system seed or an unknown sign-in.';

CREATE FUNCTION krn_reject_root_module_disable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.module_id = 'KRN-01' THEN
    RAISE EXCEPTION 'KRN-01 is part of the kernel foundation and cannot be disabled'
      USING ERRCODE = '42501';
  END IF;
  IF (TG_OP = 'UPDATE' OR TG_OP = 'INSERT') AND NEW.module_id = 'KRN-01' AND NEW.active = false THEN
    RAISE EXCEPTION 'KRN-01 is part of the kernel foundation and cannot be disabled'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_modules_root_required
  BEFORE INSERT OR UPDATE OR DELETE ON tenant_modules
  FOR EACH ROW
  EXECUTE FUNCTION krn_reject_root_module_disable();

CREATE FUNCTION krn_keep_mandatory_mfa() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('tenant_owner', 'accountant') AND NEW.mfa_required IS NOT TRUE THEN
    RAISE EXCEPTION 'MFA is mandatory for the owner and accountant roles'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roles_mandatory_mfa
  BEFORE INSERT OR UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION krn_keep_mandatory_mfa();

-- Credential and pre-session lookups. The migration role owns these functions.
-- A superuser bypasses row-level security. Where the migration role cannot (Render),
-- migrate() adds a policy that names only that role so each function still returns
-- the one row for a secret the caller already has. They do not list a tenant.

CREATE FUNCTION krn_tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, slug text, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.display_name
  FROM tenants AS t
  WHERE t.slug = p_slug;
$$;

CREATE FUNCTION krn_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  password_hash text,
  status text,
  totp_secret text,
  totp_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u.display_name, u.password_hash, u.status, u.totp_secret, u.totp_enabled
  FROM users AS u
  WHERE u.email = lower(p_email);
$$;

CREATE FUNCTION krn_login_memberships(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  membership_status text,
  mfa_required boolean
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
    COALESCE(bool_or(r.mfa_required), false)
  FROM memberships AS m
  JOIN tenants AS t ON t.id = m.tenant_id
  LEFT JOIN user_roles AS ur ON ur.user_id = m.user_id AND ur.tenant_id = m.tenant_id
  LEFT JOIN roles AS r ON r.id = ur.role_id
  WHERE m.user_id = p_user_id
  GROUP BY t.id, t.slug, t.display_name, m.status;
$$;

CREATE FUNCTION krn_insert_user(p_email text, p_display_name text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO users (email, display_name, password_hash, status)
  VALUES (lower(p_email), p_display_name, p_password_hash, 'active')
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION krn_set_password(p_user_id uuid, p_password_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users SET password_hash = p_password_hash WHERE id = p_user_id;
$$;

CREATE FUNCTION krn_set_totp(p_user_id uuid, p_secret text, p_enabled boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users
  SET totp_secret = p_secret, totp_enabled = p_enabled
  WHERE id = p_user_id;
$$;

CREATE FUNCTION krn_totp_secret(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT totp_secret FROM users WHERE id = p_user_id;
$$;

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
  expired boolean
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
    s.expires_at <= now()
  FROM sessions AS s
  JOIN users AS u ON u.id = s.user_id
  JOIN memberships AS m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
  WHERE s.token_hash = p_token_hash;
$$;

CREATE FUNCTION krn_challenge_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  purpose text,
  totp_secret text,
  failed_attempts integer,
  expires_at timestamptz,
  consumed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.tenant_id, c.user_id, c.purpose, c.totp_secret, c.failed_attempts, c.expires_at, c.consumed_at
  FROM auth_challenges AS c
  WHERE c.token_hash = p_token_hash;
$$;

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
  revoked_at timestamptz
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
    i.revoked_at
  FROM user_invites AS i
  JOIN tenants AS t ON t.id = i.tenant_id
  JOIN roles AS r ON r.id = i.role_id
  WHERE i.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION krn_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_login_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_insert_user(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_set_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_set_totp(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_totp_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_session_by_token_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_challenge_by_token_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION krn_invite_by_token_hash(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION krn_tenant_by_slug(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_user_by_email(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_login_memberships(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_insert_user(text, text, text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_set_password(uuid, text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_set_totp(uuid, text, boolean) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_totp_secret(uuid) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_session_by_token_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_challenge_by_token_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION krn_invite_by_token_hash(text) TO omnivate_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_visibility ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM memberships AS m
      WHERE m.user_id = users.id
        AND m.tenant_id = app_current_tenant_id()
    )
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_isolation ON role_permissions
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_roles_isolation ON user_roles
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;
CREATE POLICY user_invites_isolation ON user_invites
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_isolation ON sessions
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_challenges_isolation ON auth_challenges
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY login_attempts_isolation ON login_attempts
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE sod_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sod_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY sod_rules_isolation ON sod_rules
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_modules_isolation ON tenant_modules
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT (id, email, display_name, status, totp_enabled, created_at) ON users TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON memberships TO omnivate_app;
GRANT SELECT ON roles TO omnivate_app;
GRANT SELECT ON role_permissions TO omnivate_app;
GRANT SELECT, INSERT, DELETE ON user_roles TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON user_invites TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON auth_challenges TO omnivate_app;
GRANT SELECT, INSERT ON login_attempts TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON sod_rules TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON tenant_modules TO omnivate_app;
