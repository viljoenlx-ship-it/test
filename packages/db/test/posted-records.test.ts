import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, foundationPostings, getAdminPool, getAppPool } from '@omnivate/db';

describe('GOV-03 posted records', () => {
  const tenant = randomUUID();

  afterAll(async () => {
    await getAdminPool().query(
      'DELETE FROM foundation_postings WHERE tenant_id = $1 AND status = $2',
      [tenant, 'draft'],
    );
    await getAdminPool().query('DELETE FROM tenants WHERE id = $1', [tenant]);
    await closePools();
  });

  it('deletes a draft and refuses to delete a posted row', async () => {
    await getAdminPool().query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Posting fixture', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenant, `posting-${tenant}`],
    );

    const draftId = randomUUID();
    await withTenant(tenantId(tenant), async (tx) => {
      await tx.db.insert(foundationPostings).values({
        id: draftId,
        tenantId: tenant,
        status: 'draft',
        description: 'Fictional draft',
        amountCents: 1500n,
        currencyCode: 'ZAR',
        postedAt: null,
      });
      await tx.db.delete(foundationPostings).where(eq(foundationPostings.id, draftId));
      const remaining = await tx.db
        .select()
        .from(foundationPostings)
        .where(eq(foundationPostings.id, draftId));
      expect(remaining).toEqual([]);
    });

    const client = await getAppPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant]);
      const postedId = randomUUID();
      await client.query(
        `INSERT INTO foundation_postings
           (id, tenant_id, status, description, amount_cents, currency_code, posted_at)
         VALUES ($1, $2, 'posted', 'Fictional posted marker', 2500, 'ZAR', now())`,
        [postedId, tenant],
      );

      await client.query('SAVEPOINT deletion');
      await expect(
        client.query('DELETE FROM foundation_postings WHERE id = $1', [postedId]),
      ).rejects.toThrow(/GOV-03/);
      await client.query('ROLLBACK TO SAVEPOINT deletion');

      const stillThere = await client.query(
        'SELECT status FROM foundation_postings WHERE id = $1',
        [postedId],
      );
      expect(stillThere.rows[0]?.status).toBe('posted');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
