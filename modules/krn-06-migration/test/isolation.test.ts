import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { closePools, getAppPool } from '@omnivate/db';
import { enableModule, makeCompany, makeUser, multipart } from './support';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('KRN-06 tenant isolation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('hides one company’s import from the other, including by id', async () => {
    const alpha = await makeCompany('alpha');
    const beta = await makeCompany('beta');
    const ownerA = await makeUser(alpha.id, 'tenant_owner', 'alpha-owner');
    const ownerB = await makeUser(beta.id, 'tenant_owner', 'beta-owner');
    await enableModule(alpha.id, ownerA.id, 'KRN-02');

    const uploaded = await app.inject({
      method: 'POST',
      url: '/krn/imports',
      headers: {
        ...multipart(
          { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
          {
            filename: 'fictional-contacts.csv',
            type: 'text/csv',
            data: 'Name,Email\nNaledi Paper,orders@naledi-paper.example\n',
          },
        ).headers,
        cookie: ownerA.cookie,
        'x-tenant-id': beta.id,
      },
      payload: multipart(
        { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
        {
          filename: 'fictional-contacts.csv',
          type: 'text/csv',
          data: 'Name,Email\nNaledi Paper,orders@naledi-paper.example\n',
        },
      ).payload,
    });
    expect(uploaded.statusCode).toBe(200);
    const batchId = uploaded.json().batch.id as string;

    const hidden = await app.inject({
      method: 'GET',
      url: `/krn/imports/${batchId}`,
      headers: { cookie: ownerB.cookie },
    });
    expect(hidden.statusCode).toBe(404);

    const asB = await withTenant(tenantId(beta.id), async (tx) => {
      return tx.db.execute(sql`SELECT id FROM parties WHERE display_name = 'Naledi Paper'`);
    });
    expect(asB.rows).toEqual([]);

    const asA = await withTenant(tenantId(alpha.id), async (tx) => {
      return tx.db.execute<{ email: string }>(
        sql`SELECT value AS email FROM party_channels WHERE kind = 'email'`,
      );
    });
    expect(asA.rows.map((row) => row.email)).toEqual([]);

    await app.inject({
      method: 'POST',
      url: `/krn/imports/${batchId}/advance`,
      headers: { cookie: ownerA.cookie, 'x-tenant-id': beta.id },
    });

    const visibleToA = await withTenant(tenantId(alpha.id), async (tx) => {
      return tx.db.execute<{ email: string }>(
        sql`SELECT value AS email FROM party_channels WHERE kind = 'email'`,
      );
    });
    expect(visibleToA.rows.map((row) => row.email)).toEqual(['orders@naledi-paper.example']);

    const stillHidden = await withTenant(tenantId(beta.id), async (tx) => {
      return tx.db.execute(sql`SELECT id FROM parties WHERE display_name = 'Naledi Paper'`);
    });
    expect(stillHidden.rows).toEqual([]);

    const unscoped = await getAppPool().query('SELECT id FROM parties');
    expect(unscoped.rowCount).toBe(0);
    const unscopedBatches = await getAppPool().query('SELECT id FROM krn06_import_batches');
    expect(unscopedBatches.rowCount).toBe(0);

    try {
      await withTenant(tenantId(alpha.id), async (tx) => {
        await tx.db.execute(sql`
          INSERT INTO parties (tenant_id, kind, display_name, popia_consent, status)
          VALUES (${beta.id}::uuid, 'organisation', 'Smuggled', false, 'active')
        `);
      });
      expect.fail('A tenant must not be able to insert a row for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }

    const otherId = randomUUID();
    const byPrimaryKey = await withTenant(tenantId(beta.id), async (tx) => {
      return tx.db.execute(sql`SELECT id FROM krn06_import_batches WHERE id = ${batchId}::uuid`);
    });
    expect(byPrimaryKey.rows).toEqual([]);
    expect(otherId).not.toBe(batchId);
  });
});
