import { sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';

export async function rowsOf<T extends Record<string, unknown>>(
  tx: TenantTransaction,
  query: SQL,
): Promise<T[]> {
  const result = await tx.db.execute<T>(query);
  return result.rows as T[];
}

export async function oneOf<T extends Record<string, unknown>>(
  tx: TenantTransaction,
  query: SQL,
): Promise<T | null> {
  const found = await rowsOf<T>(tx, query);
  return found[0] ?? null;
}

export function joined(chunks: SQL[]): SQL {
  if (chunks.length === 0) {
    throw new Error('Cannot join an empty value list.');
  }
  return sql.join(chunks, sql`, `);
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return 0;
}

export function asBigint(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return BigInt(value);
  }
  return 0n;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function asStringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') {
      out[key] = item;
    }
  }
  return out;
}
