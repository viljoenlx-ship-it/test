import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { formatZar, johannesburgToday, money } from '@omnivate/shared';
import { CATEGORY_LABELS, type AccountCategory } from './accounts';
import { LedgerError } from './errors';
import { asBigint, many, one } from './rows';

export type MoneyCell = { cents: string; label: string };

export type ReportRange = { from: string; to: string };

function cell(cents: bigint): MoneyCell {
  return { cents: cents.toString(), label: formatZar(money(cents)) };
}

export function parseRange(from: string, to: string): ReportRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new LedgerError('Enter the start and end dates.');
  }
  if (from > to) {
    throw new LedgerError('The start date is after the end date.');
  }
  return { from, to };
}

export async function defaultRange(tx: TenantTransaction): Promise<ReportRange> {
  const row = await one<{ start_month: number }>(
    tx,
    sql`SELECT financial_year_start_month AS start_month FROM tenants`,
  );
  const startMonth =
    row?.start_month && row.start_month >= 1 && row.start_month <= 12 ? row.start_month : 3;
  const today = johannesburgToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const from = `${startYear.toString()}-${startMonth.toString().padStart(2, '0')}-01`;
  return { from, to: today };
}

type BalanceRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  system_key: string | null;
  debit: unknown;
  credit: unknown;
};

async function balances(
  tx: TenantTransaction,
  filter: { from: string | null; to: string },
): Promise<BalanceRow[]> {
  const fromClause = filter.from ? sql`AND j.journal_date >= ${filter.from}::date` : sql``;
  return many<BalanceRow>(
    tx,
    sql`
      SELECT
        a.id, a.code, a.name, a.category, a.system_key,
        COALESCE(SUM(l.debit_cents), 0) AS debit,
        COALESCE(SUM(l.credit_cents), 0) AS credit
      FROM fin01_accounts AS a
      LEFT JOIN fin01_journal_lines AS l ON l.account_id = a.id
        AND EXISTS (
          SELECT 1 FROM fin01_journals AS j
          WHERE j.id = l.journal_id
            AND j.journal_date <= ${filter.to}::date
            ${fromClause}
        )
      GROUP BY a.id
      ORDER BY a.code
    `,
  );
}

function netOf(row: BalanceRow): { debit: bigint; credit: bigint; net: bigint } {
  const debit = asBigint(row.debit);
  const credit = asBigint(row.credit);
  return { debit, credit, net: debit - credit };
}

export type TrialRow = {
  id: string;
  code: string;
  name: string;
  debit: MoneyCell | null;
  credit: MoneyCell | null;
};

export async function trialBalance(tx: TenantTransaction, range: ReportRange) {
  const rows = await balances(tx, { from: null, to: range.to });
  const lines: TrialRow[] = [];
  let debit = 0n;
  let credit = 0n;
  for (const row of rows) {
    const amounts = netOf(row);
    if (amounts.net === 0n) {
      continue;
    }
    const onDebit = amounts.net > 0n;
    const amount = onDebit ? amounts.net : -amounts.net;
    if (onDebit) {
      debit += amount;
    } else {
      credit += amount;
    }
    lines.push({
      id: row.id,
      code: row.code,
      name: row.name,
      debit: onDebit ? cell(amount) : null,
      credit: onDebit ? null : cell(amount),
    });
  }
  return {
    title: 'Trial Balance',
    from: range.from,
    to: range.to,
    lines,
    debit: cell(debit),
    credit: cell(credit),
    balanced: debit === credit,
  };
}

export type StatementRow = {
  id: string | null;
  name: string;
  amount: MoneyCell;
  emphasis?: boolean;
};

export async function incomeStatement(tx: TenantTransaction, range: ReportRange) {
  const rows = await balances(tx, { from: range.from, to: range.to });
  const income: StatementRow[] = [];
  const cos: StatementRow[] = [];
  const expenses: StatementRow[] = [];
  let incomeTotal = 0n;
  let cosTotal = 0n;
  let expenseTotal = 0n;
  for (const row of rows) {
    const amounts = netOf(row);
    if (row.category === 'income') {
      const amount = -amounts.net;
      if (amount === 0n) continue;
      incomeTotal += amount;
      income.push({ id: row.id, name: row.name, amount: cell(amount) });
    } else if (row.category === 'cost_of_sales') {
      const amount = amounts.net;
      if (amount === 0n) continue;
      cosTotal += amount;
      cos.push({ id: row.id, name: row.name, amount: cell(amount) });
    } else if (row.category === 'expense') {
      const amount = amounts.net;
      if (amount === 0n) continue;
      expenseTotal += amount;
      expenses.push({ id: row.id, name: row.name, amount: cell(amount) });
    }
  }
  const gross = incomeTotal - cosTotal;
  const net = gross - expenseTotal;
  return {
    title: 'Income Statement',
    from: range.from,
    to: range.to,
    income,
    incomeTotal: cell(incomeTotal),
    costOfSales: cos,
    costOfSalesTotal: cell(cosTotal),
    grossProfit: cell(gross),
    expenses,
    expenseTotal: cell(expenseTotal),
    netProfit: cell(net),
  };
}

