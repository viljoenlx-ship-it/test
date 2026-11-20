import { and, eq, or } from 'drizzle-orm';
import { appendAuditEvent, auditEvents, sodRules, type TenantTransaction } from '@omnivate/db';
import { sodActionLabel } from '@omnivate/shared';
import { IdentityRuleError, SodConflictError } from './errors';

export type SodActor = {
  actorId: string;
  action: string;
  entityId: string;
};

/**
 * GOV-07. Blocks the actor when they already performed the other side of an
 * enabled rule on the same entity. Modules record the action with appendAuditEvent
 * using the same action key they register here.
 */
export async function assertSegregation(tx: TenantTransaction, input: SodActor): Promise<void> {
  const rules = await tx.db
    .select({
      actionA: sodRules.actionA,
      actionB: sodRules.actionB,
    })
    .from(sodRules)
    .where(
      and(
        eq(sodRules.enabled, true),
        or(eq(sodRules.actionA, input.action), eq(sodRules.actionB, input.action)),
      ),
    );

  for (const rule of rules) {
    const other = rule.actionA === input.action ? rule.actionB : rule.actionA;
    const prior = await tx.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, input.actorId),
          eq(auditEvents.entityId, input.entityId),
          eq(auditEvents.action, other),
        ),
      )
      .limit(1);

    if (prior.length > 0) {
      throw new SodConflictError(
        `Segregation of duties: the same person cannot both ${sodActionLabel(other)} and ${sodActionLabel(input.action)} on this record.`,
      );
    }
  }
}

export function orderedSodActions(left: string, right: string): [string, string] {
  if (left === right) {
    throw new Error('A segregation rule needs two different actions.');
  }
  return left < right ? [left, right] : [right, left];
}

export async function addSodRule(
  tx: TenantTransaction,
  input: {
    actorId: string;
    actionA: string;
    actionB: string;
    description: string;
    requestIp: string | null;
    userAgent: string | null;
  },
): Promise<{ id: string }> {
  const [actionA, actionB] = orderedSodActions(input.actionA, input.actionB);
  const existing = await tx.db
    .select({ id: sodRules.id, enabled: sodRules.enabled, description: sodRules.description })
    .from(sodRules)
    .where(
      and(
        eq(sodRules.tenantId, tx.tenantId),
        eq(sodRules.actionA, actionA),
        eq(sodRules.actionB, actionB),
      ),
    );

  const current = existing[0];
  if (current?.enabled) {
    throw new IdentityRuleError('That segregation rule is already on.');
  }

  if (current) {
    await tx.db
      .update(sodRules)
      .set({ enabled: true, description: input.description })
      .where(eq(sodRules.id, current.id));
    await appendAuditEvent(tx, {
      action: 'identity.sod_rule.enabled',
      entityType: 'sod_rule',
      entityId: current.id,
      actorId: input.actorId,
      beforeData: { enabled: false, description: current.description },
      afterData: { enabled: true, actionA, actionB, description: input.description },
      requestIp: input.requestIp,
      userAgent: input.userAgent,
    });
    return { id: current.id };
  }

  const inserted = await tx.db
    .insert(sodRules)
    .values({
      tenantId: tx.tenantId,
      actionA,
      actionB,
      description: input.description,
      enabled: true,
    })
    .returning({ id: sodRules.id });
  const row = inserted[0];
  if (!row) {
    throw new Error('Segregation rule was not saved.');
  }
  await appendAuditEvent(tx, {
    action: 'identity.sod_rule.created',
    entityType: 'sod_rule',
    entityId: row.id,
    actorId: input.actorId,
    beforeData: null,
    afterData: { enabled: true, actionA, actionB, description: input.description },
    requestIp: input.requestIp,
    userAgent: input.userAgent,
  });
  return { id: row.id };
}

export async function disableSodRule(
  tx: TenantTransaction,
  input: {
    actorId: string;
    ruleId: string;
    requestIp: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const existing = await tx.db
    .select({
      id: sodRules.id,
      enabled: sodRules.enabled,
      actionA: sodRules.actionA,
      actionB: sodRules.actionB,
    })
    .from(sodRules)
    .where(eq(sodRules.id, input.ruleId));
  const current = existing[0];
  if (!current) {
    throw new IdentityRuleError('That segregation rule was not found.');
  }
  if (!current.enabled) {
    return;
  }
  await tx.db.update(sodRules).set({ enabled: false }).where(eq(sodRules.id, current.id));
  await appendAuditEvent(tx, {
    action: 'identity.sod_rule.disabled',
    entityType: 'sod_rule',
    entityId: current.id,
    actorId: input.actorId,
    beforeData: { enabled: true, actionA: current.actionA, actionB: current.actionB },
    afterData: { enabled: false, actionA: current.actionA, actionB: current.actionB },
    requestIp: input.requestIp,
    userAgent: input.userAgent,
  });
}
