import { sql } from 'drizzle-orm';
import { activeModuleSet, type TenantTransaction } from '@omnivate/kernel';
import { formatZar, money } from '@omnivate/shared';
import { LedgerError } from './errors';
import { asBigint, audit, one, many, type LedgerActor } from './rows';

export const ACCOUNT_CATEGORIES = [
  'asset',
  'liability',
  'equity',
  'income',
  'cost_of_sales',
  'expense',
] as const;

export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AccountCategory, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  cost_of_sales: 'Cost Of Sales',
  expense: 'Expense',
};

type SystemAccount = {
  code: string;
  name: string;
  category: AccountCategory;
  systemKey: string;
};

/** South African SME chart. System accounts are the ones automatic postings use. */
export const DEFAULT_ACCOUNTS: readonly SystemAccount[] = [
  { code: '1000', name: 'Bank', category: 'asset', systemKey: 'bank' },
  { code: '1100', name: 'Debtors Control', category: 'asset', systemKey: 'debtors' },
  { code: '1200', name: 'Inventory', category: 'asset', systemKey: 'inventory' },
  { code: '1300', name: 'VAT Input', category: 'asset', systemKey: 'vat_input' },
  { code: '2000', name: 'Creditors Control', category: 'liability', systemKey: 'creditors' },
  { code: '2100', name: 'VAT Output', category: 'liability', systemKey: 'vat_output' },
  {
    code: '2200',
    name: 'Goods Received Not Invoiced',
    category: 'liability',
    systemKey: 'grn_accrual',
  },
  { code: '3000', name: 'Opening Balance Equity', category: 'equity', systemKey: 'opening_equity' },
  { code: '3100', name: 'Retained Earnings', category: 'equity', systemKey: 'retained_earnings' },
  { code: '4000', name: 'Sales', category: 'income', systemKey: 'sales' },
  { code: '5000', name: 'Cost Of Sales', category: 'cost_of_sales', systemKey: 'cost_of_sales' },
  { code: '6000', name: 'Rent', category: 'expense', systemKey: '' },
  { code: '6100', name: 'Stock Adjustments', category: 'expense', systemKey: 'stock_adjustments' },
  { code: '6200', name: 'Wages', category: 'expense', systemKey: '' },
  { code: '6300', name: 'Telephone', category: 'expense', systemKey: '' },
  { code: '6400', name: 'Bank Charges', category: 'expense', systemKey: '' },
  { code: '6500', name: 'General Expenses', category: 'expense', systemKey: '' },
];

const EXTRA_KEYS = new Set(
  DEFAULT_ACCOUNTS.map((account) => account.systemKey).filter((key) => key !== ''),
);

export async function ledgerIsOn(tx: TenantTransaction): Promise<boolean> {
  const active = await activeModuleSet(tx);
  return active.has('FIN-01');
}

