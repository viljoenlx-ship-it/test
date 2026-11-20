import { and, eq } from 'drizzle-orm';
import { ACCESS_ROLES, seedGrantsForRole, type RoleKey } from '@omnivate/shared';
import type { Database } from './pools';
import { rolePermissions, roles, tenantModules } from './schema';

/**
 * Writes the blueprint role matrix for one tenant.
 * Safe to run again: system roles and their grants are replaced, KRN-01 stays on.
 */
export async function seedTenantRbac(db: Database, tenant: string): Promise<Map<RoleKey, string>> {
  const roleIds = new Map<RoleKey, string>();

  for (const role of ACCESS_ROLES) {
    const rows = await db
      .insert(roles)
      .values({
        tenantId: tenant,
        key: role.key,
        name: role.name,
        description: role.description,
        mfaRequired: role.mfaRequired,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: [roles.tenantId, roles.key],
        set: {
          name: role.name,
          description: role.description,
          mfaRequired: role.mfaRequired,
          isSystem: true,
        },
      })
      .returning({ id: roles.id, key: roles.key });

    const inserted = rows[0];
    if (!inserted) {
      throw new Error(`Role ${role.key} was not saved.`);
    }
    roleIds.set(inserted.key as RoleKey, inserted.id);
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenant));

  const grants = ACCESS_ROLES.flatMap((role) => {
    const roleId = roleIds.get(role.key);
    if (!roleId) {
      throw new Error(`Missing role id for ${role.key}.`);
    }
    return seedGrantsForRole(role.key).map((grant) => ({
      tenantId: tenant,
      roleId,
      scope: grant.scope,
      modules: [...grant.modules],
      action: grant.action,
      accessLabel: grant.accessLabel,
      approvalLimitCents: grant.approvalLimitCents,
    }));
  });

  if (grants.length > 0) {
    await db.insert(rolePermissions).values(grants);
  }

  await db
    .insert(tenantModules)
    .values({ tenantId: tenant, moduleId: 'KRN-01', active: true })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleId],
      set: { active: true, updatedAt: new Date() },
    });

  return roleIds;
}

export async function roleIdFor(db: Database, tenant: string, key: RoleKey): Promise<string> {
  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenant), eq(roles.key, key)));
  const row = rows[0];
  if (!row) {
    throw new Error(`Tenant ${tenant} has no ${key} role. Run seedTenantRbac first.`);
  }
  return row.id;
}
