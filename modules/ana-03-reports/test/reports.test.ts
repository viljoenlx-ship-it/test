import { randomUUID } from 'node:crypto';
import { activationClosure, getModule, tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool, seedTenantRbac } from '@omnivate/db';
import { listReports, saveReport } from '../src/store';
import { runReport } from '../src/run';

const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = randomUUID();
const cashierA = randomUUID();
const ownerB = randomUUID();
const itemA = randomUUID();
const itemB = randomUUID();
const partyA = randomUUID();
const partyB = randomUUID();
const receiptA = randomUUID();
const receiptB = randomUUID();

describe('ANA-03 reports', () => {
  const pool = () => getAdminPool();

  beforeAll(async () => {
    const admin = pool();
    await admin.query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Report A', false, 'Africa/Johannesburg', 'ZAR'),
              ($3, $4, 'Report B', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenantA, `rep-a-${tenantA.slice(0, 8)}`, tenantB, `rep-b-${tenantB.slice(0, 8)}`],
    );
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { schema } = await import('@omnivate/db');
    const db = drizzle(admin, { schema });
    const rolesA = await seedTenantRbac(db, tenantA);
    const rolesB = await seedTenantRbac(db, tenantB);
    await admin.query(
      `INSERT INTO users (id, email, display_name, password_hash, status, totp_enabled)
       VALUES ($1, $2, 'Owner A', 'x', 'active', false),
              ($3, $4, 'Cashier A', 'x', 'active', false),
              ($5, $6, 'Owner B', 'x', 'active', false)`,
      [
        ownerA,
        `${ownerA}@example.com`,
        cashierA,
        `${cashierA}@example.com`,
        ownerB,
        `${ownerB}@example.com`,
      ],
    );
    await admin.query(
      `INSERT INTO memberships (tenant_id, user_id, status)
       VALUES ($1, $2, 'active'), ($1, $3, 'active'), ($4, $5, 'active')`,
      [tenantA, ownerA, cashierA, tenantB, ownerB],
    );
    await admin.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       VALUES ($1, $2, $3), ($1, $4, $5), ($6, $7, $8)`,
      [
        tenantA,
        ownerA,
        rolesA.get('tenant_owner'),
        cashierA,
        rolesA.get('sales_cashier'),
        tenantB,
        ownerB,
        rolesB.get('tenant_owner'),
      ],
    );
    await admin.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, active)
       VALUES ($1, 'SCM-01', true), ($1, 'ANA-03', true), ($2, 'SCM-01', true), ($2, 'ANA-03', true)
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET active = true`,
      [tenantA, tenantB],
    );
    const branches = await admin.query<{ tenant_id: string; id: string }>(
      `SELECT tenant_id, id FROM krn03_branches WHERE is_head_office AND tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    const branchA = branches.rows.find((row) => row.tenant_id === tenantA)?.id;
    const branchB = branches.rows.find((row) => row.tenant_id === tenantB)?.id;
    if (!branchA || !branchB) {
      throw new Error('Head office was not created.');
    }
    await admin.query(
      `INSERT INTO scm01_items (
         id, tenant_id, kind, sku, name, description, category, base_uom, base_uom_plural,
         cost_cents, selling_price_cents, vat_rate_basis_points, reorder_level,
         track_batches, track_serials, status
       ) VALUES
       ($1, $2, 'stock', 'A-1', 'Visible Bolt', '', 'Test', 'each', 'each', 123456, 200000, 1500, 1, false, false, 'active'),
       ($3, $4, 'stock', 'B-1', 'Hidden Bolt', '', 'Test', 'each', 'each', 999999, 200000, 1500, 1, false, false, 'active')`,
      [itemA, tenantA, itemB, tenantB],
    );
    await admin.query(
      `INSERT INTO scm01_balances (tenant_id, item_id, branch_id, quantity)
       VALUES ($1, $2, $3, 4), ($4, $5, $6, 2)`,
      [tenantA, itemA, branchA, tenantB, itemB, branchB],
    );
    await admin.query(
      `INSERT INTO parties (id, tenant_id, kind, display_name, popia_consent, status)
       VALUES ($1, $2, 'organisation', 'Silver Mango Packaging', false, 'active'),
              ($3, $4, 'organisation', 'Other Tenant Supplier', false, 'active')`,
      [partyA, tenantA, partyB, tenantB],
    );
    const moveA = randomUUID();
    const moveB = randomUUID();
    await admin.query(
      `INSERT INTO scm01_movements (
         id, tenant_id, item_id, branch_id, kind, quantity, uom_name, uom_plural, uom_factor,
         entered_quantity, unit_cost_cents, value_cents, reason, status, occurred_at
       ) VALUES
       ($1, $2, $3, $4, 'receipt', 15, 'each', 'each', 1, 15, 85, 1275, 'Test receipt', 'posted', '2026-11-04T06:00:00Z'),
       ($5, $6, $7, $8, 'receipt', 3, 'each', 'each', 1, 3, 10, 30, 'Other receipt', 'posted', '2026-11-04T06:00:00Z')`,
      [moveA, tenantA, itemA, branchA, moveB, tenantB, itemB, branchB],
    );
    await admin.query(
      `INSERT INTO scm01_goods_receipts (
         id, tenant_id, number, branch_id, note, received_at, supplier_party_id
       ) VALUES
       ($1, $2, 'GRV-1', $3, 'Test', '2026-11-04T06:00:00Z', $4),
       ($5, $6, 'GRV-9', $7, 'Other', '2026-11-04T06:00:00Z', $8)`,
      [receiptA, tenantA, branchA, partyA, receiptB, tenantB, branchB, partyB],
    );
    await admin.query(
      `INSERT INTO scm01_goods_receipt_lines (
         tenant_id, goods_receipt_id, line_no, item_id, movement_id, quantity
       ) VALUES
       ($1, $2, 1, $3, $4, 15),
       ($5, $6, 1, $7, $8, 3)`,
      [tenantA, receiptA, itemA, moveA, tenantB, receiptB, itemB, moveB],
    );
  });

  afterAll(async () => {
    const admin = pool();
    const ids = [tenantA, tenantB];
    await admin.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await admin.query('ALTER TABLE tenant_modules DISABLE TRIGGER tenant_modules_root_required');
    await admin.query('ALTER TABLE scm01_items DISABLE TRIGGER scm01_items_no_delete');
    await admin.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_append_only');
    await admin.query('ALTER TABLE scm01_movements DISABLE TRIGGER scm01_movements_no_hard_delete');
    await admin.query(
      'ALTER TABLE scm01_goods_receipt_lines DISABLE TRIGGER scm01_goods_receipt_lines_append_only',
    );
    await admin.query(
      'ALTER TABLE scm01_goods_receipts DISABLE TRIGGER scm01_goods_receipts_append_only',
    );
    try {
      await admin.query('DELETE FROM scm01_goods_receipt_lines WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await admin.query('DELETE FROM scm01_goods_receipts WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await admin.query('DELETE FROM scm01_movements WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM scm01_balances WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM scm01_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM ana03_reports WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM parties WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerA, cashierA, ownerB],
      ]);
      await admin.query('DELETE FROM krn03_branch_access WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM krn03_branches WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM krn03_legal_entities WHERE tenant_id = ANY($1::uuid[])', [
        ids,
      ]);
      await admin.query('DELETE FROM krn03_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      await admin.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await admin.query('ALTER TABLE tenant_modules ENABLE TRIGGER tenant_modules_root_required');
      await admin.query('ALTER TABLE scm01_items ENABLE TRIGGER scm01_items_no_delete');
      await admin.query('ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_append_only');
      await admin.query(
        'ALTER TABLE scm01_movements ENABLE TRIGGER scm01_movements_no_hard_delete',
      );
      await admin.query(
        'ALTER TABLE scm01_goods_receipt_lines ENABLE TRIGGER scm01_goods_receipt_lines_append_only',
      );
      await admin.query(
        'ALTER TABLE scm01_goods_receipts ENABLE TRIGGER scm01_goods_receipts_append_only',
      );
      await closePools();
    }
  });

  it('matches the catalog: ANA-03 needs KRN-01', () => {
    expect(getModule('ANA-03').prerequisites).toEqual(['KRN-01']);
    expect(activationClosure('ANA-03')).toEqual(['KRN-01', 'ANA-03']);
    expect(getModule('ANA-03').name).toBe('Executive Dashboards & Custom Report Builder');
  });

  it('hides cost and stock value from a cashier', async () => {
    const definition = {
      source: 'stock_items',
      columns: ['item', 'on_hand', 'cost', 'value'],
      filters: [],
      groupBy: [],
      totals: [{ field: 'value', fn: 'sum' as const }],
      sort: [{ field: 'item', direction: 'asc' as const }],
      chart: 'none' as const,
    };
    const cashier = await withTenant(tenantId(tenantA), (tx) =>
      runReport(tx, cashierA, definition, { limit: 50, offset: 0 }),
    );
    expect(cashier.columns.map((column) => column.label)).toEqual(['Item', 'On Hand']);
    expect(cashier.hidden).toEqual(expect.arrayContaining(['Cost', 'Stock Value']));
    expect(JSON.stringify(cashier)).not.toContain('123456');
    expect(JSON.stringify(cashier)).not.toContain('1 234.56');
    expect(cashier.rows.some((row) => row.some((cell) => cell.text === 'Visible Bolt'))).toBe(true);
    expect(cashier.rows.some((row) => row.some((cell) => cell.text === 'Hidden Bolt'))).toBe(false);

    const owner = await withTenant(tenantId(tenantA), (tx) =>
      runReport(tx, ownerA, definition, { limit: 50, offset: 0 }),
    );
    expect(owner.columns.map((column) => column.label)).toContain('Cost');
    expect(JSON.stringify(owner)).toContain('R1 234.56');
  });

  it('totals goods received for this tenant only', async () => {
    const table = await withTenant(tenantId(tenantA), (tx) =>
      runReport(
        tx,
        ownerA,
        {
          source: 'stock_receipts',
          columns: ['supplier'],
          filters: [{ field: 'supplier', op: 'contains', value: 'Silver Mango' }],
          groupBy: ['supplier'],
          totals: [
            { field: 'quantity', fn: 'sum' },
            { field: 'value', fn: 'sum' },
          ],
          sort: [{ field: 'supplier', direction: 'asc' }],
          chart: 'bar',
        },
        { limit: 50, offset: 0, timeout: 'preview' },
      ),
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[0]?.text).toContain('Silver Mango');
    expect(table.rows[0]?.map((cell) => cell.text)).toContain('15');
    expect(JSON.stringify(table)).not.toContain('Other Tenant');
  });

  it('keeps saved reports inside the tenant, including an unscoped query', async () => {
    const saved = await withTenant(tenantId(tenantA), (tx) =>
      saveReport(
        tx,
        { userId: ownerA, operatorId: null, requestIp: null, userAgent: 'test' },
        {
          name: 'Private bolts',
          definition: {
            source: 'stock_items',
            columns: ['item', 'on_hand'],
            filters: [],
            groupBy: [],
            totals: [],
            sort: [],
            chart: 'none',
          },
          visibility: 'private',
          sharedRoles: [],
          operator: false,
        },
      ),
    );
    const seenByB = await withTenant(tenantId(tenantB), (tx) => listReports(tx, ownerB, [], false));
    expect(seenByB.some((report) => report.id === saved.id)).toBe(false);
    const unscoped = await getAppPool().query('SELECT id FROM ana03_reports');
    expect(unscoped.rowCount).toBe(0);
    const audit = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute(
        (await import('drizzle-orm'))
          .sql`SELECT action FROM audit_events WHERE entity_id = ${saved.id}`,
      );
      return (result as unknown as { rows: { action: string }[] }).rows.map((row) => row.action);
    });
    expect(audit).toContain('report.saved');
  });
});