export async function ensureChart(tx: TenantTransaction): Promise<void> {
  for (const account of DEFAULT_ACCOUNTS) {
    const systemKey = account.systemKey === '' ? null : account.systemKey;
    await tx.db.execute(sql`
      INSERT INTO fin01_accounts (tenant_id, code, name, category, system_key)
      VALUES (
        ${tx.tenantId},
        ${account.code},
        ${account.name},
        ${account.category},
        ${systemKey}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

export async function accountByKey(tx: TenantTransaction, systemKey: string): Promise<string> {
  if (!EXTRA_KEYS.has(systemKey)) {
    throw new LedgerError('That account is not part of the chart.');
  }
  await ensureChart(tx);
  const row = await one<{ id: string }>(
    tx,
    sql`SELECT id FROM fin01_accounts WHERE system_key = ${systemKey} AND active = true`,
  );
  if (!row) {
    throw new LedgerError('An account used by automatic postings is switched off.');
  }
  return row.id;
}

export type AccountView = {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  categoryLabel: string;
  system: boolean;
  active: boolean;
  balance: { cents: string; label: string };
};

function isCategory(value: string): value is AccountCategory {
  return (ACCOUNT_CATEGORIES as readonly string[]).includes(value);
}

export async function listAccounts(tx: TenantTransaction): Promise<AccountView[]> {
  await ensureChart(tx);
  const rows = await many<{
    id: string;
    code: string;
    name: string;
    category: string;
    system_key: string | null;
    active: boolean;
    debit: unknown;
    credit: unknown;
  }>(
    tx,
    sql`
      SELECT
        a.id, a.code, a.name, a.category, a.system_key, a.active,
        COALESCE(SUM(l.debit_cents), 0) AS debit,
        COALESCE(SUM(l.credit_cents), 0) AS credit
      FROM fin01_accounts AS a
      LEFT JOIN fin01_journal_lines AS l ON l.account_id = a.id
      GROUP BY a.id
      ORDER BY a.code
    `,
  );
  return rows.map((row) => {
    const category = isCategory(row.category) ? row.category : 'expense';
    const net = asBigint(row.debit) - asBigint(row.credit);
    const side = net > 0n ? 'Dr' : 'Cr';
    const label =
      net === 0n ? formatZar(money(0n)) : `${formatZar(money(net > 0n ? net : -net))} ${side}`;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      system: row.system_key !== null,
      active: row.active,
      balance: { cents: net.toString(), label },
    };
  });
}

function cleanCode(value: string): string {
  const code = value.trim();
  if (!/^[0-9]{3,8}$/.test(code)) {
    throw new LedgerError('An account code is 3 to 8 digits.');
  }
  return code;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new LedgerError('Enter an account name.');
  }
  return name;
}

export async function createAccount(
  tx: TenantTransaction,
  actor: LedgerActor,
  input: { code: string; name: string; category: string },
): Promise<AccountView> {
  await ensureChart(tx);
  const code = cleanCode(input.code);
  const name = cleanName(input.name);
  if (!isCategory(input.category)) {
    throw new LedgerError('Choose a type of account.');
  }
  const taken = await one<{ id: string }>(
    tx,
    sql`SELECT id FROM fin01_accounts WHERE code = ${code}`,
  );
  if (taken) {
    throw new LedgerError('That account code is already used.');
  }
  const inserted = await one<{ id: string }>(
    tx,
    sql`
      INSERT INTO fin01_accounts (tenant_id, code, name, category)
      VALUES (${tx.tenantId}, ${code}, ${name}, ${input.category})
      RETURNING id
    `,
  );
  if (!inserted) {
    throw new LedgerError('The account was not saved.');
  }
  await audit(tx, actor, 'fin.account.created', 'fin_account', inserted.id, {
    code,
    name,
    category: input.category,
  });
  const accounts = await listAccounts(tx);
  const view = accounts.find((account) => account.id === inserted.id);
  if (!view) {
    throw new LedgerError('The account was not saved.');
  }
  return view;
}

export async function updateAccount(
  tx: TenantTransaction,
  actor: LedgerActor,
  id: string,
  input: { code: string; name: string; active: boolean },
): Promise<AccountView> {
  await ensureChart(tx);
  const current = await one<{ id: string; system_key: string | null; active: boolean }>(
    tx,
    sql`SELECT id, system_key, active FROM fin01_accounts WHERE id = ${id}`,
  );
  if (!current) {
    throw new LedgerError('That account was not found.', 404);
  }
  const code = cleanCode(input.code);
  const name = cleanName(input.name);
  if (!input.active && current.system_key) {
    throw new LedgerError('This account is used by automatic postings.');
  }
  const taken = await one<{ id: string }>(
    tx,
    sql`SELECT id FROM fin01_accounts WHERE code = ${code} AND id <> ${id}`,
  );
  if (taken) {
    throw new LedgerError('That account code is already used.');
  }
  await tx.db.execute(sql`
    UPDATE fin01_accounts
    SET code = ${code}, name = ${name}, active = ${input.active}, updated_at = now()
    WHERE id = ${id}
  `);
  await audit(tx, actor, 'fin.account.updated', 'fin_account', id, {
    code,
    name,
    active: input.active,
  });
  const accounts = await listAccounts(tx);
  const view = accounts.find((account) => account.id === id);
  if (!view) {
    throw new LedgerError('That account was not found.', 404);
  }
  return view;
}
