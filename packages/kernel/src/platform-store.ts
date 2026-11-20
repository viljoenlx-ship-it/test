import { getAppPool } from '@omnivate/db';

export type OperatorCredential = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: string;
  totpSecret: string | null;
  totpEnabled: boolean;
  roleKeys: string[];
};

export type OperatorSession = {
  id: string;
  operatorId: string;
  email: string;
  displayName: string;
  status: string;
  roleKeys: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  expired: boolean;
};

export type OperatorChallenge = {
  id: string;
  operatorId: string;
  purpose: string;
  totpSecret: string | null;
  failedAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  email: string;
};

export type TenantListRow = {
  id: string;
  slug: string;
  companyName: string;
  displayName: string;
  status: string;
  industryPreset: string | null;
  packageKey: string;
  contactEmail: string | null;
  createdAt: Date;
};

export type AuditListRow = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  occurredAt: Date;
  actorKind: string;
  actorId: string | null;
  operatorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: unknown;
  afterData: unknown;
};

export type PublicBranding = {
  slug: string;
  displayName: string;
  brandPrimary: string;
  brandAccent: string;
  hasLogo: boolean;
};

export type DashboardCounts = {
  tenantsActive: number;
  tenantsSuspended: number;
  tenantsArchived: number;
  users: number;
};

export async function lookupOperatorByEmail(email: string): Promise<OperatorCredential | null> {
  const result = await getAppPool().query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    status: string;
    totp_secret: string | null;
    totp_enabled: boolean;
    role_keys: string[] | null;
  }>('SELECT * FROM platform_operator_by_email($1)', [email]);
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
    roleKeys: row.role_keys ?? [],
  };
}

export async function operatorFailureCount(email: string): Promise<number> {
  const result = await getAppPool().query<{ platform_failure_count: number }>(
    'SELECT platform_failure_count($1)',
    [email],
  );
  return result.rows[0]?.platform_failure_count ?? 0;
}

export async function recordOperatorAttempt(input: {
  email: string;
  operatorId: string | null;
  succeeded: boolean;
  requestIp: string | null;
}): Promise<void> {
  await getAppPool().query('SELECT platform_record_attempt($1, $2, $3, $4)', [
    input.email,
    input.operatorId,
    input.succeeded,
    input.requestIp,
  ]);
}

export async function openOperatorChallenge(input: {
  operatorId: string;
  purpose: 'mfa_enroll' | 'mfa_verify';
  tokenHash: string;
  totpSecret: string | null;
  expiresAt: Date;
}): Promise<void> {
  await getAppPool().query('SELECT platform_open_challenge($1, $2, $3, $4, $5)', [
    input.operatorId,
    input.purpose,
    input.tokenHash,
    input.totpSecret,
    input.expiresAt,
  ]);
}

export async function lookupOperatorChallenge(
  tokenHash: string,
): Promise<OperatorChallenge | null> {
  const result = await getAppPool().query<{
    id: string;
    operator_id: string;
    purpose: string;
    totp_secret: string | null;
    failed_attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
    email: string;
  }>('SELECT * FROM platform_challenge_by_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    operatorId: row.operator_id,
    purpose: row.purpose,
    totpSecret: row.totp_secret,
    failedAttempts: row.failed_attempts,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    email: row.email,
  };
}

export async function touchOperatorChallenge(
  id: string,
  failedAttempts: number,
  consumedAt: Date | null,
): Promise<void> {
  await getAppPool().query('SELECT platform_touch_challenge($1, $2, $3)', [
    id,
    failedAttempts,
    consumedAt,
  ]);
}

export async function setOperatorTotp(
  operatorId: string,
  secret: string | null,
  enabled: boolean,
): Promise<void> {
  await getAppPool().query('SELECT platform_set_totp($1, $2, $3)', [operatorId, secret, enabled]);
}

export async function lookupOperatorTotp(operatorId: string): Promise<string | null> {
  const result = await getAppPool().query<{ platform_totp_secret: string | null }>(
    'SELECT platform_totp_secret($1)',
    [operatorId],
  );
  return result.rows[0]?.platform_totp_secret ?? null;
}

export async function openOperatorSession(input: {
  operatorId: string;
  tokenHash: string;
  expiresAt: Date;
  requestIp: string | null;
  userAgent: string | null;
}): Promise<void> {
  await getAppPool().query('SELECT platform_open_session($1, $2, $3, $4, $5)', [
    input.operatorId,
    input.tokenHash,
    input.expiresAt,
    input.requestIp,
    input.userAgent,
  ]);
}

export async function lookupOperatorSession(tokenHash: string): Promise<OperatorSession | null> {
  const result = await getAppPool().query<{
    id: string;
    operator_id: string;
    email: string;
    display_name: string;
    status: string;
    role_keys: string[] | null;
    expires_at: Date;
    revoked_at: Date | null;
    expired: boolean;
  }>('SELECT * FROM platform_session_by_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    operatorId: row.operator_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    roleKeys: row.role_keys ?? [],
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    expired: row.expired,
  };
}

export async function revokeOperatorSession(id: string): Promise<void> {
  await getAppPool().query('SELECT platform_revoke_session($1)', [id]);
}

