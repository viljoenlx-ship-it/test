import { drizzle } from 'drizzle-orm/node-postgres';
import type { TenantId } from '@omnivate/shared';
import { getAppPool, type Database } from './pools';
import { schema } from './schema';

export type TenantTransaction = {
  tenantId: TenantId;
  db: Database;
};

/**
 * Runs work in a transaction pinned to one tenant.
 * The setting is local to the transaction, so a connection returned to the
 * pool cannot leak the tenant into the next request.
 * With no setting, row-level security matches nothing.
 */
export async function withTenant<T>(
  tenant: TenantId,
  run: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant]);
    const result = await run({ tenantId: tenant, db: drizzle(client, { schema }) });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection can already be aborted.
    }
    throw error;
  } finally {
    client.release();
  }
}
