import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
  userRoles,
  users,
} from '@omnivate/db';
import { getItem, listBranches, saveItem, type Actor, type ItemWrite } from '../src/catalog';
import {
  findScannedItem,
  previewGoodsReceiptLabels,
  printGoodsReceiptLabels,
  receiveGoods,
} from '../src/goods-receipts';
import { labelPrints } from '../src/schema';

const tenant = randomUUID();
const otherTenant = randomUUID();
const warehouseUser = randomUUID();
const cashierUser = randomUUID();
const otherUser = randomUUID();

function actor(userId: string): Actor {
  return { userId, requestIp: null, userAgent: 'grv-test' };
}

function item(sku: string, barcode = ''): ItemWrite {
  return {
    kind: 'stock',
    sku,
    barcode,
    name: sku,
    description: 'Fictional',
    category: 'Test',
    baseUom: 'each',
    baseUomPlural: 'each',
    cost: '1.00',
    sellingPrice: '2.00',
    reorderLevel: '0',
    trackBatches: false,
    trackSerials: false,
    uoms: [],
  };
}

async function grant(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
  tenantForUser: string,
  roleKey: string,
  actions: string[],
) {
  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    tenantId: tenantForUser,
    key: roleKey,
    name: roleKey,
    description: 'Test role',
    mfaRequired: false,
    isSystem: true,
  });
  await db.insert(users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: roleKey,
    passwordHash: 'not-a-real-hash',
    status: 'active',
    totpEnabled: false,
  });
  await db.insert(memberships).values({ tenantId: tenantForUser, userId, status: 'active' });
  await db.insert(userRoles).values({ tenantId: tenantForUser, userId, roleId });
  if (actions.length > 0) {
    await db.insert(rolePermissions).values(
      actions.map((action) => ({
        tenantId: tenantForUser,
        roleId,
        scope: 'scm.catalog',
        modules: ['SCM-01'],
        action,
        accessLabel: action,
        approvalLimitCents: null,
      })),
    );
  }
}

