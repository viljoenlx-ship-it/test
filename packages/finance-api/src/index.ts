import { activeModuleSet, hasPermission, tenantId, withTenant, type ModuleId, type TenantTransaction } from '@omnivate/kernel';
import { HttpError, asBigint, audit, many, one, readBody, readText, requireActor, route } from '@omnivate/module-fin-01';
import type { LedgerActor } from '@omnivate/module-fin-01';

export { HttpError, asBigint, audit, many, one, readBody, readText, requireActor, route };
export type FinanceActor = LedgerActor & { tenantId: string; userId: string };
export async function inModule<T>(actor: FinanceActor, moduleId: ModuleId, scope: string, action: 'read'|'operate'|'post'|'approve'|'submit', work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  return withTenant(tenantId(actor.tenantId), async tx => {
    if (!(await activeModuleSet(tx)).has(moduleId)) throw new HttpError(403, 'module_off', 'This finance module is not enabled for this company.');
    if (!await hasPermission(tx, actor.userId, { scope, action, moduleId })) throw new HttpError(403, 'forbidden', `Your role cannot ${action} this finance module.`);
    return work(tx);
  });
}
export function positiveCents(value: unknown, label: string): bigint {
  const raw = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new HttpError(400, 'bad_request', `${label} must be a positive amount in cents.`);
  return BigInt(raw);
}
export function integerBigint(value: unknown, label: string, allowNegative = false): bigint {
  const raw = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(raw)) throw new HttpError(400, 'bad_request', `${label} must be a whole amount in cents.`);
  return BigInt(raw);
}
export function isoDate(value: unknown, label: string): string {
  const raw = readText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(400, 'bad_request', `${label} must be an ISO date (YYYY-MM-DD).`);
  const parts = raw.split('-');
  const year = Number(parts[0] ?? NaN), month = Number(parts[1] ?? NaN), day = Number(parts[2] ?? NaN);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new HttpError(400, 'bad_request', `${label} must be a real calendar date.`);
  return raw;
}
