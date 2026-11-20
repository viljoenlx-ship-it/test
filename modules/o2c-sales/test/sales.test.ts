import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
import {
  convertQuote,
  invoiceBalance,
  issueInvoice,
  nextDocumentNumber,
  saveInvoice,
  saveQuote,
  setQuoteStatus,
} from '../src/documents';
import { recordPayment } from '../src/payments';
import type { Actor } from '../src/access';
import { SalesError } from '../src/errors';

const tenantA = randomUUID();
const tenantB = randomUUID();
const owner = randomUUID();
const cashier = randomUUID();
const accountant = randomUUID();

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { message?: unknown; cause?: unknown; code?: unknown };
    if (typeof record.message === 'string') {
      parts.push(record.message);
    }
    if (typeof record.code === 'string') {
      parts.push(record.code);
    }
    current = record.cause;
  }
  return parts.join('\n');
}

function actor(userId: string): Actor {
  return { userId, requestIp: null, userAgent: 'sales-test' };
}

async function grant(
  db: ReturnType<typeof drizzle<typeof schema>>,
  tenant: string,
  userId: string,
  roleKey: string,
  grants: { scope: string; action: string; moduleId: string }[],
) {
  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    tenantId: tenant,
    key: roleKey,
    name: roleKey,
    description: 'Test role',
    mfaRequired: roleKey === 'tenant_owner' || roleKey === 'accountant',
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
  if (grants.length > 0) {
    await db.insert(rolePermissions).values(
      grants.map((entry) => ({
        tenantId: tenant,
        roleId,
        scope: entry.scope,
        modules: [entry.moduleId],
        action: entry.action,
        accessLabel: entry.action,
        approvalLimitCents: null,
      })),
    );
  }
}

