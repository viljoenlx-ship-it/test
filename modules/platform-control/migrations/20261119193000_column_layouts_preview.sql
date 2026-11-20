-- Per-client column layouts, and short-lived read-only preview tickets.
-- omnivate_app cannot select operator_previews. It calls the functions below.

ALTER TABLE tenants
  ADD COLUMN column_layouts jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.column_layouts IS
  'Which columns the company sees on the main lists, and in which order. Empty means the full default list.';

GRANT UPDATE (column_layouts) ON tenants TO omnivate_app;

CREATE TABLE operator_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  operator_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE operator_previews IS
  'A short-lived ticket that lets a platform operator open one company read-only. Not a user session.';

ALTER TABLE operator_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_previews FORCE ROW LEVEL SECURITY;

CREATE FUNCTION platform_open_preview(
  p_operator uuid,
  p_tenant uuid,
  p_hash text,
  p_expires timestamptz
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO operator_previews (operator_id, tenant_id, token_hash, expires_at)
  VALUES (p_operator, p_tenant, p_hash, p_expires)
  RETURNING id;
$$;

CREATE FUNCTION platform_exchange_preview(
  p_ticket_hash text,
  p_session_hash text,
  p_expires timestamptz
)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  tenant_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE operator_previews
  SET token_hash = p_session_hash,
      expires_at = p_expires
  WHERE token_hash = p_ticket_hash
    AND expires_at > now()
  RETURNING id, operator_id, tenant_id;
$$;

CREATE FUNCTION platform_preview_by_hash(p_hash text)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  tenant_id uuid,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, operator_id, tenant_id, expires_at
  FROM operator_previews
  WHERE token_hash = p_hash
    AND expires_at > now();
$$;

CREATE FUNCTION platform_close_preview(p_hash text)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  tenant_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM operator_previews
  WHERE token_hash = p_hash
  RETURNING id, operator_id, tenant_id;
$$;

REVOKE ALL ON FUNCTION platform_open_preview(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_exchange_preview(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_preview_by_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_close_preview(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_open_preview(uuid, uuid, text, timestamptz) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_exchange_preview(text, text, timestamptz) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_preview_by_hash(text) TO omnivate_app;
GRANT EXECUTE ON FUNCTION platform_close_preview(text) TO omnivate_app;