export async function insertOperatorAudit(input: {
  tenantId: string | null;
  operatorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  requestIp: string | null;
  userAgent: string | null;
}): Promise<void> {
  await getAppPool().query(
    'SELECT platform_insert_audit($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)',
    [
      input.tenantId,
      input.operatorId,
      input.action,
      input.entityType,
      input.entityId,
      input.beforeData ? JSON.stringify(input.beforeData) : null,
      input.afterData ? JSON.stringify(input.afterData) : null,
      input.requestIp,
      input.userAgent,
    ],
  );
}

export async function searchTenants(input: {
  query: string;
  status: string;
  limit: number;
}): Promise<TenantListRow[]> {
  const result = await getAppPool().query<{
    id: string;
    slug: string;
    company_name: string;
    display_name: string;
    status: string;
    industry_preset: string | null;
    package_key: string;
    contact_email: string | null;
    created_at: Date;
  }>('SELECT * FROM platform_search_tenants($1, $2, $3)', [input.query, input.status, input.limit]);
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    companyName: row.company_name,
    displayName: row.display_name,
    status: row.status,
    industryPreset: row.industry_preset,
    packageKey: row.package_key,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  }));
}

export async function searchPlatformAudit(input: {
  tenantId: string | null;
  actor: string;
  action: string;
  from: Date | null;
  to: Date | null;
  limit: number;
}): Promise<AuditListRow[]> {
  const result = await getAppPool().query<{
    id: string;
    tenant_id: string | null;
    tenant_name: string | null;
    occurred_at: Date;
    actor_kind: string;
    actor_id: string | null;
    operator_id: string | null;
    actor_label: string;
    action: string;
    entity_type: string;
    entity_id: string;
    before_data: unknown;
    after_data: unknown;
  }>('SELECT * FROM platform_search_audit($1, $2, $3, $4, $5, $6)', [
    input.tenantId,
    input.actor,
    input.action,
    input.from,
    input.to,
    input.limit,
  ]);
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    occurredAt: row.occurred_at,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    operatorId: row.operator_id,
    actorLabel: row.actor_label,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeData: row.before_data,
    afterData: row.after_data,
  }));
}

export async function platformDashboard(): Promise<DashboardCounts> {
  const result = await getAppPool().query<{ platform_dashboard: DashboardCounts }>(
    'SELECT platform_dashboard()',
  );
  const counts = result.rows[0]?.platform_dashboard;
  if (!counts) {
    throw new Error('Dashboard counts were not returned.');
  }
  return {
    tenantsActive: Number(counts.tenantsActive),
    tenantsSuspended: Number(counts.tenantsSuspended),
    tenantsArchived: Number(counts.tenantsArchived),
    users: Number(counts.users),
  };
}

export async function lookupPublicBranding(slug: string): Promise<PublicBranding | null> {
  const result = await getAppPool().query<{
    slug: string;
    display_name: string;
    brand_primary: string;
    brand_accent: string;
    has_logo: boolean;
  }>('SELECT * FROM tenant_public_branding($1)', [slug]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    slug: row.slug,
    displayName: row.display_name,
    brandPrimary: row.brand_primary,
    brandAccent: row.brand_accent,
    hasLogo: row.has_logo,
  };
}

export async function lookupTenantLogoKey(
  slug: string,
): Promise<{ tenantId: string; logoStorageKey: string } | null> {
  const result = await getAppPool().query<{ tenant_id: string; logo_storage_key: string }>(
    'SELECT * FROM tenant_logo_key($1)',
    [slug],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { tenantId: row.tenant_id, logoStorageKey: row.logo_storage_key };
}

export type PreviewTicket = {
  id: string;
  operatorId: string;
  tenantId: string;
};

export async function openPreviewTicket(
  operatorId: string,
  tenantId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await getAppPool().query('SELECT platform_open_preview($1, $2, $3, $4)', [
    operatorId,
    tenantId,
    tokenHash,
    expiresAt,
  ]);
}

export async function exchangePreviewTicket(
  ticketHash: string,
  sessionHash: string,
  expiresAt: Date,
): Promise<PreviewTicket | null> {
  const result = await getAppPool().query<{
    id: string;
    operator_id: string;
    tenant_id: string;
  }>('SELECT * FROM platform_exchange_preview($1, $2, $3)', [ticketHash, sessionHash, expiresAt]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { id: row.id, operatorId: row.operator_id, tenantId: row.tenant_id };
}

export async function lookupPreviewSession(tokenHash: string): Promise<PreviewTicket | null> {
  const result = await getAppPool().query<{
    id: string;
    operator_id: string;
    tenant_id: string;
  }>('SELECT id, operator_id, tenant_id FROM platform_preview_by_hash($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { id: row.id, operatorId: row.operator_id, tenantId: row.tenant_id };
}

export async function closePreviewSession(tokenHash: string): Promise<PreviewTicket | null> {
  const result = await getAppPool().query<{
    id: string;
    operator_id: string;
    tenant_id: string;
  }>('SELECT * FROM platform_close_preview($1)', [tokenHash]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { id: row.id, operatorId: row.operator_id, tenantId: row.tenant_id };
}
