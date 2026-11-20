import { getAppPool } from '@omnivate/db';

export type UserCredential = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: string;
  totpSecret: string | null;
  totpEnabled: boolean;
};

export type LoginMembership = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  membershipStatus: string;
  mfaRequired: boolean;
  tenantStatus: string;
};

export type TenantLookup = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
};

export type SessionLookup = {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  userStatus: string;
  membershipStatus: string;
  expiresAt: Date;
  revokedAt: Date | null;
  expired: boolean;
  tenantStatus: string;
};

export type ChallengeLookup = {
  id: string;
  tenantId: string;
  userId: string;
  purpose: string;
  totpSecret: string | null;
  failedAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type InviteLookup = {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  mfaRequired: boolean;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  tenantStatus: string;
};

export async function lookupTenantBySlug(slug: string): Promise<TenantLookup | null> {
  const result = await getAppPool().query<TenantLookup>(
    'SELECT id, slug, display_name AS "displayName", status FROM krn_tenant_by_slug($1)',
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function lookupUserByEmail(email: string): Promise<UserCredential | null> {
  const result = await getAppPool().query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    status: string;
    totp_secret: string | null;
    totp_enabled: boolean;
  }>('SELECT * FROM krn_user_by_email($1)', [email]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    status: row.status,
    totpSecret: row.totp_secret,
    totpEnabled: row.totp_enabled,
  };
}

export async function lookupLoginMemberships(userId: string): Promise<LoginMembership[]> {
  const result = await getAppPool().query<{
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
    membership_status: string;
    mfa_required: boolean;
    tenant_status: string;
  }>('SELECT * FROM krn_login_memberships($1)', [userId]);
  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name,
    membershipStatus: row.membership_status,
    mfaRequired: row.mfa_required,
    tenantStatus: row.tenant_status,
  }));
}

export async function insertUser(
  email: string,
  displayName: string,
  passwordHash: string,
): Promise<string> {
  const result = await getAppPool().query<{ krn_insert_user: string }>(
    'SELECT krn_insert_user($1, $2, $3)',
    [email, displayName, passwordHash],
  );
  const id = result.rows[0]?.krn_insert_user;
  if (!id) {
    throw new Error('User insert did not return an id.');
  }
  return id;
}

export async function setUserPassword(userId: string, passwordHash: string): Promise<void> {
  await getAppPool().query('SELECT krn_set_password($1, $2)', [userId, passwordHash]);
}

export async function lookupTotpSecret(userId: string): Promise<string | null> {
  const result = await getAppPool().query<{ krn_totp_secret: string | null }>(
    'SELECT krn_totp_secret($1)',
    [userId],
  );
  return result.rows[0]?.krn_totp_secret ?? null;
}

export async function setUserTotp(
  userId: string,
  secret: string | null,
  enabled: boolean,
): Promise<void> {
  await getAppPool().query('SELECT krn_set_totp($1, $2, $3)', [userId, secret, enabled]);
}

export async function lookupSession(tokenHash: string): Promise<SessionLookup | null> {
  const result = await getAppPool().query<{
    id: string;
    user_id: string;
    tenant_id: string;
    email: string;
    display_name: string;
    user_status: string;
    membership_status: string;
    expires_at: Date;
    revoked_at: Date | null;
    expired: boolean;
    tenant_status: string;
  }>('SELECT * FROM krn_session_by_token_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    userStatus: row.user_status,
    membershipStatus: row.membership_status,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    expired: row.expired,
    tenantStatus: row.tenant_status,
  };
}

export async function lookupChallenge(tokenHash: string): Promise<ChallengeLookup | null> {
  const result = await getAppPool().query<{
    id: string;
    tenant_id: string;
    user_id: string;
    purpose: string;
    totp_secret: string | null;
    failed_attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
  }>('SELECT * FROM krn_challenge_by_token_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    purpose: row.purpose,
    totpSecret: row.totp_secret,
    failedAttempts: row.failed_attempts,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export async function lookupInvite(tokenHash: string): Promise<InviteLookup | null> {
  const result = await getAppPool().query<{
    id: string;
    tenant_id: string;
    tenant_name: string;
    email: string;
    role_id: string;
    role_key: string;
    role_name: string;
    mfa_required: boolean;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    tenant_status: string;
  }>('SELECT * FROM krn_invite_by_token_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    roleId: row.role_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    mfaRequired: row.mfa_required,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    tenantStatus: row.tenant_status,
  };
}
