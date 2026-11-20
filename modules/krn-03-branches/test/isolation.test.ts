import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool } from '@omnivate/db';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('KRN-03 tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await closePools();
  });

  it('hides branches, entities, and settings from the other tenant', async () => {
    const pool = getAdminPool();
    await pool.query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Branch isolation A', false, 'Africa/Johannesburg', 'ZAR'),
              ($3, $4, 'Branch isolation B', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenantA, `krn03-a-${tenantA.slice(0, 8)}`, tenantB, `krn03-b-${tenantB.slice(0, 8)}`],
    );

    const head = await pool.query<{ id: string; name: string; tenant_id: string }>(
      `SELECT id, name, tenant_id FROM krn03_branches WHERE is_head_office AND tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    expect(head.rows).toHaveLength(2);
    expect(head.rows.every((row) => row.name === 'Head Office')).toBe(true);

    const visible = await withTenant(tenantId(tenantA), async (tx) => {
      const branches = await tx.db.execute<{ id: string }>(sql`SELECT id FROM krn03_branches`);
      const entities = await tx.db.execute<{ id: string }>(
        sql`SELECT id FROM krn03_legal_entities`,
      );
      const settings = await tx.db.execute<{ tenantId: string }>(
        sql`SELECT tenant_id AS "tenantId" FROM krn03_settings`,
      );
      return {
        branches: branches.rows.length,
        entities: entities.rows.length,
        settings: settings.rows.map((row) => row.tenantId),
      };
    });
    expect(visible.branches).toBe(1);
    expect(visible.entities).toBe(1);
    expect(visible.settings).toEqual([tenantA]);

    for (const table of [
      'krn03_branches',
      'krn03_legal_entities',
      'krn03_settings',
      'krn03_branch_access',
      'krn03_current_branch',
      'krn03_entity_links',
    ]) {
      const unscoped = await getAppPool().query(`SELECT 1 FROM ${table}`);
      expect(unscoped.rowCount, table).toBe(0);
    }

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.execute(sql`
          INSERT INTO krn03_settings (tenant_id, multi_branch_enabled)
          VALUES (${tenantB}::uuid, false)
        `);
      });
      expect.fail('A tenant must not insert a setting for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security|limited to the current company/i);
    }
  });
});
