import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  closePools,
  getAdminPool,
  memberships,
  rolePermissions,
  roles,
  schema,
  tenantModules,
  userRoles,
  users,
} from '@omnivate/db';
import { saveItem } from '@omnivate/module-scm-01';
import { DocumentError } from '../src/errors';
import { pageUsage, supplierCodes } from '../src/schema';
import {
  captureDocument,
  centsToDecimal,
  presentDocument,
  processDocument,
  receiveDocument,
  undoDocument,
  usagePeriod,
  type Actor,
} from '../src/index';
import { demoReader } from '../src/demo-reader';
import { setDocumentReaderForTests } from '../src/providers';
import { memoryDocumentStore, setDocumentStoreForTests } from '../src/storage';

const tenant = randomUUID();
const userId = randomUUID();
const partyId = randomUUID();
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function actor(): Actor {
  return { userId, requestIp: '127.0.0.1', userAgent: 'doc-test' };
}

describe('document capture posting', () => {
  const admin = () => drizzle(getAdminPool(), { schema });
  let firstId = '';
  let screwId = '';

  beforeAll(async () => {
    setDocumentStoreForTests(memoryDocumentStore());
    setDocumentReaderForTests(demoReader);
    const db = admin();
    await db.insert(schema.tenants).values({
      id: tenant,
      slug: `doc-${tenant.slice(0, 8)}`,
      displayName: 'Document Posting',
      isDemo: false,
      timezone: 'Africa/Johannesburg',
      currencyCode: 'ZAR',
    });
    await db.insert(tenantModules).values([
      { tenantId: tenant, moduleId: 'SCM-01', active: true },
      { tenantId: tenant, moduleId: 'KRN-02', active: true },
    ]);
    const roleId = randomUUID();
    await db.insert(roles).values({
      id: roleId,
      tenantId: tenant,
      key: 'warehouse_technician',
      name: 'Warehouse',
      description: 'Test role',
      mfaRequired: false,
      isSystem: true,
    });
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: 'Warehouse',
      passwordHash: 'not-a-real-hash',
      status: 'active',
      totpEnabled: false,
    });
    await db.insert(memberships).values({ tenantId: tenant, userId, status: 'active' });
    await db.insert(userRoles).values({ tenantId: tenant, userId, roleId });
    await db.insert(rolePermissions).values({
      tenantId: tenant,
      roleId,
      scope: 'scm.catalog',
      modules: ['SCM-01'],
      action: 'admin',
      accessLabel: 'admin',
    });
  });

  afterAll(async () => {
    setDocumentStoreForTests(null);
    setDocumentReaderForTests(null);
    const pool = getAdminPool();
    const ids = [tenant];
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_append_only');
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_no_hard_delete');
    await pool.query(
      'ALTER TABLE scm01_pending_postings DISABLE TRIGGER scm01_pending_postings_append_only',
    );
    await pool.query('ALTER TABLE scm01_items DISABLE TRIGGER scm01_items_no_delete');
    await pool.query(
      'ALTER TABLE scm01_goods_receipts DISABLE TRIGGER scm01_goods_receipts_append_only',
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipt_lines DISABLE TRIGGER scm01_goods_receipt_lines_append_only',
    );
    try {
      await pool.query('DELETE FROM doc_receipt_links WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_supplier_codes WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_lines WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_documents WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_page_usage WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_label_prints WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_goods_receipt_lines WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_goods_receipts WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_movement_serials WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_pending_postings WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_movements WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_balances WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_item_uoms WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM party_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM parties WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      await pool.query(
        'ALTER TABLE scm01_goods_receipt_lines ENABLE TRIGGER scm01_goods_receipt_lines_append_only',
      );
      await pool.query(
        'ALTER TABLE scm01_goods_receipts ENABLE TRIGGER scm01_goods_receipts_append_only',
      );
      await pool.query('ALTER TABLE scm01_items ENABLE TRIGGER scm01_items_no_delete');
      await pool.query(
        'ALTER TABLE scm01_pending_postings ENABLE TRIGGER scm01_pending_postings_append_only',
      );
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_no_hard_delete');
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_append_only');
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await closePools();
    }
  });

  it('reads a fictional invoice, receives stock, and undoes it with a reversal', async () => {
    const pool = getAdminPool();
    await pool.query(
      `INSERT INTO parties (
        id, tenant_id, kind, display_name, legal_name, vat_number, popia_consent, status
      ) VALUES (
        $1, $2, 'organisation',
        'Silver Mango Packaging (Pty) Ltd', 'Silver Mango Packaging (Pty) Ltd',
        '4991001002', false, 'active'
      ) ON CONFLICT (id) DO NOTHING`,
      [partyId, tenant],
    );
    await pool.query(
      `INSERT INTO party_roles (tenant_id, party_id, role)
       VALUES ($1, $2, 'supplier')
       ON CONFLICT (party_id, role) DO NOTHING`,
      [tenant, partyId],
    );

    const made = await withTenant(tenantId(tenant), async (tx) => {
      const screw = await saveItem(
        tx,
        actor(),
        null,
        item('AT-SCR', 'Chipboard screw 4 x 50 mm', 'each'),
      );
      await saveItem(tx, actor(), null, item('AT-CEM', 'Portland cement 42.5 N, 50 kg', 'bag'));
      await saveItem(tx, actor(), null, item('AT-SIL', 'Clear silicone sealant', 'tube'));
      return screw.id;
    });
    screwId = made;

    firstId = await withTenant(tenantId(tenant), (tx) =>
      captureDocument(tx, actor(), { filename: 'silver-mango-invoice.png', bytes: png }),
    );
    await processDocument(tenant, firstId);
    const ready = await withTenant(tenantId(tenant), (tx) => presentDocument(tx, actor(), firstId));
    expect(ready.status).toBe('ready');
    expect(ready.supplierMatch).toBe('vat');
    expect(ready.partyName).toBe('Silver Mango Packaging (Pty) Ltd');
    expect(ready.lines.every((line) => line.itemId)).toBe(true);
    expect(ready.warnings).toEqual([]);
    expect(ready.lowConfidence).toContain('dueDate');
    expect(ready.branchId).not.toBe('');

    const posted = await withTenant(tenantId(tenant), (tx) =>
      receiveDocument(tx, actor(), firstId, false),
    );
    expect(posted.status).toBe('posted');
    expect(posted.receipts).toHaveLength(3);
    expect(posted.goodsReceiptId).toBeTruthy();
    const grvLines = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM scm01_goods_receipt_lines WHERE goods_receipt_id = $1',
      [posted.goodsReceiptId],
    );
    expect(grvLines.rows[0]?.n).toBe('3');

    const cost = await pool.query<{ cost_cents: string }>(
      'SELECT cost_cents FROM scm01_items WHERE id = $1',
      [screwId],
    );
    expect(String(cost.rows[0]?.cost_cents)).toBe('85');

    const memory = await withTenant(tenantId(tenant), async (tx) =>
      tx.db.select().from(supplierCodes),
    );
    expect(memory.map((row) => row.supplierCode).sort()).toEqual(['SM-CEM', 'SM-SCR', 'SM-SIL']);

    const usage = await withTenant(tenantId(tenant), async (tx) =>
      tx.db.select().from(pageUsage).where(eq(pageUsage.period, usagePeriod())),
    );
    expect(usage[0]?.pages).toBeGreaterThan(0);

    const second = await withTenant(tenantId(tenant), (tx) =>
      captureDocument(tx, actor(), { filename: 'silver-mango-invoice.png', bytes: png }),
    );
    await processDocument(tenant, second);
    const duplicate = await withTenant(tenantId(tenant), (tx) =>
      presentDocument(tx, actor(), second),
    );
    expect(duplicate.duplicate?.id).toBe(firstId);
    await expect(
      withTenant(tenantId(tenant), (tx) => receiveDocument(tx, actor(), second, false)),
    ).rejects.toBeInstanceOf(DocumentError);

    const undone = await withTenant(tenantId(tenant), (tx) => undoDocument(tx, actor(), firstId));
    expect(undone.status).toBe('reversed');
    const restored = await pool.query<{ cost_cents: string }>(
      'SELECT cost_cents FROM scm01_items WHERE id = $1',
      [screwId],
    );
    expect(String(restored.rows[0]?.cost_cents)).toBe('85');
    const onHand = await pool.query<{ quantity: string }>(
      'SELECT quantity FROM scm01_balances WHERE item_id = $1',
      [screwId],
    );
    expect(Number(onHand.rows[0]?.quantity ?? 0)).toBe(0);
    const reversals = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scm01_movements WHERE tenant_id = $1 AND kind = 'reversal'`,
      [tenant],
    );
    expect(reversals.rows[0]?.n).toBe('3');

    const audits = await withTenant(tenantId(tenant), async (tx) =>
      tx.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, firstId)),
    );
    expect(audits.map((row) => row.action).sort()).toEqual([
      'document.receipt.post',
      'document.receipt.undo',
    ]);
    expect(centsToDecimal(85n)).toBe('0.85');
  });
});

function item(sku: string, name: string, unit: string) {
  return {
    kind: 'stock' as const,
    sku,
    barcode: '',
    name,
    description: 'Fictional',
    category: 'Received',
    baseUom: unit,
    baseUomPlural: unit,
    cost: '0.00',
    sellingPrice: '1.00',
    reorderLevel: '0',
    trackBatches: false,
    trackSerials: false,
    uoms: [],
  };
}
