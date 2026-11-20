import { eq } from 'drizzle-orm';
import {
  assertCanActivate,
  assertCanDeactivate,
  isModuleId,
  type ModuleId,
} from '@omnivate/shared';
import { appendAuditEvent, tenantModules, type TenantTransaction } from '@omnivate/db';

export async function activeModuleSet(tx: TenantTransaction): Promise<Set<ModuleId>> {
  const rows = await tx.db
    .select({ moduleId: tenantModules.moduleId, active: tenantModules.active })
    .from(tenantModules)
    .where(eq(tenantModules.active, true));
  const active = new Set<ModuleId>();
  for (const row of rows) {
    if (isModuleId(row.moduleId)) {
      active.add(row.moduleId);
    }
  }
  return active;
}

export async function setTenantModuleActive(
  tx: TenantTransaction,
  input: {
    actorId: string | null;
    operatorId?: string | null;
    moduleId: ModuleId;
    active: boolean;
    requestIp: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const active = await activeModuleSet(tx);
  if (input.active) {
    assertCanActivate(active, input.moduleId);
  } else {
    assertCanDeactivate(active, input.moduleId);
  }

  const before = active.has(input.moduleId);
  await tx.db
    .insert(tenantModules)
    .values({
      tenantId: tx.tenantId,
      moduleId: input.moduleId,
      active: input.active,
    })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleId],
      set: { active: input.active, updatedAt: new Date() },
    });

  await appendAuditEvent(tx, {
    action: input.active ? 'identity.module.activated' : 'identity.module.deactivated',
    entityType: 'tenant_module',
    entityId: tx.tenantId,
    actorId: input.operatorId ? null : input.actorId,
    operatorId: input.operatorId ?? null,
    actorKind: input.operatorId ? 'operator' : 'user',
    beforeData: { moduleId: input.moduleId, active: before },
    afterData: { moduleId: input.moduleId, active: input.active },
    requestIp: input.requestIp,
    userAgent: input.userAgent,
  });
}
