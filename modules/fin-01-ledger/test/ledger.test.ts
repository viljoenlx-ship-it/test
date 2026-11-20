import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closePools,
  getAdminPool,
  memberships,
  rolePermissions,
  roles,
  schema,
  userRoles,
  users,
} from '@omnivate/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { issueCreditNote, issueInvoice, saveInvoice } from '@omnivate/module-o2c';
import { adjustStock, listBranches, receiveStock, saveItem } from '@omnivate/module-scm-01';
import { recordPayment } from '@omnivate/module-o2c';
import { accountLedger, trialBalance } from '../src/reports';
import { postJournal } from '../src/journals';
import { listAccounts } from '../src/accounts';
import { syncBooks } from '../src/postings';
import {
  openingCustomersTarget,
  openingTrialTarget,
} from '../../krn-06-migration/src/targets/opening';
import { LedgerError } from '../src/errors';

const tenantA = randomUUID();
const tenantB = randomUUID();
const owner = randomUUID();

function actor(userId = owner) {
  return { userId, requestIp: null, userAgent: 'ledger-test' };
}

async function linesFor(sourceKey: string) {
  return withTenant(tenantId(tenantA), async (tx) => {
    const result = await tx.db.execute<{
      system_key: string | null;
      debit_cents: string;
      credit_cents: string;
    }>(sql`
      SELECT a.system_key, l.debit_cents::text AS debit_cents, l.credit_cents::text AS credit_cents
      FROM fin01_journal_lines AS l
      JOIN fin01_accounts AS a ON a.id = l.account_id
      JOIN fin01_journals AS j ON j.id = l.journal_id
      WHERE j.source_key = ${sourceKey}
    `);
    return result.rows;
  });
}

function side(
  rows: { system_key: string | null; debit_cents: string; credit_cents: string }[],
  key: string,
) {
  const matches = rows.filter((row) => row.system_key === key);
  const debit = matches.reduce((sum, row) => sum + BigInt(row.debit_cents), 0n);
  const credit = matches.reduce((sum, row) => sum + BigInt(row.credit_cents), 0n);
  return { debit, credit };
}

