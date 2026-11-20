import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { johannesburgToday, parseSalesQuantity } from '@omnivate/shared';
import { accountByKey, ensureChart, ledgerIsOn } from './accounts';
import { LedgerError } from './errors';
import { postJournal, type JournalLineInput } from './journals';
import { asBigint, extendAverageCost, many, one, type LedgerActor } from './rows';

type MoneyLine = {
  accountId: string;
  partyId?: string | null;
  debitCents: bigint;
  creditCents: bigint;
};

function pair(
  debitAccount: string,
  creditAccount: string,
  amount: bigint,
  partyOn: 'debit' | 'credit' | 'none',
  partyId: string | null,
): MoneyLine[] {
  if (amount <= 0n) {
    return [];
  }
  return [
    {
      accountId: debitAccount,
      partyId: partyOn === 'debit' ? partyId : null,
      debitCents: amount,
      creditCents: 0n,
    },
    {
      accountId: creditAccount,
      partyId: partyOn === 'credit' ? partyId : null,
      debitCents: 0n,
      creditCents: amount,
    },
  ];
}

type DocumentRow = {
  id: string;
  kind: string;
  origin: string;
  status: string;
  number: string | null;
  party_id: string;
  customer_name: string;
  issued_on: string | null;
  net_cents: unknown;
  vat_cents: unknown;
  total_cents: unknown;
  invoice_id: string | null;
};

type LineRow = {
  id: string;
  source_line_id: string | null;
  quantity: string;
  kind: string | null;
  cost_cents: unknown;
  movement_cost: unknown;
};

async function documentOf(tx: TenantTransaction, id: string): Promise<DocumentRow | null> {
  return one<DocumentRow>(
    tx,
    sql`
      SELECT
        id, kind, origin, status, number, party_id, customer_name,
        issued_on::text AS issued_on, net_cents, vat_cents, total_cents, invoice_id
      FROM o2c_documents
      WHERE id = ${id}
    `,
  );
}

async function linesOf(tx: TenantTransaction, documentId: string): Promise<LineRow[]> {
  return many<LineRow>(
    tx,
    sql`
      SELECT
        l.id, l.source_line_id, l.quantity::text AS quantity, i.kind,
        i.cost_cents, m.unit_cost_cents AS movement_cost
      FROM o2c_lines AS l
      LEFT JOIN scm01_items AS i ON i.id = l.item_id
      LEFT JOIN o2c_stock_links AS s ON s.line_id = l.id
      LEFT JOIN scm01_movements AS m ON m.id = s.movement_id
      WHERE l.document_id = ${documentId} AND l.archived_at IS NULL
      ORDER BY l.position
    `,
  );
}

async function rememberCost(
  tx: TenantTransaction,
  documentId: string,
  lineId: string,
  unitCostCents: bigint,
): Promise<void> {
  if (unitCostCents <= 0n) {
    return;
  }
  await tx.db.execute(sql`
    INSERT INTO fin01_cost_snapshots (tenant_id, line_id, document_id, unit_cost_cents)
    VALUES (${tx.tenantId}, ${lineId}, ${documentId}, ${unitCostCents})
    ON CONFLICT (tenant_id, line_id) DO NOTHING
  `);
}

async function snapshotCost(tx: TenantTransaction, lineId: string): Promise<bigint> {
  const row = await one<{ unit_cost_cents: unknown }>(
    tx,
    sql`SELECT unit_cost_cents FROM fin01_cost_snapshots WHERE line_id = ${lineId}`,
  );
  return row ? asBigint(row.unit_cost_cents) : 0n;
}

function unitCostOf(line: LineRow): bigint {
  if (line.kind !== 'stock') {
    return 0n;
  }
  const movement = line.movement_cost == null ? null : asBigint(line.movement_cost);
  if (movement !== null && movement > 0n) {
    return movement;
  }
  return asBigint(line.cost_cents);
}

