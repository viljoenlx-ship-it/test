import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool, schema } from '@omnivate/db';
import { documents } from '../src/schema';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('document capture tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const admin = () => drizzle(getAdminPool(), { schema });

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('DELETE FROM doc_documents WHERE tenant_id = ANY($1::uuid[])', [
      [tenantA, tenantB],
    ]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await closePools();
  });

  it('hides documents from the other tenant and from an unscoped query', async () => {
    const db = admin();
    const now = new Date();
    await db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: `doc-a-${tenantA.slice(0, 8)}`,
        displayName: 'Document A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: tenantB,
        slug: `doc-b-${tenantB.slice(0, 8)}`,
        displayName: 'Document B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await db
      .insert(documents)
      .values([row(docA, tenantA, 'Visible to A', now), row(docB, tenantB, 'Visible to B', now)]);

    const asA = await withTenant(tenantId(tenantA), async (tx) => tx.db.select().from(documents));
    expect(asA.map((row) => row.supplierName)).toEqual(['Visible to A']);

    const hidden = await withTenant(tenantId(tenantA), async (tx) =>
      tx.db.select().from(documents).where(eq(documents.id, docB)),
    );
    expect(hidden).toEqual([]);

    const unscoped = await getAppPool().query('SELECT id FROM doc_documents');
    expect(unscoped.rowCount).toBe(0);

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.insert(documents).values(row(randomUUID(), tenantB, 'Smuggled', now));
      });
      expect.fail('A tenant must not insert a document for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.delete(documents).where(eq(documents.id, docA));
      });
      expect.fail('The app role must not delete a document.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('The app role must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/permission denied/i);
    }
  });
});

function row(id: string, tenant: string, supplierName: string, now: Date) {
  return {
    id,
    tenantId: tenant,
    status: 'ready',
    filename: 'invoice.png',
    contentType: 'image/png',
    byteSize: 8,
    pageCount: 1,
    storageKey: `${tenant}/${id}`,
    supplierName,
    supplierVat: '',
    supplierMatch: 'none',
    documentNumber: 'DOC-1',
    currencyCode: 'ZAR',
    fieldConfidence: {},
    extracted: {},
    createdAt: now,
    updatedAt: now,
  };
}
