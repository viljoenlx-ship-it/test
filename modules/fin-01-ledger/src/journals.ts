import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { formatZar, johannesburgToday, johannesburgYear, money } from '@omnivate/shared';
import { ensureChart } from './accounts';
import { LedgerError } from './errors';
import { asBigint, audit, many, one, uniqueViolation, type LedgerActor } from './rows';

export type JournalLineInput = {
  accountId: string;
  partyId?: string | null;
  debitCents: bigint;
  creditCents: bigint;
  memo?: string;
};

export type PostJournalInput = {
  date: string;
  memo: string;
  source: 'manual' | 'invoice' | 'credit_note' | 'payment' | 'stock' | 'opening' | 'trial';
  sourceKey: string | null;
  reversesId?: string | null;
  lines: JournalLineInput[];
};

function asDate(value: string): string {
  const text = value.trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new LedgerError('Enter the journal date.');
  }
  return text;
}

function cleanMemo(value: string): string {
  const memo = value.trim();
  if (memo.length > 200) {
    throw new LedgerError('Shorten the memo.');
  }
  return memo;
}

async function nextNumber(tx: TenantTransaction, date: string): Promise<string> {
  const year = johannesburgYear(new Date(`${date}T12:00:00Z`));
  const row = await one<{ last_number: number }>(
    tx,
    sql`
      INSERT INTO fin01_sequences (tenant_id, year, last_number)
      VALUES (${tx.tenantId}, ${year}, 1)
      ON CONFLICT (tenant_id, year)
      DO UPDATE SET last_number = fin01_sequences.last_number + 1
      RETURNING last_number
    `,
  );
  if (!row) {
    throw new LedgerError('Could not allocate a journal number.');
  }
  return `JNL-${year.toString()}-${row.last_number.toString().padStart(5, '0')}`;
}

/**
 * Insert one balanced posted journal.
 * A repeated source key is ignored so automatic postings can be retried.
 */
export async function postJournal(
  tx: TenantTransaction,
  actor: LedgerActor,
  input: PostJournalInput,
): Promise<string | null> {
  await ensureChart(tx);
  const date = asDate(input.date);
  const memo = cleanMemo(input.memo);
  if (input.sourceKey) {
    const existing = await one<{ id: string }>(
      tx,
      sql`SELECT id FROM fin01_journals WHERE source_key = ${input.sourceKey}`,
    );
    if (existing) {
      return null;
    }
  }
  const lines = input.lines.filter((line) => line.debitCents > 0n || line.creditCents > 0n);
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.debitCents < 0n || line.creditCents < 0n) {
      throw new LedgerError('An amount cannot be negative.');
    }
    if (line.debitCents > 0n && line.creditCents > 0n) {
      throw new LedgerError('A line is either a debit or a credit.');
    }
    if (line.debitCents === 0n && line.creditCents === 0n) {
      throw new LedgerError('Enter an amount on each line.');
    }
    debits += line.debitCents;
    credits += line.creditCents;
  }
  if (lines.length < 2 || debits !== credits || debits <= 0n) {
    throw new LedgerError('A journal must balance, with the same total on both sides.');
  }
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await many<{ id: string; active: boolean }>(
    tx,
    sql`SELECT id, active FROM fin01_accounts WHERE id IN (${sql.join(
      accountIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  if (accounts.length !== accountIds.length || accounts.some((account) => !account.active)) {
    throw new LedgerError('Choose an active account on every line.');
  }
  const id = randomUUID();
  const number = await nextNumber(tx, date);
  try {
    await tx.db.execute(sql`
      INSERT INTO fin01_journals (
        id, tenant_id, number, journal_date, memo, source, source_key, status,
        reverses_journal_id, posted_by, posted_at
      ) VALUES (
        ${id}, ${tx.tenantId}, ${number}, ${date}::date, ${memo}, ${input.source},
        ${input.sourceKey}, 'posted', ${input.reversesId ?? null}, ${actor.userId}, now()
      )
    `);
  } catch (error) {
    if (uniqueViolation(error)) {
      return null;
    }
    throw error;
  }
  for (const line of lines) {
    await tx.db.execute(sql`
      INSERT INTO fin01_journal_lines (
        tenant_id, journal_id, account_id, party_id, debit_cents, credit_cents, memo
      ) VALUES (
        ${tx.tenantId}, ${id}, ${line.accountId}, ${line.partyId ?? null},
        ${line.debitCents}, ${line.creditCents}, ${cleanMemo(line.memo ?? '')}
      )
    `);
  }
  await audit(tx, actor, 'fin.journal.posted', 'fin_journal', id, {
    number,
    source: input.source,
    sourceKey: input.sourceKey,
    debitCents: debits.toString(),
  });
  return id;
}

export async function reverseJournal(
  tx: TenantTransaction,
  actor: LedgerActor,
  journalId: string,
): Promise<string | null> {
  const journal = await one<{
    id: string;
    number: string;
    journal_date: string;
    memo: string;
  }>(
    tx,
    sql`
      SELECT id, number, journal_date::text AS journal_date, memo
      FROM fin01_journals
      WHERE id = ${journalId}
    `,
  );
  if (!journal) {
    throw new LedgerError('That journal was not found.', 404);
  }
  const lines = await many<{
    account_id: string;
    party_id: string | null;
    debit_cents: unknown;
    credit_cents: unknown;
    memo: string;
  }>(
    tx,
    sql`
      SELECT account_id, party_id, debit_cents, credit_cents, memo
      FROM fin01_journal_lines
      WHERE journal_id = ${journalId}
    `,
  );
  return postJournal(tx, actor, {
    date: journal.journal_date,
    memo: `Reversal of ${journal.number}`,
    source: 'manual',
    sourceKey: `reversal:${journal.id}`,
    reversesId: journal.id,
    lines: lines.map((line) => ({
      accountId: line.account_id,
      partyId: line.party_id,
      debitCents: asBigint(line.credit_cents),
      creditCents: asBigint(line.debit_cents),
      memo: line.memo,
    })),
  });
}

export type JournalView = {
  id: string;
  number: string;
  date: string;
  memo: string;
  source: string;
  total: { cents: string; label: string };
  reverses: boolean;
};

export async function listJournals(tx: TenantTransaction): Promise<JournalView[]> {
  const rows = await many<{
    id: string;
    number: string;
    journal_date: string;
    memo: string;
    source: string;
    reverses_journal_id: string | null;
    total: unknown;
  }>(
    tx,
    sql`
      SELECT
        j.id, j.number, j.journal_date::text AS journal_date, j.memo, j.source,
        j.reverses_journal_id, COALESCE(SUM(l.debit_cents), 0) AS total
      FROM fin01_journals AS j
      LEFT JOIN fin01_journal_lines AS l ON l.journal_id = j.id
      GROUP BY j.id
      ORDER BY j.journal_date DESC, j.number DESC
      LIMIT 200
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: row.journal_date,
    memo: row.memo,
    source: row.source,
    total: { cents: asBigint(row.total).toString(), label: formatZar(money(asBigint(row.total))) },
    reverses: row.reverses_journal_id !== null,
  }));
}

export function today(): string {
  return johannesburgToday();
}
