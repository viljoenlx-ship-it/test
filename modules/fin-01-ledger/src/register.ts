import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { tenantId, withTenant } from '@omnivate/kernel';
import { formatSaDate, zarFromDecimal } from '@omnivate/shared';
import { assertEdit, assertPost, assertRead, canEdit, canPost } from './access';
import { createAccount, listAccounts, updateAccount, type AccountCategory } from './accounts';
import { renderCsv, renderPdf, type TabularReport } from './export';
import { HttpError, readBody, readText, requireActor, route } from './http';
import { listJournals, postJournal, reverseJournal, type JournalLineInput } from './journals';
import { syncBooks } from './postings';
import {
  accountLedger,
  balanceSheet,
  defaultRange,
  incomeStatement,
  parseRange,
  trialBalance,
  vatSummary,
  type MoneyCell,
} from './reports';
import { one } from './rows';

function moneyText(value: MoneyCell | null | undefined): string {
  return value?.label ?? '';
}

function rangeOf(query: { from?: string; to?: string }, fallback: { from: string; to: string }) {
  const from = readText(query.from) || fallback.from;
  const to = readText(query.to) || fallback.to;
  return parseRange(from, to);
}

async function companyName(tx: Parameters<Parameters<typeof withTenant>[1]>[0]): Promise<string> {
  const row = await one<{ name: string }>(
    tx,
    sql`SELECT COALESCE(NULLIF(company_name, ''), display_name) AS name FROM tenants`,
  );
  return row?.name ?? 'Company';
}

