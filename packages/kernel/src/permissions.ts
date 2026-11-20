import { and, eq } from 'drizzle-orm';
import type { ModuleId, PermissionAction } from '@omnivate/shared';
import { memberships, rolePermissions, userRoles } from '@omnivate/db';
import type { TenantTransaction } from '@omnivate/db';
import { PermissionDeniedError } from './errors';

export type PermissionQuery = {
  scope: string;
  action: PermissionAction;
  /** Checked only for approve. The amount is integer cents. */
  amountCents?: bigint;
  moduleId?: ModuleId;
};

type Grant = {
  scope: string;
  action: string;
  modules: string[];
  approvalLimitCents: bigint | null;
};

export async function loadGrants(tx: TenantTransaction, userId: string): Promise<Grant[]> {
  const rows = await tx.db
    .select({
      scope: rolePermissions.scope,
      action: rolePermissions.action,
      modules: rolePermissions.modules,
      approvalLimitCents: rolePermissions.approvalLimitCents,
    })
    .from(userRoles)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, userRoles.userId), eq(memberships.tenantId, userRoles.tenantId)),
    )
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(memberships.status, 'active')));

  return rows.map((row) => ({
    scope: row.scope,
    action: row.action,
    modules: row.modules,
    approvalLimitCents: row.approvalLimitCents,
  }));
}

export async function loadPermissionKeys(
  tx: TenantTransaction,
  userId: string,
): Promise<Set<string>> {
  const grants = await loadGrants(tx, userId);
  return new Set(grants.map((grant) => `${grant.scope}.${grant.action}`));
}

function grantSatisfies(grant: Grant, query: PermissionQuery): boolean {
  if (grant.scope !== query.scope) {
    return false;
  }
  if (query.moduleId && !grant.modules.includes(query.moduleId)) {
    return false;
  }
  if (grant.action === query.action) {
    return true;
  }
  // Full admin covers the scope, except welfare counseling, which is an explicit grant.
  return grant.action === 'admin' && query.action !== 'counseling';
}

/**
 * Deny by default. A matching grant is required.
 * Admin on the same scope satisfies every action except counseling.
 * An approve check with amountCents fails when every matching grant is capped below it.
 * A null cap means unlimited for that grant.
 */
export async function requirePermission(
  tx: TenantTransaction,
  userId: string,
  query: PermissionQuery,
): Promise<void> {
  const grants = await loadGrants(tx, userId);
  const matched = grants.filter((grant) => grantSatisfies(grant, query));
  if (matched.length === 0) {
    throw new PermissionDeniedError();
  }

  if (query.action !== 'approve' || query.amountCents === undefined) {
    return;
  }

  const amount = query.amountCents;
  const withinLimit = matched.some((grant) => {
    if (grant.action !== 'approve' && grant.action !== 'admin') {
      return false;
    }
    if (grant.approvalLimitCents === null) {
      return true;
    }
    return amount <= grant.approvalLimitCents;
  });

  if (!withinLimit) {
    throw new PermissionDeniedError('This amount is above your approval limit.');
  }
}

export async function hasPermission(
  tx: TenantTransaction,
  userId: string,
  query: PermissionQuery,
): Promise<boolean> {
  try {
    await requirePermission(tx, userId, query);
    return true;
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return false;
    }
    throw error;
  }
}
