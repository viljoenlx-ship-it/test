-- GOV-05, decided 2026-11-19.
-- Mandatory authenticator roles must match MFA_REQUIRED_ROLE_KEYS
-- in packages/shared/src/rbac.ts: owner, manager, accountant, and HR.
-- Cashier, warehouse, and portal stay optional.

CREATE OR REPLACE FUNCTION krn_keep_mandatory_mfa() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('tenant_owner', 'branch_manager', 'accountant', 'hr_compliance')
     AND NEW.mfa_required IS NOT TRUE THEN
    RAISE EXCEPTION 'MFA is mandatory for the owner, manager, accountant, and HR roles'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION krn_keep_mandatory_mfa() IS
  'GOV-05. Keys must match MFA_REQUIRED_ROLE_KEYS in packages/shared/src/rbac.ts.';

ALTER TABLE tenants ALTER COLUMN brand_primary SET DEFAULT '#4020a0';
ALTER TABLE tenants ALTER COLUMN brand_accent SET DEFAULT '#08b8b8';
