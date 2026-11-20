import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { demoTenants, southAfricaPreset } from '@omnivate/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, foundationPostings, getAdminPool, schema, seed, tenants } from '@omnivate/db';

describe('fictional demo seed', () => {
  afterAll(async () => {
    await closePools();
  });

  it('loads the two fictional demo tenants', async () => {
    await seed();
    const admin = drizzle(getAdminPool(), { schema });
    const rows = (await admin.select().from(tenants).orderBy(tenants.slug)).filter(
      (row) => row.isDemo,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.displayName)).toEqual([
      demoTenants[0].displayName,
      demoTenants[1].displayName,
    ]);
    expect(rows.map((row) => row.id)).toEqual([demoTenants[0].id, demoTenants[1].id]);
    expect(rows.every((row) => row.isDemo)).toBe(true);

    for (const row of rows) {
      expect(row.timezone).toBe(southAfricaPreset.timeZone);
      expect(row.currencyCode).toBe(southAfricaPreset.currency);
    }

    const postings = await admin
      .select()
      .from(foundationPostings)
      .where(eq(foundationPostings.tenantId, demoTenants[0].id));
    expect(postings[0]?.amountCents).toBe(125_000n);
    expect(postings[0]?.status).toBe('posted');

    const branches = await getAdminPool().query<{
      slug: string;
      name: string;
      code: string;
      city: string;
      head: boolean;
    }>(
      `SELECT t.slug, b.name, b.code, b.city, b.is_head_office AS head
       FROM krn03_branches AS b
       JOIN tenants AS t ON t.id = b.tenant_id
       WHERE t.is_demo AND b.archived_at IS NULL
       ORDER BY t.slug, b.is_head_office DESC, b.name`,
    );
    expect(branches.rows).toEqual([
      {
        slug: 'aubergine-atlas',
        name: 'Head Office',
        code: 'HO',
        city: 'Cape Town',
        head: true,
      },
      {
        slug: 'blue-crayon-foundry',
        name: 'Cape Town HQ',
        code: 'CPT',
        city: 'Cape Town',
        head: true,
      },
      {
        slug: 'blue-crayon-foundry',
        name: 'Durban',
        code: 'DBN',
        city: 'Durban',
        head: false,
      },
    ]);
  });
});