/** Post a tax invoice, credit note, or opening document. Safe to call again. */
export async function postSalesDocument(
  tx: TenantTransaction,
  actor: LedgerActor,
  documentId: string,
): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    return;
  }
  const row = await documentOf(tx, documentId);
  if (!row || row.status !== 'issued' || !row.issued_on || !row.number) {
    return;
  }
  const debtors = await accountByKey(tx, 'debtors');
  const total = asBigint(row.total_cents);
  if (total <= 0n) {
    return;
  }
  if (row.kind === 'invoice' && row.origin === 'opening') {
    const equity = await accountByKey(tx, 'opening_equity');
    await postJournal(tx, actor, {
      date: row.issued_on,
      memo: `Opening balance ${row.number}`,
      source: 'opening',
      sourceKey: `opening-invoice:${row.id}`,
      lines: pair(debtors, equity, total, 'debit', row.party_id),
    });
    return;
  }
  if (row.kind === 'credit_note' && row.invoice_id) {
    const parent = await documentOf(tx, row.invoice_id);
    if (parent?.origin === 'opening') {
      const equity = await accountByKey(tx, 'opening_equity');
      await postJournal(tx, actor, {
        date: row.issued_on,
        memo: `Opening balance credit ${row.number}`,
        source: 'opening',
        sourceKey: `opening-credit:${row.id}`,
        lines: pair(equity, debtors, total, 'credit', row.party_id),
      });
      return;
    }
  }
  const sales = await accountByKey(tx, 'sales');
  const vat = await accountByKey(tx, 'vat_output');
  const cos = await accountByKey(tx, 'cost_of_sales');
  const inventory = await accountByKey(tx, 'inventory');
  const net = asBigint(row.net_cents);
  const tax = asBigint(row.vat_cents);
  const lines = await linesOf(tx, row.id);
  let cost = 0n;
  if (row.kind === 'invoice') {
    for (const line of lines) {
      const unit = unitCostOf(line);
      cost += extendAverageCost(parseSalesQuantity(line.quantity), unit);
      await rememberCost(tx, row.id, line.id, unit);
    }
    const posted: JournalLineInput[] = [
      { accountId: debtors, partyId: row.party_id, debitCents: total, creditCents: 0n },
    ];
    if (net > 0n) {
      posted.push({ accountId: sales, debitCents: 0n, creditCents: net });
    }
    if (tax > 0n) {
      posted.push({ accountId: vat, debitCents: 0n, creditCents: tax });
    }
    if (cost > 0n) {
      posted.push({ accountId: cos, debitCents: cost, creditCents: 0n });
      posted.push({ accountId: inventory, debitCents: 0n, creditCents: cost });
    }
    await postJournal(tx, actor, {
      date: row.issued_on,
      memo: `Tax invoice ${row.number} · ${row.customer_name}`,
      source: 'invoice',
      sourceKey: `invoice:${row.id}`,
      lines: posted,
    });
    return;
  }
  if (row.kind !== 'credit_note') {
    return;
  }
  for (const line of lines) {
    if (!line.source_line_id) {
      continue;
    }
    const unit = await snapshotCost(tx, line.source_line_id);
    cost += extendAverageCost(parseSalesQuantity(line.quantity), unit);
  }
  const posted: JournalLineInput[] = [
    { accountId: debtors, partyId: row.party_id, debitCents: 0n, creditCents: total },
  ];
  if (net > 0n) {
    posted.push({ accountId: sales, debitCents: net, creditCents: 0n });
  }
  if (tax > 0n) {
    posted.push({ accountId: vat, debitCents: tax, creditCents: 0n });
  }
  if (cost > 0n) {
    posted.push({ accountId: inventory, debitCents: cost, creditCents: 0n });
    posted.push({ accountId: cos, debitCents: 0n, creditCents: cost });
  }
  await postJournal(tx, actor, {
    date: row.issued_on,
    memo: `Credit note ${row.number} · ${row.customer_name}`,
    source: 'credit_note',
    sourceKey: `credit:${row.id}`,
    lines: posted,
  });
}

export async function postCustomerPayment(
  tx: TenantTransaction,
  actor: LedgerActor,
  paymentId: string,
): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    return;
  }
  const row = await one<{
    id: string;
    party_id: string;
    paid_on: string;
    amount_cents: unknown;
    reference: string;
  }>(
    tx,
    sql`
      SELECT id, party_id, paid_on::text AS paid_on, amount_cents, reference
      FROM o2c_payments
      WHERE id = ${paymentId}
    `,
  );
  if (!row) {
    return;
  }
  const amount = asBigint(row.amount_cents);
  const bank = await accountByKey(tx, 'bank');
  const debtors = await accountByKey(tx, 'debtors');
  const reference = row.reference.trim();
  await postJournal(tx, actor, {
    date: row.paid_on,
    memo: reference ? `Customer payment ${reference}` : 'Customer payment',
    source: 'payment',
    sourceKey: `payment:${row.id}`,
    lines: pair(bank, debtors, amount, 'credit', row.party_id),
  });
}

export type StockGlInput = {
  movementId: string;
  kind: string;
  journalKind: string;
  valueCents: bigint;
  reason: string;
  occurredAt: Date;
  glTreatment?: 'standard' | 'opening' | 'sale';
  partyId?: string | null;
  reversesMovementId?: string | null;
};

async function supplierFor(
  tx: TenantTransaction,
  movementId: string,
  reversesMovementId: string | null,
): Promise<string | null> {
  const row = await one<{ supplier_party_id: string | null }>(
    tx,
    sql`
      SELECT gr.supplier_party_id
      FROM scm01_goods_receipt_lines AS line
      JOIN scm01_goods_receipts AS gr ON gr.id = line.goods_receipt_id
      WHERE line.movement_id = ${movementId}
         OR (${reversesMovementId}::uuid IS NOT NULL AND line.movement_id = ${reversesMovementId}::uuid)
      LIMIT 1
    `,
  );
  return row?.supplier_party_id ?? null;
}

