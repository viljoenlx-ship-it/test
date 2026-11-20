import { getAppPool } from './pools';

export { appendAuditEvent, type AuditDraft } from './audit';
export { assertConnectedAppRole } from './assert-app-role';
export {
  adminDatabaseUrl,
  assertApiDatabase,
  assertAppDatabaseUrl,
  databaseUrlForAppRole,
} from './env';
export { migrate } from './migrate';
export { pgConnectionConfig } from './pg-config';
export { waitForAdminDatabase } from './wait-for-database';
export { hashPassword, verifyPassword } from './password';
export { closePools, getAdminPool, getAppPool } from './pools';
export { roleIdFor, seedTenantRbac } from './seed-access';
export {
  schema,
  tenants,
  foundationNotes,
  auditEvents,
  foundationPostings,
  users,
  memberships,
  roles,
  rolePermissions,
  userRoles,
  userInvites,
  sessions,
  authChallenges,
  loginAttempts,
  sodRules,
  tenantModules,
} from './schema';
export { seed } from './seed';
export { withTenant, type TenantTransaction } from './tenant-scope';

export async function checkDatabase(): Promise<boolean> {
  try {
    await getAppPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
