import { type SQL } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';

export type LedgerActor = {
  userId: string | null;
  requestIp: string | null;
  userAgent: string | null;
};

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

export function asBigint(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return BigInt(value);
  }
  return 0n;
}

export function uniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if ('code' in current && current.code === '23505') {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

export async function audit(
  tx: TenantTransaction,
  actor: LedgerActor,
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

const SCALE = 10_000n;

/** Quantity in micros times a unit cost, half a cent away from zero. */
export function extendAverageCost(quantityMicros: bigint, unitCostCents: bigint): bigint {
  if (quantityMicros <= 0n || unitCostCents <= 0n) {
    return 0n;
  }
  return (quantityMicros * unitCostCents + SCALE / 2n) / SCALE;
}
