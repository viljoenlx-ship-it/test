import { type SQL } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';

export function rowsOf<T>(result: { rows: unknown }): T[] {
  return (result as { rows: T[] }).rows;
}

export async function one<T>(tx: TenantTransaction, statement: SQL): Promise<T | null> {
  const result = await tx.db.execute(statement);
  return rowsOf<T>(result)[0] ?? null;
}

export async function many<T>(tx: TenantTransaction, statement: SQL): Promise<T[]> {
  const result = await tx.db.execute(statement);
  return rowsOf<T>(result);
}

export async function audit(
  tx: TenantTransaction,
  actor: { userId: string; requestIp: string | null; userAgent: string | null },
  action: string,
  entityType: string,
  entityId: string,
  afterData: Record<string, unknown>,
): Promise<void> {
  await appendAuditEvent(tx, {
    action,
    entityType,
    entityId,
    actorId: actor.userId,
    beforeData: null,
    afterData,
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}