describe('goods receipt labels', () => {
  const admin = () => drizzle(getAdminPool(), { schema });
  let branchId = '';
  let otherBranchId = '';

  beforeAll(async () => {
    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: tenant,
        slug: `grv-${tenant.slice(0, 8)}`,
        displayName: 'Receipt Test',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: otherTenant,
        slug: `grv-b-${otherTenant.slice(0, 8)}`,
        displayName: 'Other Receipt',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await grant(db, warehouseUser, tenant, 'warehouse_technician', ['read', 'operate']);
    await grant(db, cashierUser, tenant, 'sales_cashier', ['read']);
    await grant(db, otherUser, otherTenant, 'warehouse_technician', ['read', 'operate']);
    const branches = await withTenant(tenantId(tenant), (tx) =>
      listBranches(tx, actor(warehouseUser)),
    );
    branchId = branches.branches[0]?.id ?? '';
    const otherBranches = await withTenant(tenantId(otherTenant), (tx) =>
      listBranches(tx, actor(otherUser)),
    );
    otherBranchId = otherBranches.branches[0]?.id ?? '';
  });

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await pool.query(
      'ALTER TABLE scm01_label_prints DISABLE TRIGGER scm01_label_prints_append_only',
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipt_lines DISABLE TRIGGER scm01_goods_receipt_lines_append_only',
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipts DISABLE TRIGGER scm01_goods_receipts_append_only',
    );
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_append_only');
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_no_hard_delete');
    await pool.query(
      'ALTER TABLE scm01_pending_postings DISABLE TRIGGER scm01_pending_postings_append_only',
    );
    await pool.query('ALTER TABLE scm01_items DISABLE TRIGGER scm01_items_no_delete');
    try {
      const ids = [tenant, otherTenant];
      await pool.query('DELETE FROM scm01_label_prints WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_goods_receipt_lines WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_goods_receipts WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_pending_postings WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_movements WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_balances WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [warehouseUser, cashierUser, otherUser],
      ]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await pool.query(
        'ALTER TABLE scm01_label_prints ENABLE TRIGGER scm01_label_prints_append_only',
      );
      await pool.query(
        'ALTER TABLE scm01_goods_receipt_lines ENABLE TRIGGER scm01_goods_receipt_lines_append_only',
      );
      await pool.query(
        'ALTER TABLE scm01_goods_receipts ENABLE TRIGGER scm01_goods_receipts_append_only',
      );
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_append_only');
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_no_hard_delete');
      await pool.query(
        'ALTER TABLE scm01_pending_postings ENABLE TRIGGER scm01_pending_postings_append_only',
      );
      await pool.query('ALTER TABLE scm01_items ENABLE TRIGGER scm01_items_no_delete');
    }
    await closePools();
  });

  it('assigns a tenant-unique barcode and keeps a supplier barcode', async () => {
    const first = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, item('CLIP-1')),
    );
    const second = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, item('CLIP-2')),
    );
    const supplied = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, item('BOLT', '9900000099001')),
    );
    const elsewhere = await withTenant(tenantId(otherTenant), (tx) =>
      saveItem(tx, actor(otherUser), null, item('CLIP-1')),
    );
    const firstItem = await withTenant(tenantId(tenant), (tx) =>
      getItem(tx, actor(warehouseUser), first.id),
    );
    const secondItem = await withTenant(tenantId(tenant), (tx) =>
      getItem(tx, actor(warehouseUser), second.id),
    );
    const suppliedItem = await withTenant(tenantId(tenant), (tx) =>
      getItem(tx, actor(warehouseUser), supplied.id),
    );
    const otherItem = await withTenant(tenantId(otherTenant), (tx) =>
      getItem(tx, actor(otherUser), elsewhere.id),
    );
    expect(firstItem.item.barcode).toBe('OM00000001');
    expect(secondItem.item.barcode).toBe('OM00000002');
    expect(suppliedItem.item.barcode).toBe('9900000099001');
    expect(otherItem.item.barcode).toBe('OM00000001');
    await expect(
      withTenant(tenantId(tenant), (tx) =>
        saveItem(tx, actor(warehouseUser), null, item('BOLT-2', '9900000099001')),
      ),
    ).rejects.toThrow(/already used/);
    expect(branchId).not.toBe('');
    expect(otherBranchId).not.toBe('');
  });

  it('posts a goods receipt and audits each printed line', async () => {
    const blank = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, item('TAPE')),
    );
    const known = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, item('CEMENT', '9900000001002')),
    );
    const posted = await withTenant(tenantId(tenant), (tx) =>
      receiveGoods(tx, actor(warehouseUser), {
        branchId,
        note: 'Morning delivery',
        lines: [
          {
            itemId: known.id,
            branchId,
            quantity: '6',
            uomName: 'each',
            unitCost: '1.25',
          },
          {
            itemId: blank.id,
            branchId,
            quantity: '0.4',
            uomName: 'each',
            unitCost: '2.00',
          },
        ],
      }),
    );
    expect(posted.receipt.number).toBe('GRV-1001');
    expect(posted.receipt.lines.map((line) => line.defaultCopies)).toEqual([6, 1]);
    expect(posted.access.canPrint).toBe(true);

    const preview = await withTenant(tenantId(tenant), (tx) =>
      previewGoodsReceiptLabels(tx, actor(warehouseUser), posted.receipt.id),
    );
    const tape = preview.labels.find((line) => line.itemId === blank.id);
    expect(tape?.barcode.startsWith('OM')).toBe(true);
    expect(tape?.symbology).toBe('code128');
    expect(preview.labels.find((line) => line.itemId === known.id)?.symbology).toBe('code128');
    expect(preview.widthMm).toBe('50.00');
    expect(preview.heightMm).toBe('15.00');

    const scan = await withTenant(tenantId(tenant), (tx) =>
      findScannedItem(tx, actor(warehouseUser), '9900000001002'),
    );
    expect(scan.item?.id).toBe(known.id);
    const missing = await withTenant(tenantId(tenant), (tx) =>
      findScannedItem(tx, actor(warehouseUser), 'NO-SUCH-CODE'),
    );
    expect(missing.item).toBeNull();

    const cementLine = preview.labels.find((line) => line.itemId === known.id);
    const tapeLine = preview.labels.find((line) => line.itemId === blank.id);
    const printed = await withTenant(tenantId(tenant), (tx) =>
      printGoodsReceiptLabels(tx, actor(warehouseUser), posted.receipt.id, [
        { lineId: cementLine?.id ?? '', copies: 2 },
        { lineId: tapeLine?.id ?? '', copies: 1 },
      ]),
    );
    expect(printed.total).toBe(3);

    const prints = await withTenant(tenantId(tenant), (tx) =>
      tx.db.select().from(labelPrints).where(eq(labelPrints.goodsReceiptId, posted.receipt.id)),
    );
    expect(prints.map((row) => row.copies).sort()).toEqual([1, 2]);

    const audit = await withTenant(tenantId(tenant), (tx) =>
      tx.db.select().from(auditEvents).where(eq(auditEvents.action, 'scm.label.printed')),
    );
    const row = audit.find((entry) => entry.entityId === posted.receipt.id);
    const after = row?.afterData as { lines?: { copies: number }[] } | null;
    expect(after?.lines?.map((line) => line.copies).sort()).toEqual([1, 2]);

    await expect(
      getAdminPool().query('DELETE FROM scm01_label_prints WHERE goods_receipt_id = $1', [
        posted.receipt.id,
      ]),
    ).rejects.toThrow(/append-only/);

    await expect(
      withTenant(tenantId(tenant), (tx) =>
        printGoodsReceiptLabels(tx, actor(cashierUser), posted.receipt.id, [
          { lineId: cementLine?.id ?? '', copies: 1 },
        ]),
      ),
    ).rejects.toThrow(/cannot print/);
  });
});