/** Post the general ledger side of a stock movement. Sale issues are left to the invoice. */
export async function postStockGl(
  tx: TenantTransaction,
  actor: LedgerActor,
  input: StockGlInput,
): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    return;
  }
  if (input.glTreatment === 'sale') {
    return;
  }
  if (
    input.journalKind === 'transfer_in' ||
    input.journalKind === 'transfer_out' ||
    input.kind === 'transfer_in' ||
    input.kind === 'transfer_out'
  ) {
    return;
  }
  const amount = input.valueCents < 0n ? -input.valueCents : input.valueCents;
  if (amount <= 0n) {
    return;
  }
  const inventory = await accountByKey(tx, 'inventory');
  const increase = input.valueCents > 0n;
  let counterKey = 'stock_adjustments';
  let partyId: string | null = null;
  let source: 'stock' | 'opening' = 'stock';
  if (input.glTreatment === 'opening') {
    counterKey = 'opening_equity';
    source = 'opening';
  } else if (input.journalKind === 'receipt' || input.kind === 'receipt') {
    partyId =
      input.partyId ?? (await supplierFor(tx, input.movementId, input.reversesMovementId ?? null));
    counterKey = partyId ? 'creditors' : 'grn_accrual';
  }
  const counter = await accountByKey(tx, counterKey);
  const debit = increase ? inventory : counter;
  const credit = increase ? counter : inventory;
  const partyOn = counterKey === 'creditors' ? (increase ? 'credit' : 'debit') : 'none';
  const reason = input.reason.trim();
  await postJournal(tx, actor, {
    date: johannesburgToday(input.occurredAt),
    memo: reason || 'Stock movement',
    source,
    sourceKey: `movement:${input.movementId}`,
    lines: pair(debit, credit, amount, partyOn === 'none' ? 'none' : partyOn, partyId),
  });
}

