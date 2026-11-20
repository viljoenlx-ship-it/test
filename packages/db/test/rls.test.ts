import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closePools,
  foundationNotes,
  getAdminPool,
  getAppPool,
  schema,
  tenants,
} from '@omnivate/db';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('GOV-01 tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const noteA = randomUUID();
  const noteB = randomUUID();

  afterAll(async () => {
    await getAdminPool().query('DELETE FROM foundation_notes WHERE tenant_id = ANY($1::uuid[])', [
      [tenantA, tenantB],
    ]);
    await getAdminPool().query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [
      [tenantA, tenantB],
    ]);
    await closePools();
  });

  it('stops one tenant from reading another tenant’s rows', async () => {
    const admin = drizzle(getAdminPool(), { schema });
    await admin.insert(tenants).values([
      {
        id: tenantA,
        slug: `fixture-a-${tenantA}`,
        displayName: 'Isolation fixture A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: tenantB,
        slug: `fixture-b-${tenantB}`,
        displayName: 'Isolation fixture B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await admin.insert(foundationNotes).values([
      { id: noteA, tenantId: tenantA, body: 'visible to A' },
      { id: noteB, tenantId: tenantB, body: 'visible to B' },
    ]);

    const asA = await withTenant(tenantId(tenantA), async (tx) =>
      tx.db.select().from(foundationNotes),
    );
    expect(asA.map((row) => row.body)).toEqual(['visible to A']);

    const hiddenFromA = await withTenant(tenantId(tenantA), async (tx) => {
      return tx.db.select().from(foundationNotes).where(eq(foundationNotes.id, noteB));
    });
    expect(hiddenFromA).toEqual([]);

    const asB = await withTenant(tenantId(tenantB), async (tx) =>
      tx.db.select().from(foundationNotes),
    );
    expect(asB.map((row) => row.body)).toEqual(['visible to B']);

    const unscoped = await getAppPool().query('SELECT id FROM foundation_notes');
    expect(unscoped.rowCount).toBe(0);

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.insert(foundationNotes).values({ tenantId: tenantB, body: 'smuggled' });
      });
      expect.fail('A tenant must not be able to insert a row for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }

    const who = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ user: string }>(sql`select current_user as "user"`);
      return result.rows[0];
    });
    expect(who?.user).toBe('omnivate_app');
  });
});