export async function balanceSheet(tx: TenantTransaction, range: ReportRange) {
  const rows = await balances(tx, { from: null, to: range.to });
  const sections: Record<'asset' | 'liability' | 'equity', StatementRow[]> = {
    asset: [],
    liability: [],
    equity: [],
  };
  const totals = { asset: 0n, liability: 0n, equity: 0n, earnings: 0n };
  for (const row of rows) {
    const amounts = netOf(row);
    if (row.category === 'asset') {
      if (amounts.net === 0n) continue;
      totals.asset += amounts.net;
      sections.asset.push({ id: row.id, name: row.name, amount: cell(amounts.net) });
    } else if (row.category === 'liability') {
      const amount = -amounts.net;
      if (amount === 0n) continue;
      totals.liability += amount;
      sections.liability.push({ id: row.id, name: row.name, amount: cell(amount) });
    } else if (row.category === 'equity') {
      const amount = -amounts.net;
      if (amount === 0n) continue;
      totals.equity += amount;
      sections.equity.push({ id: row.id, name: row.name, amount: cell(amount) });
    } else if (row.category === 'income') {
      totals.earnings += -amounts.net;
    } else if (row.category === 'cost_of_sales' || row.category === 'expense') {
      totals.earnings -= amounts.net;
    }
  }
  if (totals.earnings !== 0n) {
    sections.equity.push({
      id: null,
      name: 'Current Earnings',
      amount: cell(totals.earnings),
    });
  }
  const equityAndEarnings = totals.equity + totals.earnings;
  return {
    title: 'Balance Sheet',
    from: range.from,
    to: range.to,
    assets: sections.asset,
    assetTotal: cell(totals.asset),
    liabilities: sections.liability,
    liabilityTotal: cell(totals.liability),
    equity: sections.equity,
    equityTotal: cell(equityAndEarnings),
    balanced: totals.asset === totals.liability + equityAndEarnings,
  };
}

export async function vatSummary(tx: TenantTransaction, range: ReportRange) {
  const rows = await balances(tx, { from: range.from, to: range.to });
  let output = 0n;
  let input = 0n;
  for (const row of rows) {
    const amounts = netOf(row);
    if (row.system_key === 'vat_output') {
      output += -amounts.net;
    }
    if (row.system_key === 'vat_input') {
      input += amounts.net;
    }
  }
  return {
    title: 'VAT Summary',
    from: range.from,
    to: range.to,
    output: cell(output),
    input: cell(input),
    payable: cell(output - input),
  };
}

export type LedgerLine = {
  id: string;
  date: string;
  number: string;
  memo: string;
  debit: MoneyCell | null;
  credit: MoneyCell | null;
  balance: MoneyCell;
};

export async function accountLedger(tx: TenantTransaction, accountId: string, range: ReportRange) {
  const account = await one<{ id: string; code: string; name: string; category: string }>(
    tx,
    sql`SELECT id, code, name, category FROM fin01_accounts WHERE id = ${accountId}`,
  );
  if (!account) {
    throw new LedgerError('That account was not found.', 404);
  }
  const brought = await one<{ debit: unknown; credit: unknown }>(
    tx,
    sql`
      SELECT COALESCE(SUM(l.debit_cents), 0) AS debit, COALESCE(SUM(l.credit_cents), 0) AS credit
      FROM fin01_journal_lines AS l
      JOIN fin01_journals AS j ON j.id = l.journal_id
      WHERE l.account_id = ${accountId} AND j.journal_date < ${range.from}::date
    `,
  );
  let running = asBigint(brought?.debit) - asBigint(brought?.credit);
  const rows = await many<{
    id: string;
    journal_date: string;
    number: string;
    memo: string;
    line_memo: string;
    debit_cents: unknown;
    credit_cents: unknown;
  }>(
    tx,
    sql`
      SELECT
        l.id, j.journal_date::text AS journal_date, j.number, j.memo, l.memo AS line_memo,
        l.debit_cents, l.credit_cents
      FROM fin01_journal_lines AS l
      JOIN fin01_journals AS j ON j.id = l.journal_id
      WHERE l.account_id = ${accountId}
        AND j.journal_date >= ${range.from}::date
        AND j.journal_date <= ${range.to}::date
      ORDER BY j.journal_date, j.number, l.id
    `,
  );
  const lines: LedgerLine[] = [
    {
      id: 'brought-forward',
      date: range.from,
      number: '',
      memo: 'Brought Forward',
      debit: null,
      credit: null,
      balance: cell(running),
    },
  ];
  for (const row of rows) {
    const debit = asBigint(row.debit_cents);
    const credit = asBigint(row.credit_cents);
    running += debit - credit;
    lines.push({
      id: row.id,
      date: row.journal_date,
      number: row.number,
      memo: row.line_memo || row.memo,
      debit: debit > 0n ? cell(debit) : null,
      credit: credit > 0n ? cell(credit) : null,
      balance: cell(running),
    });
  }
  const category = account.category as AccountCategory;
  return {
    title: `${account.code} ${account.name}`,
    accountId: account.id,
    code: account.code,
    name: account.name,
    categoryLabel: CATEGORY_LABELS[category] ?? account.category,
    from: range.from,
    to: range.to,
    lines,
    closing: cell(running),
  };
}