/** Fill journals for documents and stock that were saved before the ledger was switched on. */
export async function syncBooks(tx: TenantTransaction, actor: LedgerActor): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    return;
  }
  await tx.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tx.tenantId}::text)::bigint)`);
  const documents = await many<{ id: string }>(
    tx,
    sql`
      SELECT d.id
      FROM o2c_documents AS d
      WHERE d.status = 'issued'
        AND d.kind IN ('invoice', 'credit_note')
        AND NOT EXISTS (
          SELECT 1 FROM fin01_journals AS j
          WHERE j.source_key = CASE
            WHEN d.kind = 'invoice' AND d.origin = 'opening' THEN 'opening-invoice:' || d.id::text
            WHEN d.kind = 'credit_note' AND EXISTS (
              SELECT 1 FROM o2c_documents AS parent
              WHERE parent.id = d.invoice_id AND parent.origin = 'opening'
            ) THEN 'opening-credit:' || d.id::text
            WHEN d.kind = 'invoice' THEN 'invoice:' || d.id::text
            ELSE 'credit:' || d.id::text
          END
        )
      ORDER BY CASE WHEN d.kind = 'invoice' THEN 0 ELSE 1 END, d.issued_on, d.number
    `,
  );
  for (const document of documents) {
    await postSalesDocument(tx, actor, document.id);
  }
  const payments = await many<{ id: string }>(
    tx,
    sql`
      SELECT p.id
      FROM o2c_payments AS p
      WHERE NOT EXISTS (
        SELECT 1 FROM fin01_journals AS j WHERE j.source_key = 'payment:' || p.id::text
      )
      ORDER BY p.paid_on
    `,
  );
  for (const payment of payments) {
    await postCustomerPayment(tx, actor, payment.id);
  }
  const movements = await many<{
    id: string;
    kind: string;
    value_cents: unknown;
    reason: string;
    occurred_at: Date | string;
    reverses_movement_id: string | null;
    original_kind: string | null;
    original_reason: string | null;
  }>(
    tx,
    sql`
      SELECT
        m.id, m.kind, m.value_cents, m.reason, m.occurred_at, m.reverses_movement_id,
        original.kind AS original_kind, original.reason AS original_reason
      FROM scm01_movements AS m
      LEFT JOIN scm01_movements AS original ON original.id = m.reverses_movement_id
      WHERE m.status = 'posted'
        AND m.value_cents <> 0
        AND m.kind NOT IN ('transfer_in', 'transfer_out')
        AND m.reason NOT LIKE 'Tax invoice%'
        AND NOT EXISTS (SELECT 1 FROM o2c_stock_links AS s WHERE s.movement_id = m.id)
        AND (
          original.id IS NULL
          OR (
            original.reason NOT LIKE 'Tax invoice%'
            AND NOT EXISTS (SELECT 1 FROM o2c_stock_links AS s WHERE s.movement_id = original.id)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM fin01_journals AS j WHERE j.source_key = 'movement:' || m.id::text
        )
      ORDER BY m.occurred_at
    `,
  );
  for (const movement of movements) {
    const opening =
      movement.reason === 'Opening stock from import' ||
      movement.original_reason === 'Opening stock from import';
    const occurredAt =
      movement.occurred_at instanceof Date ? movement.occurred_at : new Date(movement.occurred_at);
    await postStockGl(tx, actor, {
      movementId: movement.id,
      kind: movement.kind,
      journalKind: movement.original_kind ?? movement.kind,
      valueCents: asBigint(movement.value_cents),
      reason: movement.reason,
      occurredAt,
      glTreatment: opening ? 'opening' : 'standard',
      reversesMovementId: movement.reverses_movement_id,
    });
  }
}

export async function partyIdForCode(
  tx: TenantTransaction,
  role: 'customer' | 'supplier',
  code: string,
): Promise<string | null> {
  const row = await one<{ party_id: string }>(
    tx,
    sql`
      SELECT party_id
      FROM fin01_party_codes
      WHERE role = ${role} AND lower(code) = lower(${code})
    `,
  );
  return row?.party_id ?? null;
}

export async function savePartyCode(
  tx: TenantTransaction,
  input: { partyId: string; role: 'customer' | 'supplier'; code: string },
): Promise<void> {
  await tx.db.execute(sql`
    INSERT INTO fin01_party_codes (tenant_id, party_id, role, code)
    VALUES (${tx.tenantId}, ${input.partyId}, ${input.role}, ${input.code.trim()})
    ON CONFLICT (tenant_id, party_id, role)
    DO UPDATE SET code = EXCLUDED.code, updated_at = now()
  `);
}

/** Bring a supplier balance onto Creditors Control. A second import posts only the change. */
export async function postSupplierOpening(
  tx: TenantTransaction,
  actor: LedgerActor,
  input: { partyId: string; name: string; amountCents: bigint; asAt: string },
): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    throw new Error('The general ledger is switched off.');
  }
  const current = await one<{ opening_cents: unknown }>(
    tx,
    sql`
      SELECT opening_cents
      FROM fin01_party_codes
      WHERE party_id = ${input.partyId} AND role = 'supplier'
    `,
  );
  const previous = current?.opening_cents == null ? 0n : asBigint(current.opening_cents);
  const next = input.amountCents;
  if (next === previous) {
    return;
  }
  const delta = next > previous ? next - previous : previous - next;
  const equity = await accountByKey(tx, 'opening_equity');
  const creditors = await accountByKey(tx, 'creditors');
  const lines =
    next > previous
      ? pair(equity, creditors, delta, 'credit', input.partyId)
      : pair(creditors, equity, delta, 'debit', input.partyId);
  await postJournal(tx, actor, {
    date: input.asAt,
    memo: `Opening balance for ${input.name}`,
    source: 'opening',
    sourceKey: `supplier-opening:${input.partyId}:${previous.toString()}:${next.toString()}`,
    lines,
  });
  await tx.db.execute(sql`
    UPDATE fin01_party_codes
    SET opening_cents = ${next}, opening_on = ${input.asAt}::date, updated_at = now()
    WHERE party_id = ${input.partyId} AND role = 'supplier'
  `);
}

export async function trialAlreadyPosted(
  tx: TenantTransaction,
  asAt: string,
): Promise<string | null> {
  const row = await one<{ id: string }>(
    tx,
    sql`SELECT id FROM fin01_journals WHERE source_key = ${`trial:${asAt}`}`,
  );
  return row?.id ?? null;
}

/** One balanced opening trial balance for a single as-at date. */
export async function postOpeningTrial(
  tx: TenantTransaction,
  actor: LedgerActor,
  input: {
    asAt: string;
    lines: { code: string; debitCents: bigint; creditCents: bigint }[];
  },
): Promise<string | null> {
  if (!(await ledgerIsOn(tx))) {
    throw new LedgerError('The general ledger is switched off.');
  }
  await ensureChart(tx);
  const lines: JournalLineInput[] = [];
  for (const line of input.lines) {
    const account = await one<{ id: string; active: boolean }>(
      tx,
      sql`SELECT id, active FROM fin01_accounts WHERE code = ${line.code}`,
    );
    if (!account || !account.active) {
      throw new LedgerError(`Account ${line.code} is not on the chart.`);
    }
    lines.push({
      accountId: account.id,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    });
  }
  return postJournal(tx, actor, {
    date: input.asAt,
    memo: 'Opening trial balance',
    source: 'trial',
    sourceKey: `trial:${input.asAt}`,
    lines,
  });
}
