import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  closePools,
  getAdminPool,
  getAppPool,
  memberships,
  rolePermissions,
  roles,
  schema,
  userRoles,
  users,
} from '@omnivate/db';
import { eq } from 'drizzle-orm';
import {
  adjustStock,
  decideAdjustment,
  listBranches,
  listItems,
  receiveStock,
  reverseMovement,
  saveItem,
  valuation,
  type Actor,
} from '../src/catalog';
import { items, movements } from '../src/schema';

const tenant = randomUUID();
const otherTenant = randomUUID();
const warehouseUser = randomUUID();
const managerUser = randomUUID();
const cashierUser = randomUUID();
const portalUser = randomUUID();
const accountantUser = randomUUID();
const hrUser = randomUUID();
const ownerUser = randomUUID();

function actor(userId: string): Actor {
  return { userId, requestIp: null, userAgent: 'scm-test' };
}

async function grant(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
  roleKey: string,
  actions: { action: string; limit?: bigint | null }[],
) {
  const roleId = randomUUID();
  const mfaRequired = ['tenant_owner', 'branch_manager', 'accountant', 'hr_compliance'].includes(
    roleKey,
  );
  await db.insert(roles).values({
    id: roleId,
    tenantId: tenant,
    key: roleKey,
    name: roleKey,
    description: 'Test role',
    mfaRequired,
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
  await db.insert(memberships).values({ tenantId: tenant, userId, status: 'active' });
  await db.insert(userRoles).values({ tenantId: tenant, userId, roleId });
  if (actions.length > 0) {
    await db.insert(rolePermissions).values(
      actions.map((entry) => ({
        tenantId: tenant,
        roleId,
        scope: 'scm.catalog',
        modules: ['SCM-01'],
        action: entry.action,
        accessLabel: entry.action,
        approvalLimitCents: entry.limit === undefined ? null : entry.limit,
      })),
    );
  }
}

describe('SCM-01 stock ledger', () => {
  const admin = () => drizzle(getAdminPool(), { schema });
  let branchId = '';
  let itemId = '';
  let receiptId = '';

  beforeAll(async () => {
    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: tenant,
        slug: `scm-${tenant.slice(0, 8)}`,
        displayName: 'Stock Test',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: otherTenant,
        slug: `scm-b-${otherTenant.slice(0, 8)}`,
        displayName: 'Other Stock',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await grant(db, warehouseUser, 'warehouse_technician', [
      { action: 'read' },
      { action: 'operate' },
    ]);
    await grant(db, managerUser, 'branch_manager', [
      { action: 'read' },
      { action: 'approve', limit: 5_000_000n },
    ]);
    await grant(db, cashierUser, 'sales_cashier', [{ action: 'read' }]);
    await grant(db, portalUser, 'external_portal', [{ action: 'read' }]);
    await grant(db, accountantUser, 'accountant', [{ action: 'read' }, { action: 'post' }]);
    await grant(db, hrUser, 'hr_compliance', []);
    await grant(db, ownerUser, 'tenant_owner', [{ action: 'admin' }]);

    const branches = await withTenant(tenantId(tenant), (tx) =>
      listBranches(tx, actor(warehouseUser)),
    );
    branchId = branches.branches[0]?.id ?? '';
    const created = await withTenant(tenantId(tenant), (tx) =>
      saveItem(tx, actor(warehouseUser), null, {
        kind: 'stock',
        sku: 'TEST-BOX',
        barcode: '9900000099001',
        name: 'Test bolts',
        description: 'Fictional',
        category: 'Fasteners',
        baseUom: 'each',
        baseUomPlural: 'each',
        cost: '0.00',
        sellingPrice: '5.00',
        reorderLevel: '2',
        trackBatches: false,
        trackSerials: false,
        uoms: [{ name: 'box', plural: 'boxes', factor: '10' }],
      }),
    );
    itemId = created.id;
  });

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_append_only');
    await pool.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_no_hard_delete');
    await pool.query(
      'ALTER TABLE scm01_pending_postings DISABLE TRIGGER scm01_pending_postings_append_only',
    );
    await pool.query('ALTER TABLE scm01_items DISABLE TRIGGER scm01_items_no_delete');
    try {
      const ids = [tenant, otherTenant];
      await pool.query('DELETE FROM scm01_movement_serials WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_pending_postings WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_adjustment_requests WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query('DELETE FROM scm01_movements WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_batch_balances WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_balances WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_serials WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_batches WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_item_uoms WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM scm01_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM sod_rules WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [warehouseUser, managerUser, cashierUser, portalUser, accountantUser, hrUser, ownerUser],
      ]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_append_only');
      await pool.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_no_hard_delete');
      await pool.query(
        'ALTER TABLE scm01_pending_postings ENABLE TRIGGER scm01_pending_postings_append_only',
      );
      await pool.query('ALTER TABLE scm01_items ENABLE TRIGGER scm01_items_no_delete');
      await closePools();
    }
  });

  it('recalculates weighted average on receipt and keeps it on an issue', async () => {
    const first = await withTenant(tenantId(tenant), (tx) =>
      receiveStock(tx, actor(warehouseUser), {
        itemId,
        branchId,
        quantity: '10',
        uomName: 'each',
        unitCost: '10.00',
      }),
    );
    receiptId = first.movementId;
    expect(first.averageCostLabel).toBe('R10.00');

    const second = await withTenant(tenantId(tenant), (tx) =>
      receiveStock(tx, actor(warehouseUser), {
        itemId,
        branchId,
        quantity: '1',
        uomName: 'box',
        unitCost: '30.00',
      }),
    );
    expect(second.averageCostLabel).toBe('R20.00');

    const listed = await withTenant(tenantId(tenant), (tx) =>
      listItems(tx, actor(warehouseUser), 'active', 'TEST-BOX'),
    );
    expect(listed.items[0]?.onHandLabel).toBe('20 each');
    expect(listed.items[0]?.costLabel).toBe('R20.00');
    expect(listed.items[0]?.valueLabel).toBe('R400.00');

    const { issueStock } = await import('../src/catalog');
    await withTenant(tenantId(tenant), (tx) =>
      issueStock(tx, actor(warehouseUser), {
        itemId,
        branchId,
        quantity: '4',
        uomName: 'each',
        reason: 'Used on a fictional job',
      }),
    );
    const after = await withTenant(tenantId(tenant), (tx) =>
      listItems(tx, actor(warehouseUser), 'active', 'bolts'),
    );
    expect(after.items[0]?.onHandLabel).toBe('16 each');
    expect(after.items[0]?.costLabel).toBe('R20.00');
  });

  it('keeps the ledger append-only and records the audit before and after', async () => {
    async function expectRejected(sqlText: string, params: unknown[], pattern: RegExp) {
      const client = await getAppPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant]);
        await expect(client.query(sqlText, params)).rejects.toThrow(pattern);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }

    await expectRejected(
      'UPDATE scm01_movements SET reason = $1 WHERE id = $2',
      ['changed', receiptId],
      /append-only/,
    );
    await expectRejected(
      'DELETE FROM scm01_movements WHERE id = $1',
      [receiptId],
      /append-only|GOV-03/,
    );
    await expectRejected('DELETE FROM scm01_items WHERE id = $1', [itemId], /never deleted/);

    const trail = await withTenant(tenantId(tenant), async (tx) =>
      tx.db
        .select({ beforeData: auditEvents.beforeData, afterData: auditEvents.afterData })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, itemId)),
    );
    expect(trail[0]?.beforeData).toBeNull();
    expect(trail[0]?.afterData).toMatchObject({ name: 'Test bolts' });
  });

  it('unwinds the average when a receipt is reversed', async () => {
    const rows = await withTenant(tenantId(tenant), async (tx) =>
      tx.db.select().from(movements).where(eq(movements.itemId, itemId)),
    );
    const box = rows.find((row) => row.uomName === 'box');
    expect(box).toBeTruthy();
    await withTenant(tenantId(tenant), (tx) =>
      reverseMovement(tx, actor(warehouseUser), box!.id, 'The box was not delivered'),
    );
    const item = await withTenant(tenantId(tenant), async (tx) => {
      const found = await tx.db.select().from(items).where(eq(items.id, itemId));
      return found[0];
    });
    expect(item?.costCents).toBe(333n);
  });

  it('hides one tenant from the other and from an unscoped query', async () => {
    const hidden = await withTenant(tenantId(otherTenant), async (tx) =>
      tx.db.select().from(items).where(eq(items.id, itemId)),
    );
    expect(hidden).toHaveLength(0);
    const unscoped = await getAppPool().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM scm01_items',
    );
    expect(unscoped.rows[0]?.count).toBe(0);
    const client = await getAppPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [otherTenant]);
      await expect(
        client.query(
          `INSERT INTO scm01_items (
            tenant_id, kind, sku, name, base_uom, cost_cents, selling_price_cents, vat_rate_basis_points
          ) VALUES ($1, 'stock', 'X', 'X', 'each', 0, 0, 1500)`,
          [tenant],
        ),
      ).rejects.toThrow(/row-level security|policy/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('follows the blueprint roles', async () => {
    await expect(
      withTenant(tenantId(tenant), (tx) => listItems(tx, actor(hrUser), 'active', '')),
    ).rejects.toThrow(/cannot open stock/);

    const cashier = await withTenant(tenantId(tenant), (tx) =>
      listItems(tx, actor(cashierUser), 'active', 'bolts'),
    );
    expect(cashier.items[0]?.onHandLabel).toBeTruthy();
    expect(cashier.items[0]?.costLabel).toBeNull();

    const portal = await withTenant(tenantId(tenant), (tx) =>
      listItems(tx, actor(portalUser), 'active', 'bolts'),
    );
    expect(portal.items[0]?.onHandLabel).toBeNull();
    expect(portal.items[0]?.priceLabel).toBe('R5.00');

    const report = await withTenant(tenantId(tenant), (tx) => valuation(tx, actor(accountantUser)));
    expect(report.method).toBe('Weighted average');
    await expect(
      withTenant(tenantId(tenant), (tx) =>
        receiveStock(tx, actor(accountantUser), {
          itemId,
          branchId,
          quantity: '1',
          uomName: 'each',
          unitCost: '10.00',
        }),
      ),
    ).rejects.toThrow(/cannot receive/);

    const pending = await withTenant(tenantId(tenant), (tx) =>
      adjustStock(tx, actor(warehouseUser), {
        itemId,
        branchId,
        quantity: '3004',
        uomName: 'each',
        direction: 'up',
        reason: 'Fictional year-end count',
      }),
    );
    expect(pending.pending).toBe(true);
    await expect(
      withTenant(tenantId(tenant), (tx) =>
        decideAdjustment(tx, actor(warehouseUser), pending.requestId ?? '', 'approved'),
      ),
    ).rejects.toThrow(/cannot approve/);

    const approved = await withTenant(tenantId(tenant), (tx) =>
      decideAdjustment(tx, actor(managerUser), pending.requestId ?? '', 'approved'),
    );
    expect(approved.movementId).toBeTruthy();

    const own = await withTenant(tenantId(tenant), (tx) =>
      adjustStock(tx, actor(managerUser), {
        itemId,
        branchId,
        quantity: '15016',
        uomName: 'each',
        direction: 'up',
        reason: 'Manager asks for another count',
      }),
    );
    expect(own.pending).toBe(true);
    await expect(
      withTenant(tenantId(tenant), (tx) =>
        decideAdjustment(tx, actor(managerUser), own.requestId ?? '', 'approved'),
      ),
    ).rejects.toThrow(/Segregation of duties/);
  });
});
