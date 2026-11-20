import { and, eq } from 'drizzle-orm';
import {
  activeModuleSet,
  hasPermission,
  memberships,
  roles,
  tenants,
  userRoles,
  users,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  getCommercialPackage,
  isPackageKey,
  parseColumnLayouts,
  type ColumnLayouts,
} from '@omnivate/shared';
import { signInAgain } from './http';

export type SessionBody = {
  step: 'session';
  user: { id: string; email: string; displayName: string; totpEnabled: boolean };
  tenant: {
    id: string;
    slug: string;
    displayName: string;
    brandPrimary: string;
    brandAccent: string;
    hasLogo: boolean;
    city: string | null;
    vatNumber: string | null;
    packageName: string;
  };
  modules: string[];
  columnLayouts: ColumnLayouts;
  roles: { key: string; name: string; mfaRequired: boolean }[];
  canViewUsers: boolean;
  canManageUsers: boolean;
};

export async function describeSession(tx: TenantTransaction, userId: string): Promise<SessionBody> {
  const userRows = await tx.db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, userId));
  const user = userRows[0];
  if (!user) {
    throw signInAgain();
  }

  const membershipRows = await tx.db
    .select({ status: memberships.status })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  if (membershipRows[0]?.status !== 'active') {
    throw signInAgain();
  }

  const roleRows = await tx.db
    .select({ key: roles.key, name: roles.name, mfaRequired: roles.mfaRequired })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tx.tenantId)));

  const tenantRows = await tx.db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      displayName: tenants.displayName,
      brandPrimary: tenants.brandPrimary,
      brandAccent: tenants.brandAccent,
      logoStorageKey: tenants.logoStorageKey,
      city: tenants.addressCity,
      vatNumber: tenants.vatNumber,
      packageKey: tenants.packageKey,
      columnLayouts: tenants.columnLayouts,
      status: tenants.status,
    })
    .from(tenants);
  const tenant = tenantRows[0];
  if (!tenant || tenant.status !== 'active') {
    throw signInAgain();
  }

  return {
    step: 'session',
    user,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      brandPrimary: tenant.brandPrimary,
      brandAccent: tenant.brandAccent,
      hasLogo: tenant.logoStorageKey !== null,
      city: tenant.city,
      vatNumber: tenant.vatNumber,
      packageName: isPackageKey(tenant.packageKey)
        ? getCommercialPackage(tenant.packageKey).name
        : 'Core Platform (Included)',
    },
    modules: [...(await activeModuleSet(tx))],
    columnLayouts: parseColumnLayouts(tenant.columnLayouts),
    roles: roleRows,
    canViewUsers: await hasPermission(tx, userId, {
      scope: 'krn',
      action: 'read',
      moduleId: 'KRN-01',
    }),
    canManageUsers: await hasPermission(tx, userId, {
      scope: 'krn',
      action: 'admin',
      moduleId: 'KRN-01',
    }),
  };
}
