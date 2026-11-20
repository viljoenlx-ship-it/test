/**
 * Server-side kernel. Business modules import this package rather than
 * @omnivate/db so tenant scope, audit writes, and the module catalog stay
 * behind one door. The browser must not import this package.
 */
export {
  appendAuditEvent,
  assertApiDatabase,
  authChallenges,
  checkDatabase,
  closePools,
  hashPassword,
  loginAttempts,
  memberships,
  rolePermissions,
  roles,
  sessions,
  sodRules,
  tenants,
  tenantModules,
  userInvites,
  userRoles,
  users,
  verifyPassword,
  seedTenantRbac,
  withTenant,
  type AuditDraft,
  type TenantTransaction,
} from '@omnivate/db';

export {
  BranchAccessError,
  IdentityRuleError,
  PermissionDeniedError,
  SodConflictError,
} from './errors';
export {
  loadBranchContext,
  rememberCurrentBranch,
  requireBranchAccess,
  type BranchContext,
  type BranchScope,
} from './branches';
export {
  insertUser,
  lookupChallenge,
  lookupInvite,
  lookupLoginMemberships,
  lookupSession,
  lookupTenantBySlug,
  lookupTotpSecret,
  lookupUserByEmail,
  setUserPassword,
  setUserTotp,
  type ChallengeLookup,
  type InviteLookup,
  type LoginMembership,
  type SessionLookup,
  type TenantLookup,
  type UserCredential,
} from './identity-store';
export { FIELD_MASK, maskFields } from './mask';
export { MFA_OFF_WARNING, mfaEnforcement, type MfaEnforcement } from './mfa-enforcement';
export {
  hasPermission,
  loadGrants,
  loadPermissionKeys,
  requirePermission,
  type PermissionQuery,
} from './permissions';
export { addSodRule, assertSegregation, disableSodRule, orderedSodActions } from './sod';
export { activeModuleSet, setTenantModuleActive } from './tenant-modules';
export {
  closePreviewSession,
  exchangePreviewTicket,
  insertOperatorAudit,
  lookupOperatorByEmail,
  lookupPreviewSession,
  openPreviewTicket,
  lookupOperatorChallenge,
  lookupOperatorSession,
  lookupOperatorTotp,
  lookupPublicBranding,
  lookupTenantLogoKey,
  openOperatorChallenge,
  openOperatorSession,
  operatorFailureCount,
  platformDashboard,
  recordOperatorAttempt,
  revokeOperatorSession,
  searchPlatformAudit,
  searchTenants,
  setOperatorTotp,
  touchOperatorChallenge,
  type AuditListRow,
  type DashboardCounts,
  type OperatorChallenge,
  type OperatorCredential,
  type OperatorSession,
  type PreviewTicket,
  type PublicBranding,
  type TenantListRow,
} from './platform-store';

export {
  activationClosure,
  activationOrder,
  assertCanActivate,
  assertCanDeactivate,
  demoTenants,
  getModule,
  isModuleId,
  MODULES,
  southAfricaPreset,
  tenantId,
  type ModuleId,
  type TenantId,
} from '@omnivate/shared';