describe('FIN-01 ledger', () => {
  let customer = '';
  let stockItem = '';
  let supplier = '';
  let branchId = '';

  beforeAll(async () => {
    const db = drizzle(getAdminPool(), { schema });
    await db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: `books-a-${tenantA.slice(0, 8)}`,
        displayName: 'Fictional Books A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
        vatRateBasisPoints: 1500,
      },
      {
        id: tenantB,
        slug: `books-b-${tenantB.slice(0, 8)}`,
        displayName: 'Fictional Books B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
        vatRateBasisPoints: 1500,
      },
    ]);
    const roleId = randomUUID();
    await db.insert(roles).values({
      id: roleId,
      tenantId: tenantA,
      key: 'tenant_owner',
      name: 'Owner',
      description: 'Test',
      mfaRequired: true,
      isSystem: true,
    });
    await db.insert(users).values({
      id: owner,
      email: `${owner}@example.com`,
      displayName: 'Ledger Owner',
      passwordHash: 'x',
      status: 'active',
      totpEnabled: false,
    });
    await db.insert(memberships).values({ tenantId: tenantA, userId: owner, status: 'active' });
    await db.insert(userRoles).values({ tenantId: tenantA, userId: owner, roleId });
    await db.insert(rolePermissions).values(
      ['fin.ledger', 'sal.pipeline', 'scm.catalog', 'krn'].map((scope) => ({
        tenantId: tenantA,
        roleId,
        scope,
        modules:
          scope === 'fin.ledger'
            ? ['FIN-01', 'FIN-02']
            : scope === 'sal.pipeline'
              ? ['SAL-01']
              : scope === 'scm.catalog'
                ? ['SCM-01']
                : ['KRN-02', 'KRN-06'],
        action: 'admin',
        accessLabel: 'admin',
        approvalLimitCents: null,
      })),
    );
    const pool = getAdminPool();
    for (const moduleId of ['KRN-01', 'KRN-02', 'KRN-03', 'FIN-01', 'FIN-02', 'SAL-01', 'SCM-01']) {
      await pool.query(
        `INSERT INTO tenant_modules (tenant_id, module_id, active) VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, module_id) DO UPDATE SET active = true`,
        [tenantA, moduleId],
      );
    }
    customer = randomUUID();
    supplier = randomUUID();
    await pool.query(
      `INSERT INTO parties (id, tenant_id, kind, display_name, popia_consent, status)
       VALUES ($1, $2, 'organisation', 'Cedar Test Grocers', false, 'active'),
              ($3, $2, 'organisation', 'Fictional Mill', false, 'active')`,
      [customer, tenantA, supplier],
    );
    await pool.query(
      `INSERT INTO party_roles (tenant_id, party_id, role)
       VALUES ($1, $2, 'customer'), ($1, $3, 'supplier')`,
      [tenantA, customer, supplier],
    );
    await pool.query(
      `INSERT INTO party_addresses (tenant_id, party_id, kind, line1, city, country, is_primary)
       VALUES ($1, $2, 'billing', '1 Test Street', 'Cape Town', 'ZA', true)`,
      [tenantA, customer],
    );
    const branches = await withTenant(tenantId(tenantA), (tx) => listBranches(tx, actor()));
    branchId = branches.branches[0]?.id ?? '';
    const item = await withTenant(tenantId(tenantA), (tx) =>
      saveItem(tx, actor(), null, {
        kind: 'stock',
        sku: 'PINE-1',
        barcode: '6001234567890',
        name: 'Treated pine',
        description: '',
        category: '',
        baseUom: 'each',
        baseUomPlural: 'each',
        cost: '40.00',
        sellingPrice: '100.00',
        reorderLevel: '0',
        trackBatches: false,
        trackSerials: false,
        uoms: [],
      }),
    );
    stockItem = item.id;
    await withTenant(tenantId(tenantA), (tx) =>
      receiveStock(tx, actor(), {
        itemId: stockItem,
        branchId,
        quantity: '10',
        uomName: 'each',
        unitCost: '40.00',
        reason: 'Opening shelf',
      }),
    );
  });

  afterAll(async () => {
    const pool = getAdminPool();
    const ids = [tenantA, tenantB];
    const userTriggers = [
      'fin01_journal_lines',
      'fin01_journals',
      'fin01_cost_snapshots',
      'o2c_documents',
      'o2c_lines',
      'o2c_payments',
      'o2c_allocations',
      'o2c_stock_links',
      'scm01_items',
      'scm01_movements',
      'scm01_pending_postings',
      'audit_events',
      'tenant_modules',
    ];
    for (const table of userTriggers) {
      await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    try {
      await pool.query(
        `UPDATE fin01_journals SET reverses_journal_id = NULL WHERE tenant_id = ANY($1::uuid[])`,
        [ids],
      );
      const deletes = [
        'fin01_journal_lines',
        'fin01_journals',
        'fin01_cost_snapshots',
        'fin01_party_codes',
        'fin01_sequences',
        'fin01_accounts',
        'o2c_stock_links',
        'o2c_allocations',
        'o2c_payments',
        'o2c_lines',
        'o2c_documents',
        'o2c_customer_terms',
        'o2c_sequences',
        'o2c_settings',
        'scm01_movement_serials',
        'scm01_pending_postings',
        'scm01_movements',
        'scm01_balances',
        'scm01_batch_balances',
        'scm01_batches',
        'scm01_item_uoms',
        'scm01_items',
        'scm01_settings',
        'party_addresses',
        'party_channels',
        'party_contacts',
        'party_notes',
        'party_roles',
        'party_tags',
        'parties',
        'sod_rules',
        'audit_events',
        'tenant_modules',
        'user_roles',
        'role_permissions',
        'memberships',
        'krn03_branch_access',
        'krn03_current_branch',
        'krn03_branches',
        'krn03_entity_links',
        'krn03_legal_entities',
        'krn03_settings',
        'roles',
      ];
      for (const table of deletes) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
      }
      await pool.query('DELETE FROM users WHERE id = $1', [owner]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      for (const table of userTriggers) {
        await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await closePools();
    }
  });

  it('seeds a South African chart and refuses to switch off a control account', async () => {
    const accounts = await withTenant(tenantId(tenantA), (tx) => listAccounts(tx));
    const names = accounts.map((account) => account.name);
    for (const name of [
      'Bank',
      'Debtors Control',
      'Creditors Control',
      'Inventory',
      'VAT Input',
      'VAT Output',
      'Retained Earnings',
      'Opening Balance Equity',
    ]) {
      expect(names).toContain(name);
    }
    const bank = accounts.find((account) => account.name === 'Bank');
    expect(bank?.system).toBe(true);
    await expect(
      withTenant(tenantId(tenantA), (tx) =>
        tx.db
          .execute(
            sql`
          UPDATE fin01_accounts SET active = false WHERE system_key = 'debtors'
        `,
          )
          .then(() =>
            import('../src/accounts').then(({ updateAccount }) =>
              updateAccount(tx, actor(), bank?.id ?? '', {
                code: '1000',
                name: 'Bank',
                active: false,
              }),
            ),
          ),
      ),
    ).rejects.toThrow(/automatic postings/);
  });

  it('rejects a journal that does not balance, in the service and in the database', async () => {
    await expect(
      withTenant(tenantId(tenantA), async (tx) => {
        const accounts = await listAccounts(tx);
        const bank = accounts.find((account) => account.code === '1000');
        const sales = accounts.find((account) => account.code === '4000');
        return postJournal(tx, actor(), {
          date: '2026-03-01',
          memo: 'Unbalanced',
          source: 'manual',
          sourceKey: null,
          lines: [
            { accountId: bank?.id ?? '', debitCents: 1000n, creditCents: 0n },
            { accountId: sales?.id ?? '', debitCents: 0n, creditCents: 500n },
          ],
        });
      }),
    ).rejects.toBeInstanceOf(LedgerError);

    const accounts = await withTenant(tenantId(tenantA), (tx) => listAccounts(tx));
    const bank = accounts.find((account) => account.code === '1000');
    const admin = getAdminPool();
    const journalId = randomUUID();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO fin01_journals (id, tenant_id, number, journal_date, memo, source, status, posted_at)
         VALUES ($1, $2, 'JNL-TEST-1', '2026-03-01', 'Bad', 'manual', 'posted', now())`,
        [journalId, tenantA],
      );
      await client.query(
        `INSERT INTO fin01_journal_lines (tenant_id, journal_id, account_id, debit_cents, credit_cents)
         VALUES ($1, $2, $3, 100, 0)`,
        [tenantA, journalId, bank?.id],
      );
      await expect(client.query('COMMIT')).rejects.toThrow(/balance/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('posts a tax invoice, a credit note, and a payment, and keeps the books in balance', async () => {
    const invoice = await withTenant(tenantId(tenantA), (tx) =>
      saveInvoice(tx, actor(), null, {
        customerId: customer,
        notes: '',
        dueOn: '2026-04-01',
        lines: [
          {
            itemId: stockItem,
            description: 'Treated pine',
            quantity: '2',
            unitPrice: '100.00',
            discount: '',
          },
        ],
      }),
    );
    const issued = await withTenant(tenantId(tenantA), (tx) =>
      issueInvoice(tx, actor(), invoice.id, true),
    );
    const posted = await linesFor(`invoice:${issued.id}`);
    expect(side(posted, 'debtors').debit).toBe(23000n);
    expect(side(posted, 'sales').credit).toBe(20000n);
    expect(side(posted, 'vat_output').credit).toBe(3000n);
    expect(side(posted, 'cost_of_sales').debit).toBe(8000n);
    expect(side(posted, 'inventory').credit).toBe(8000n);
    const debits = posted.reduce((sum, row) => sum + BigInt(row.debit_cents), 0n);
    const credits = posted.reduce((sum, row) => sum + BigInt(row.credit_cents), 0n);
    expect(debits).toBe(credits);

    const lineId = issued.lines[0]?.id ?? '';
    const credit = await withTenant(tenantId(tenantA), (tx) =>
      issueCreditNote(tx, actor(), issued.id, [{ lineId, quantity: '2' }]),
    );
    const reversed = await linesFor(`credit:${credit.id}`);
    expect(side(reversed, 'debtors').credit).toBe(23000n);
    expect(side(reversed, 'sales').debit).toBe(20000n);
    expect(side(reversed, 'vat_output').debit).toBe(3000n);
    expect(side(reversed, 'inventory').debit).toBe(8000n);
    expect(side(reversed, 'cost_of_sales').credit).toBe(8000n);

    const second = await withTenant(tenantId(tenantA), async (tx) => {
      const draft = await saveInvoice(tx, actor(), null, {
        customerId: customer,
        notes: '',
        dueOn: '2026-05-01',
        lines: [
          {
            itemId: null,
            description: 'Site measure',
            quantity: '1',
            unitPrice: '50.00',
            discount: '',
          },
        ],
      });
      return issueInvoice(tx, actor(), draft.id, false);
    });
    await withTenant(tenantId(tenantA), (tx) =>
      recordPayment(tx, actor(), {
        customerId: customer,
        paidOn: '2026-05-02',
        amount: '57.50',
        method: 'eft',
        reference: 'EFT-19',
        allocations: [{ invoiceId: second.id, amount: '57.50' }],
      }),
    );
    const paymentRows = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ source_key: string }>(sql`
        SELECT source_key FROM fin01_journals WHERE source_key LIKE 'payment:%' AND memo LIKE '%EFT-19%'
      `);
      return result.rows;
    });
    expect(paymentRows).toHaveLength(1);
    const payment = await linesFor(paymentRows[0]?.source_key ?? '');
    expect(side(payment, 'bank').debit).toBe(5750n);
    expect(side(payment, 'debtors').credit).toBe(5750n);

    const report = await withTenant(tenantId(tenantA), (tx) =>
      trialBalance(tx, { from: '2026-03-01', to: '2026-05-31' }),
    );
    expect(report.balanced).toBe(true);
    expect(report.debit.cents).toBe(report.credit.cents);
  });

  it('posts stock receipts, opening stock, and adjustments to the right accounts', async () => {
    await withTenant(tenantId(tenantA), (tx) =>
      receiveStock(tx, actor(), {
        itemId: stockItem,
        branchId,
        quantity: '4',
        uomName: 'each',
        unitCost: '40.00',
        reason: 'Goods received',
        glPartyId: supplier,
      }),
    );
    const receipt = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ source_key: string }>(sql`
        SELECT j.source_key
        FROM fin01_journals AS j
        WHERE j.memo = 'Goods received'
        ORDER BY j.posted_at DESC
        LIMIT 1
      `);
      return result.rows[0]?.source_key ?? '';
    });
    const receiptLines = await linesFor(receipt);
    expect(side(receiptLines, 'inventory').debit).toBe(16000n);
    expect(side(receiptLines, 'creditors').credit).toBe(16000n);

    await withTenant(tenantId(tenantA), (tx) =>
      receiveStock(tx, actor(), {
        itemId: stockItem,
        branchId,
        quantity: '1',
        uomName: 'each',
        unitCost: '10.00',
        reason: 'No supplier yet',
      }),
    );
    const accrual = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ source_key: string }>(sql`
        SELECT source_key FROM fin01_journals WHERE memo = 'No supplier yet' LIMIT 1
      `);
      return linesFor(result.rows[0]?.source_key ?? '');
    });
    const accrualLines = await accrual;
    expect(side(accrualLines, 'grn_accrual').credit).toBe(1000n);

    await withTenant(tenantId(tenantA), (tx) =>
      adjustStock(tx, actor(), {
        itemId: stockItem,
        branchId,
        quantity: '1',
        uomName: 'each',
        direction: 'down',
        reason: 'Write off',
      }),
    );
    const adjustment = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ source_key: string }>(sql`
        SELECT source_key FROM fin01_journals WHERE memo = 'Write off' LIMIT 1
      `);
      return result.rows[0]?.source_key ?? '';
    });
    const adjustmentLines = await linesFor(adjustment);
    expect(side(adjustmentLines, 'stock_adjustments').debit).toBeGreaterThan(0n);
    expect(side(adjustmentLines, 'inventory').credit).toBe(
      side(adjustmentLines, 'stock_adjustments').debit,
    );
  });

  it('hides one company from another and refuses to edit a posted line', async () => {
    const seen = await withTenant(tenantId(tenantB), async (tx) => {
      const result = await tx.db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM fin01_journals`,
      );
      return result.rows[0]?.count;
    });
    expect(seen).toBe('0');

    const line = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ id: string }>(
        sql`SELECT id FROM fin01_journal_lines LIMIT 1`,
      );
      return result.rows[0]?.id ?? '';
    });
    await expect(
      getAdminPool().query(`UPDATE fin01_journal_lines SET memo = 'changed' WHERE id = $1`, [line]),
    ).rejects.toThrow(/cannot be changed/i);

    const ledger = await withTenant(tenantId(tenantA), async (tx) => {
      await syncBooks(tx, actor());
      const accounts = await listAccounts(tx);
      const sales = accounts.find((account) => account.code === '4000');
      return accountLedger(tx, sales?.id ?? '', { from: '2026-01-01', to: '2026-12-31' });
    });
    expect(ledger.lines.length).toBeGreaterThan(1);
  });

  it('imports an opening customer invoice onto debtors and opening balance equity', async () => {
    const target = openingCustomersTarget();
    const applied = await withTenant(tenantId(tenantA), (tx) =>
      target.createMany(
        tx,
        randomUUID(),
        [
          {
            id: randomUUID(),
            values: {
              code: 'CED-9',
              name: 'Cedar Opening',
              vat: '',
              email: '',
              phone: '',
              invoice_number: 'OLD-44',
              invoice_date: '28/02/2026',
              due_date: '31/03/2026',
              amount: '150.00',
            },
          },
        ],
        {
          vatTreatment: 'exclusive',
          vatRateBasisPoints: 1500,
          actor: { userId: owner, operatorId: null, requestIp: null, userAgent: 'ledger-test' },
        },
      ),
    );
    const posted = await linesFor(`opening-invoice:${applied[0]?.recordId}`);
    expect(side(posted, 'debtors').debit).toBe(15000n);
    expect(side(posted, 'opening_equity').credit).toBe(15000n);
    const again = await withTenant(tenantId(tenantA), (tx) =>
      target.createMany(
        tx,
        randomUUID(),
        [
          {
            id: randomUUID(),
            values: {
              code: 'CED-9',
              name: 'Cedar Opening',
              vat: '',
              email: '',
              phone: '',
              invoice_number: 'OLD-44',
              invoice_date: '28/02/2026',
              due_date: '31/03/2026',
              amount: '150.00',
            },
          },
        ],
        {
          vatTreatment: 'exclusive',
          vatRateBasisPoints: 1500,
          actor: { userId: owner, operatorId: null, requestIp: null, userAgent: 'ledger-test' },
        },
      ),
    );
    expect(again[0]?.recordId).toBe(applied[0]?.recordId);
    const duplicates = await withTenant(tenantId(tenantA), async (tx) => {
      const result = await tx.db.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM fin01_journals WHERE source_key = ${`opening-invoice:${applied[0]?.recordId}`}
      `);
      return result.rows[0]?.count;
    });
    expect(duplicates).toBe('1');
  });
});

describe('opening import checks', () => {
  const trial = openingTrialTarget();
  const customers = openingCustomersTarget();

  it('flags a trial balance that does not balance, and accepts one that does', () => {
    expect(trial.validate({ code: '12', debit: '10.00', credit: '', as_at: '28/02/2026' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/3 to 8 digits/)]),
    );
    const unbalanced = trial.reviewBatch?.([
      {
        rowNumber: 2,
        invalid: false,
        values: { code: '1000', debit: '10.00', credit: '', as_at: '2026-02-28' },
      },
      {
        rowNumber: 3,
        invalid: false,
        values: { code: '2000', debit: '', credit: '4.00', as_at: '2026-02-28' },
      },
    ]);
    expect(unbalanced?.some((row) => /does not balance/.test(row.message))).toBe(true);
    const balanced = trial.reviewBatch?.([
      {
        rowNumber: 2,
        invalid: false,
        values: { code: '1000', debit: '10.00', credit: '', as_at: '2026-02-28' },
      },
      {
        rowNumber: 3,
        invalid: false,
        values: { code: '3000', debit: '', credit: '10.00', as_at: '2026-02-28' },
      },
    ]);
    expect(balanced).toEqual([]);
  });

  it('flags a customer row that is missing a date, before anything is saved', () => {
    const messages = customers.validate({
      code: 'CED-1',
      name: 'Cedar Test Grocers',
      vat: '',
      email: '',
      phone: '',
      invoice_number: 'OLD-1',
      invoice_date: '',
      due_date: '',
      amount: '150.00',
    });
    expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/invoice date/i)]));
    expect(
      customers.validate({
        code: 'CED-1',
        name: 'C',
        vat: '123',
        email: 'not-an-email',
        phone: '',
        invoice_number: '',
        invoice_date: '',
        due_date: '',
        amount: '',
      }).length,
    ).toBeGreaterThan(0);
  });
});
