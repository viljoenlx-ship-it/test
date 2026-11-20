import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { activationClosure, getModule, tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool, schema } from '@omnivate/db';
import { countParties } from '../src/index';
import { parties } from '../src/schema';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('KRN-02 tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const partyA = randomUUID();
  const partyB = randomUUID();
  const admin = () => drizzle(getAdminPool(), { schema });

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('DELETE FROM parties WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await closePools();
  });

  it('matches the catalog: KRN-02 needs KRN-01 and nothing else', () => {
    expect(getModule('KRN-02').prerequisites).toEqual(['KRN-01']);
    expect(activationClosure('KRN-02')).toEqual(['KRN-01', 'KRN-02']);
    expect(getModule('KRN-02').name).toBe('Unified Party Directory');
  });

  it('hides parties from the other tenant, from an unscoped query, and from DELETE', async () => {
    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: `party-a-${tenantA.slice(0, 8)}`,
        displayName: 'Party isolation A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: tenantB,
        slug: `party-b-${tenantB.slice(0, 8)}`,
        displayName: 'Party isolation B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await db.insert(parties).values([
      {
        id: partyA,
        tenantId: tenantA,
        kind: 'organisation',
        displayName: 'Visible to A',
        popiaConsent: false,
        status: 'active',
      },
      {
        id: partyB,
        tenantId: tenantB,
        kind: 'organisation',
        displayName: 'Visible to B',
        popiaConsent: false,
        status: 'active',
      },
    ]);

    const asA = await withTenant(tenantId(tenantA), async (tx) => tx.db.select().from(parties));
    expect(asA.map((row) => row.displayName)).toEqual(['Visible to A']);

    const hidden = await withTenant(tenantId(tenantA), async (tx) =>
      tx.db.select().from(parties).where(eq(parties.id, partyB)),
    );
    expect(hidden).toEqual([]);

    const unscoped = await getAppPool().query('SELECT id FROM parties');
    expect(unscoped.rowCount).toBe(0);

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.insert(parties).values({
          tenantId: tenantB,
          kind: 'organisation',
          displayName: 'Smuggled',
          popiaConsent: false,
          status: 'active',
        });
      });
      expect.fail('A tenant must not insert a party for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.delete(parties).where(eq(parties.id, partyA));
      });
      expect.fail('The app role must not delete a party.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('The app role must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/permission denied/i);
    }

    const stillThere = await withTenant(tenantId(tenantA), async (tx) => {
      const counts = await countParties(tx);
      return counts.active;
    });
    expect(stillThere).toBe(1);
  });
});