describe('SAL-01 quotes and FIN-02 debtors', () => {
  const admin = () => drizzle(getAdminPool(), { schema });
  let customerA = '';
  let customerB = '';

  beforeAll(async () => {
    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: `sales-a-${tenantA.slice(0, 8)}`,
        displayName: 'Sales Isolation A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
        vatRateBasisPoints: 1500,
        vatNumber: '4991001991',
      },
      {
        id: tenantB,
        slug: `sales-b-${tenantB.slice(0, 8)}`,
        displayName: 'Sales Isolation B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
        vatRateBasisPoints: 1500,
        vatNumber: '4991001992',
      },
    ]);
    await grant(db, tenantA, owner, 'tenant_owner', [
      { scope: 'sal.pipeline', action: 'admin', moduleId: 'SAL-01' },
      { scope: 'fin.ledger', action: 'admin', moduleId: 'FIN-02' },
      { scope: 'scm.catalog', action: 'admin', moduleId: 'SCM-01' },
      { scope: 'krn', action: 'admin', moduleId: 'KRN-04' },
    ]);
    await grant(db, tenantA, cashier, 'sales_cashier', [
      { scope: 'sal.pipeline', action: 'read', moduleId: 'SAL-01' },
      { scope: 'sal.pipeline', action: 'operate', moduleId: 'SAL-01' },
      { scope: 'fin.ledger', action: 'read', moduleId: 'FIN-02' },
    ]);
    await grant(db, tenantA, accountant, 'accountant', [
      { scope: 'sal.pipeline', action: 'read', moduleId: 'SAL-01' },
      { scope: 'fin.ledger', action: 'read', moduleId: 'FIN-02' },
      { scope: 'fin.ledger', action: 'post', moduleId: 'FIN-02' },
    ]);
    const pool = getAdminPool();
    for (const tenant of [tenantA, tenantB]) {
      for (const moduleId of ['SAL-01', 'FIN-02', 'SCM-01', 'KRN-02', 'KRN-04']) {
        await pool.query(
          `INSERT INTO tenant_modules (tenant_id, module_id, active) VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, module_id) DO UPDATE SET active = true`,
          [tenant, moduleId],
        );
      }
    }
    customerA = randomUUID();
    customerB = randomUUID();
    await pool.query(
      `INSERT INTO parties (id, tenant_id, kind, display_name, popia_consent, status)
       VALUES ($1, $2, 'organisation', 'Cedar Test Grocers', false, 'active'),
              ($3, $4, 'organisation', 'Other Tenant Shop', false, 'active')`,
      [customerA, tenantA, customerB, tenantB],
    );
    await pool.query(
      `INSERT INTO party_roles (tenant_id, party_id, role) VALUES ($1, $2, 'customer'), ($3, $4, 'customer')`,
      [tenantA, customerA, tenantB, customerB],
    );
    await pool.query(
      `INSERT INTO party_addresses (tenant_id, party_id, kind, line1, city, country, is_primary)
       VALUES ($1, $2, 'billing', '1 Test Street', 'Cape Town', 'ZA', true)`,
      [tenantA, customerA],
    );
  });

  afterAll(async () => {
    const pool = getAdminPool();
    const tables = [
      'o2c_reminders',
      'o2c_stock_links',
      'o2c_allocations',
      'o2c_payments',
      'o2c_lines',
      'o2c_documents',
      'o2c_customer_terms',
      'o2c_sequences',
      'o2c_settings',
    ];
    for (const table of tables) {
      await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    try {
      const ids = [tenantA, tenantB];
      for (const table of tables) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
      }
      await pool.query('DELETE FROM party_addresses WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM party_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM parties WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [owner, cashier, accountant],
      ]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      for (const table of tables) {
        await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await closePools();
    }
  });

  it('numbers invoices per tenant and does not reuse a rolled-back number', async () => {
    const first = await withTenant(tenantId(tenantA), (tx) => nextDocumentNumber(tx, 'invoice'));
    const second = await withTenant(tenantId(tenantA), (tx) => nextDocumentNumber(tx, 'invoice'));
    const other = await withTenant(tenantId(tenantB), (tx) => nextDocumentNumber(tx, 'invoice'));
    expect(first).toMatch(/^INV-\d{4}-00001$/);
    expect(second).toMatch(/^INV-\d{4}-00002$/);
    expect(other).toMatch(/^INV-\d{4}-00001$/);

    const year = first.slice(4, 8);
    await expect(
      withTenant(tenantId(tenantA), async (tx) => {
        await nextDocumentNumber(tx, 'invoice');
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const again = await withTenant(tenantId(tenantA), (tx) => nextDocumentNumber(tx, 'invoice'));
    expect(again).toBe(`INV-${year}-00003`);
  });

  it('charges 15% VAT on the discounted net and keeps an issued invoice fixed', async () => {
    const draft = await withTenant(tenantId(tenantA), (tx) =>
      saveInvoice(tx, actor(accountant), null, {
        customerId: customerA,
        notes: '',
        dueOn: null,
        lines: [
          {
            itemId: null,
            description: 'Odd cents',
            quantity: '1',
            unitPrice: '0.10',
            discount: '',
          },
        ],
      }),
    );
    expect(draft.vat.cents).toBe('2');
    expect(draft.total.cents).toBe('12');
    expect(draft.number).toBeNull();

    const issued = await withTenant(tenantId(tenantA), (tx) =>
      issueInvoice(tx, actor(accountant), draft.id, false),
    );
    expect(issued.number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(issued.statusLabel).toBe('Unpaid');
    await expect(
      withTenant(tenantId(tenantA), (tx) =>
        saveInvoice(tx, actor(accountant), issued.id, {
          customerId: customerA,
          notes: 'changed',
          dueOn: null,
          lines: [
            {
              itemId: null,
              description: 'Changed',
              quantity: '2',
              unitPrice: '1.00',
              discount: '',
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(SalesError);
  });

  it('allocates a partial receipt across invoices and refuses an over-allocation', async () => {
    const first = await withTenant(tenantId(tenantA), async (tx) => {
      const saved = await saveInvoice(tx, actor(accountant), null, {
        customerId: customerA,
        notes: '',
        dueOn: null,
        lines: [
          { itemId: null, description: 'First', quantity: '1', unitPrice: '100.00', discount: '' },
        ],
      });
      return issueInvoice(tx, actor(accountant), saved.id, false);
    });
    const second = await withTenant(tenantId(tenantA), async (tx) => {
      const saved = await saveInvoice(tx, actor(accountant), null, {
        customerId: customerA,
        notes: '',
        dueOn: null,
        lines: [
          { itemId: null, description: 'Second', quantity: '1', unitPrice: '40.00', discount: '' },
        ],
      });
      return issueInvoice(tx, actor(accountant), saved.id, false);
    });

    await expect(
      withTenant(tenantId(tenantA), (tx) =>
        recordPayment(tx, actor(cashier), {
          customerId: customerA,
          paidOn: '2026-11-19',
          amount: '10.00',
          method: 'cash',
          reference: '',
          allocations: [{ invoiceId: first.id, amount: '10.00' }],
        }),
      ),
    ).rejects.toBeInstanceOf(SalesError);

    await withTenant(tenantId(tenantA), (tx) =>
      recordPayment(tx, actor(accountant), {
        customerId: customerA,
        paidOn: '2026-11-19',
        amount: '50.00',
        method: 'eft',
        reference: 'TEST-50',
        allocations: [
          { invoiceId: first.id, amount: '20.00' },
          { invoiceId: second.id, amount: '30.00' },
        ],
      }),
    );

    const balances = await withTenant(tenantId(tenantA), async (tx) => ({
      first: await invoiceBalance(tx, first.id),
      second: await invoiceBalance(tx, second.id),
    }));
    expect(balances.first.balance).toBe(9500n);
    expect(balances.second.balance).toBe(1600n);

    await expect(
      withTenant(tenantId(tenantA), (tx) =>
        recordPayment(tx, actor(accountant), {
          customerId: customerA,
          paidOn: '2026-11-19',
          amount: '20.00',
          method: 'card',
          reference: '',
          allocations: [{ invoiceId: second.id, amount: '20.00' }],
        }),
      ),
    ).rejects.toThrow(/only has/);
  });

  it('hides documents from the other tenant and from an unscoped query', async () => {
    const quote = await withTenant(tenantId(tenantA), (tx) =>
      saveQuote(tx, actor(cashier), null, {
        customerId: customerA,
        notes: 'Visible to A',
        validUntil: null,
        lines: [
          {
            itemId: null,
            description: 'Secret line',
            quantity: '1',
            unitPrice: '5.00',
            discount: '',
          },
        ],
      }),
    );
    await withTenant(tenantId(tenantA), (tx) =>
      setQuoteStatus(tx, actor(cashier), quote.id, 'sent'),
    );
    await withTenant(tenantId(tenantA), (tx) =>
      setQuoteStatus(tx, actor(cashier), quote.id, 'accepted'),
    );
    const invoice = await withTenant(tenantId(tenantA), (tx) =>
      convertQuote(tx, actor(owner), quote.id, false),
    );
    expect(invoice.kind).toBe('invoice');
    expect(invoice.number).toMatch(/^INV-/);

    const seenByB = await withTenant(tenantId(tenantB), (tx) =>
      tx.db.execute(sql`SELECT id FROM o2c_documents WHERE id = ${quote.id}`),
    );
    expect(seenByB.rows).toEqual([]);

    const unscoped = await getAppPool().query('SELECT id FROM o2c_documents');
    expect(unscoped.rowCount).toBe(0);

    await expect(
      withTenant(tenantId(tenantA), (tx) =>
        tx.db.execute(sql`DELETE FROM o2c_documents WHERE id = ${invoice.id}`),
      ),
    ).rejects.toSatisfy((error: unknown) =>
      /not deleted|cannot be changed|Sales records|permission denied/i.test(errorText(error)),
    );
  });
});
