import { auditEvents } from './schema';
import type { TenantTransaction } from './tenant-scope';

export type AuditDraft = {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operatorId?: string | null;
  actorKind?: 'user' | 'operator' | 'system';
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  requestIp: string | null;
  userAgent: string | null;
};

/** Insert one audit row. There is no update or delete helper on purpose. */
export async function appendAuditEvent(tx: TenantTransaction, event: AuditDraft): Promise<string> {
  const operatorId = event.operatorId ?? null;
  const actorKind = event.actorKind ?? (operatorId ? 'operator' : 'user');
  const rows = await tx.db
    .insert(auditEvents)
    .values({
      tenantId: tx.tenantId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actorId: actorKind === 'operator' ? null : event.actorId,
      actorKind,
      operatorId,
      beforeData: event.beforeData,
      afterData: event.afterData,
      requestIp: event.requestIp,
      userAgent: event.userAgent,
    })
    .returning({ id: auditEvents.id });

  const inserted = rows[0];
  if (!inserted) {
    throw new Error('Audit insert did not return an id.');
  }
  return inserted.id;
}