function tableFor(kind: string, body: unknown): TabularReport {
  const report = body as {
    title: string;
    from: string;
    to: string;
    lines?: {
      code?: string;
      name?: string;
      memo?: string;
      number?: string;
      date?: string;
      debit?: MoneyCell | null;
      credit?: MoneyCell | null;
      balance?: MoneyCell;
      amount?: MoneyCell;
    }[];
    debit?: MoneyCell;
    credit?: MoneyCell;
    income?: { name: string; amount: MoneyCell }[];
    incomeTotal?: MoneyCell;
    costOfSales?: { name: string; amount: MoneyCell }[];
    costOfSalesTotal?: MoneyCell;
    grossProfit?: MoneyCell;
    expenses?: { name: string; amount: MoneyCell }[];
    expenseTotal?: MoneyCell;
    netProfit?: MoneyCell;
    assets?: { name: string; amount: MoneyCell }[];
    assetTotal?: MoneyCell;
    liabilities?: { name: string; amount: MoneyCell }[];
    liabilityTotal?: MoneyCell;
    equity?: { name: string; amount: MoneyCell }[];
    equityTotal?: MoneyCell;
    output?: MoneyCell;
    input?: MoneyCell;
    payable?: MoneyCell;
    closing?: MoneyCell;
  };
  if (kind === 'trial-balance') {
    return {
      title: report.title,
      from: report.from,
      to: report.to,
      headers: ['Code', 'Account', 'Debit', 'Credit'],
      rows: [
        ...(report.lines ?? []).map((line) => [
          line.code ?? '',
          line.name ?? '',
          moneyText(line.debit),
          moneyText(line.credit),
        ]),
        ['', 'Total', moneyText(report.debit), moneyText(report.credit)],
      ],
    };
  }
  if (kind === 'income-statement') {
    const rows: string[][] = [['Income', '']];
    for (const line of report.income ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Income Total', moneyText(report.incomeTotal)]);
    rows.push(['Cost Of Sales', '']);
    for (const line of report.costOfSales ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Cost Of Sales Total', moneyText(report.costOfSalesTotal)]);
    rows.push(['Gross Profit', moneyText(report.grossProfit)]);
    rows.push(['Expenses', '']);
    for (const line of report.expenses ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Expense Total', moneyText(report.expenseTotal)]);
    rows.push(['Net Profit', moneyText(report.netProfit)]);
    return {
      title: report.title,
      from: report.from,
      to: report.to,
      headers: ['Line', 'Amount'],
      rows,
    };
  }
  if (kind === 'balance-sheet') {
    const rows: string[][] = [['Assets', '']];
    for (const line of report.assets ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Total Assets', moneyText(report.assetTotal)]);
    rows.push(['Liabilities', '']);
    for (const line of report.liabilities ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Total Liabilities', moneyText(report.liabilityTotal)]);
    rows.push(['Equity', '']);
    for (const line of report.equity ?? []) rows.push([line.name, line.amount.label]);
    rows.push(['Total Equity', moneyText(report.equityTotal)]);
    return {
      title: report.title,
      from: report.from,
      to: report.to,
      headers: ['Line', 'Amount'],
      rows,
    };
  }
  if (kind === 'vat') {
    return {
      title: report.title,
      from: report.from,
      to: report.to,
      headers: ['Line', 'Amount'],
      rows: [
        ['Output VAT', moneyText(report.output)],
        ['Input VAT', moneyText(report.input)],
        ['VAT Payable', moneyText(report.payable)],
      ],
    };
  }
  return {
    title: report.title,
    from: report.from,
    to: report.to,
    headers: ['Date', 'Journal', 'Memo', 'Debit', 'Credit', 'Balance'],
    rows: (report.lines ?? []).map((line) => [
      line.date ? formatSaDate(line.date) : '',
      line.number ?? '',
      line.memo ?? '',
      moneyText(line.debit),
      moneyText(line.credit),
      moneyText(line.balance),
    ]),
  };
}

function journalLines(value: unknown): JournalLineInput[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new HttpError(400, 'bad_request', 'A journal needs at least two lines.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'bad_request', 'A line was not understood.');
    }
    const row = entry as Record<string, unknown>;
    const debitText = readText(row.debit);
    const creditText = readText(row.credit);
    let debit = 0n;
    let credit = 0n;
    try {
      if (debitText) debit = zarFromDecimal(debitText).amountCents;
      if (creditText) credit = zarFromDecimal(creditText).amountCents;
    } catch (error) {
      throw new HttpError(
        400,
        'bad_request',
        error instanceof Error ? error.message : 'Enter an amount such as 10.50.',
      );
    }
    return {
      accountId: readText(row.accountId),
      debitCents: debit,
      creditCents: credit,
      memo: readText(row.memo),
    };
  });
}

/** Registers the general ledger on the shared API. */
export async function registerFin01(app: FastifyInstance): Promise<void> {
  app.get(
    '/ledger/access',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertRead(tx, actor.userId);
        await syncBooks(tx, actor);
        const range = await defaultRange(tx);
        return {
          canEdit: await canEdit(tx, actor.userId),
          canPost: await canPost(tx, actor.userId),
          from: range.from,
          to: range.to,
        };
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/ledger/accounts',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const accounts = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertRead(tx, actor.userId);
        await syncBooks(tx, actor);
        return listAccounts(tx);
      });
      await reply.send({ accounts });
    }),
  );

  app.post(
    '/ledger/accounts',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = readBody(request);
      const account = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertEdit(tx, actor.userId);
        return createAccount(tx, actor, {
          code: readText(body.code),
          name: readText(body.name),
          category: readText(body.category) as AccountCategory,
        });
      });
      await reply.code(201).send(account);
    }),
  );

  app.patch(
    '/ledger/accounts/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = readBody(request);
      const account = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertEdit(tx, actor.userId);
        return updateAccount(tx, actor, id, {
          code: readText(body.code),
          name: readText(body.name),
          active: body.active !== false,
        });
      });
      await reply.send(account);
    }),
  );

  app.get(
    '/ledger/journals',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const journals = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertRead(tx, actor.userId);
        await syncBooks(tx, actor);
        return listJournals(tx);
      });
      await reply.send({ journals });
    }),
  );

  app.post(
    '/ledger/journals',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = readBody(request);
      const id = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertPost(tx, actor.userId);
        if (!readText(body.memo)) {
          throw new HttpError(400, 'bad_request', 'Enter a memo.');
        }
        return postJournal(tx, actor, {
          date: readText(body.date),
          memo: readText(body.memo),
          source: 'manual',
          sourceKey: null,
          lines: journalLines(body.lines),
        });
      });
      await reply.code(201).send({ id });
    }),
  );

  app.post(
    '/ledger/journals/:id/reverse',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const reversalId = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertPost(tx, actor.userId);
        return reverseJournal(tx, actor, id);
      });
      await reply.send({ id: reversalId });
    }),
  );

  app.get(
    '/ledger/reports/:kind',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { kind } = request.params as { kind: string };
      const query = request.query as { from?: string; to?: string; accountId?: string };
      const report = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertRead(tx, actor.userId);
        await syncBooks(tx, actor);
        const range = rangeOf(query, await defaultRange(tx));
        if (kind === 'trial-balance') return trialBalance(tx, range);
        if (kind === 'income-statement') return incomeStatement(tx, range);
        if (kind === 'balance-sheet') return balanceSheet(tx, range);
        if (kind === 'vat') return vatSummary(tx, range);
        if (kind === 'ledger') {
          const accountId = readText(query.accountId);
          if (!accountId) throw new HttpError(400, 'bad_request', 'Choose an account.');
          return accountLedger(tx, accountId, range);
        }
        throw new HttpError(404, 'not_found', 'That report was not found.');
      });
      await reply.send(report);
    }),
  );

  app.get(
    '/ledger/reports/:kind/export',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { kind } = request.params as { kind: string };
      const query = request.query as {
        from?: string;
        to?: string;
        accountId?: string;
        format?: string;
      };
      const format = query.format === 'pdf' ? 'pdf' : 'csv';
      const file = await withTenant(tenantId(actor.tenantId), async (tx) => {
        await assertRead(tx, actor.userId);
        await syncBooks(tx, actor);
        const range = rangeOf(query, await defaultRange(tx));
        const report =
          kind === 'trial-balance'
            ? await trialBalance(tx, range)
            : kind === 'income-statement'
              ? await incomeStatement(tx, range)
              : kind === 'balance-sheet'
                ? await balanceSheet(tx, range)
                : kind === 'vat'
                  ? await vatSummary(tx, range)
                  : kind === 'ledger'
                    ? await accountLedger(tx, readText(query.accountId), range)
                    : null;
        if (!report) throw new HttpError(404, 'not_found', 'That report was not found.');
        const table = tableFor(kind, report);
        return format === 'pdf' ? renderPdf(table, await companyName(tx)) : renderCsv(table);
      });
      await reply
        .header('content-type', file.contentType)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.body);
    }),
  );
}
