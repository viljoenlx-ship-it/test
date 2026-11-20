import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadBranchContext, type TenantTransaction } from '@omnivate/kernel';
import { postSalesDocument } from '@omnivate/module-fin-01';
import { issueStock } from '@omnivate/module-scm-01';
import {
  addCalendarDays,
  centsToDecimal,
  creditDiscountCents,
  documentNumber,
  formatSalesQuantity,
  formatZar,
  invoiceStatusLabel,
  johannesburgToday,
  johannesburgYear,
  money,
  parseSalesQuantity,
  quoteStatusLabel,
  salesLineAmounts,
  sumSalesLines,
  zarFromDecimal,
  type SalesDocumentKind,
  type SalesLineAmounts,
} from '@omnivate/shared';
import {
  assertInvoiceRead,
  assertInvoiceWrite,
  assertQuoteRead,
  assertQuoteWrite,
  canWriteInvoices,
  canWriteQuotes,
  type Actor,
} from './access';
import { customerSnapshot } from './customers';
import { wouldExceedCreditLimit } from './domain';
import { SalesError } from './errors';
import { customFieldState, storeCustomFields, type SalesEntity } from './fields';
import { audit, many, one } from './rows';

export type LineInput = {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

export type QuoteInput = {
  customerId: string;
  lines: LineInput[];
  notes: string;
  validUntil: string | null;
  customFields?: Record<string, unknown>;
};

export type InvoiceInput = {
  customerId: string;
  lines: LineInput[];
  notes: string;
  dueOn: string | null;
  customFields?: Record<string, unknown>;
};

type DocRow = {
  id: string;
  kind: 'quote' | 'invoice' | 'credit_note';
  status: string;
  number: string | null;
  party_id: string;
  customer_name: string;
  customer_vat: string;
  customer_address: string;
  customer_contact: string;
  issued_on: string | null;
  due_on: string | null;
  valid_until: string | null;
  vat_rate_basis_points: number;
  net_cents: bigint;
  vat_cents: bigint;
  total_cents: bigint;
  notes: string;
  quote_id: string | null;
  invoice_id: string | null;
  deduct_stock: boolean;
};

type LineRow = {
  id: string;
  position: number;
  item_id: string | null;
  source_line_id: string | null;
  description: string;
  quantity: string;
  unit_price_cents: bigint;
  discount_cents: bigint;
  net_cents: bigint;
  vat_cents: bigint;
  total_cents: bigint;
};

type Priced = {
  itemId: string | null;
  description: string;
  quantity: bigint;
  unitPriceCents: bigint;
  amounts: SalesLineAmounts;
};

function labelled(cents: bigint) {
  return { cents: cents.toString(), label: formatZar(money(cents)) };
}

function asDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new SalesError('Enter a date as YYYY-MM-DD.');
  }
  return text;
}

function note(value: string): string {
  const text = value.trim();
  if (text.length > 2000) {
    throw new SalesError('Notes are too long.');
  }
  return text;
}

async function vatRate(tx: TenantTransaction): Promise<number> {
  const row = await one<{ rate: number }>(
    tx,
    sql`SELECT vat_rate_basis_points AS rate FROM tenants`,
  );
  return row?.rate ?? 1500;
}

export async function nextDocumentNumber(
  tx: TenantTransaction,
  kind: SalesDocumentKind,
  now = new Date(),
): Promise<string> {
  const year = johannesburgYear(now);
  const row = await one<{ last_number: number }>(
    tx,
    sql`
      INSERT INTO o2c_sequences (tenant_id, doc_kind, year, last_number)
      VALUES (${tx.tenantId}, ${kind}, ${year}, 1)
      ON CONFLICT (tenant_id, doc_kind, year)
      DO UPDATE SET last_number = o2c_sequences.last_number + 1
      RETURNING last_number
    `,
  );
  if (!row) {
    throw new SalesError('Could not allocate a document number.');
  }
  return documentNumber(kind, year, row.last_number);
}

async function priceLines(
  tx: TenantTransaction,
  lines: LineInput[],
  rate: number,
): Promise<Priced[]> {
  if (lines.length < 1) {
    throw new SalesError('Add at least one line.');
  }
  if (lines.length > 80) {
    throw new SalesError('A document can have at most 80 lines.');
  }
  const priced: Priced[] = [];
  for (const line of lines) {
    const quantity = parseSalesQuantity(line.quantity);
    let unit = 0n;
    try {
      unit = zarFromDecimal(line.unitPrice.trim() || '0').amountCents;
    } catch (error) {
      throw new SalesError(error instanceof Error ? error.message : 'Enter a unit price.');
    }
    let discount = 0n;
    if (line.discount.trim()) {
      try {
        discount = zarFromDecimal(line.discount.trim()).amountCents;
      } catch (error) {
        throw new SalesError(error instanceof Error ? error.message : 'Enter a discount.');
      }
    }
    if (discount < 0n) {
      throw new SalesError('Discount cannot be negative.');
    }
    let description = line.description.trim();
    const itemId = line.itemId?.trim() || null;
    if (itemId) {
      const item = await one<{ id: string; name: string; status: string }>(
        tx,
        sql`SELECT id, name, status FROM scm01_items WHERE id = ${itemId}`,
      );
      if (!item || item.status !== 'active') {
        throw new SalesError('That catalog item is not available.');
      }
      if (!description) {
        description = item.name;
      }
    }
    if (description.length < 1 || description.length > 200) {
      throw new SalesError('Each line needs a description.');
    }
    let amounts: SalesLineAmounts;
    try {
      amounts = salesLineAmounts({
        quantity,
        unitPriceCents: unit,
        discountCents: discount,
        vatBasisPoints: rate,
      });
    } catch (error) {
      throw new SalesError(error instanceof Error ? error.message : 'Check the line amounts.');
    }
    priced.push({ itemId, description, quantity, unitPriceCents: unit, amounts });
  }
  return priced;
}

async function insertLines(
  tx: TenantTransaction,
  documentId: string,
  lines: Priced[],
  sourceLineId?: (line: Priced, index: number) => string | null,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, line] of lines.entries()) {
    const id = randomUUID();
    ids.push(id);
    await tx.db.execute(sql`
      INSERT INTO o2c_lines (
        id, tenant_id, document_id, position, item_id, source_line_id, description,
        quantity, unit_price_cents, discount_cents, net_cents, vat_cents, total_cents
      ) VALUES (
        ${id}, ${tx.tenantId}, ${documentId}, ${index}, ${line.itemId},
        ${sourceLineId ? sourceLineId(line, index) : null},
        ${line.description}, ${formatSalesQuantity(line.quantity)}, ${line.unitPriceCents},
        ${line.amounts.discountCents}, ${line.amounts.netCents}, ${line.amounts.vatCents},
        ${line.amounts.totalCents}
      )
    `);
  }
  return ids;
}

async function archiveLines(tx: TenantTransaction, documentId: string): Promise<void> {
  await tx.db.execute(sql`
    UPDATE o2c_lines
    SET archived_at = now()
    WHERE document_id = ${documentId} AND archived_at IS NULL
  `);
}

type Balance = { balance: bigint; allocated: bigint; credited: bigint };

export async function invoiceBalance(tx: TenantTransaction, invoiceId: string): Promise<Balance> {
  const row = await one<{ balance: bigint; allocated: bigint; credited: bigint }>(
    tx,
    sql`
      SELECT
        d.total_cents
          - COALESCE((
              SELECT SUM(c.total_cents)::bigint FROM o2c_documents AS c
              WHERE c.invoice_id = d.id AND c.kind = 'credit_note' AND c.status = 'issued'
            ), 0)
          - COALESCE((
              SELECT SUM(a.amount_cents)::bigint FROM o2c_allocations AS a WHERE a.invoice_id = d.id
            ), 0) AS balance,
        COALESCE((
          SELECT SUM(a.amount_cents)::bigint FROM o2c_allocations AS a WHERE a.invoice_id = d.id
        ), 0) AS allocated,
        COALESCE((
          SELECT SUM(c.total_cents)::bigint FROM o2c_documents AS c
          WHERE c.invoice_id = d.id AND c.kind = 'credit_note' AND c.status = 'issued'
        ), 0) AS credited
      FROM o2c_documents AS d
      WHERE d.id = ${invoiceId} AND d.kind = 'invoice'
    `,
  );
  return row ?? { balance: 0n, allocated: 0n, credited: 0n };
}

async function linesOf(tx: TenantTransaction, documentId: string): Promise<LineRow[]> {
  return many<LineRow>(
    tx,
    sql`
      SELECT
        id, position, item_id, source_line_id, description, quantity::text AS quantity,
        unit_price_cents, discount_cents, net_cents, vat_cents, total_cents
      FROM o2c_lines
      WHERE document_id = ${documentId} AND archived_at IS NULL
      ORDER BY position
    `,
  );
}

function entityFor(kind: DocRow['kind']): SalesEntity {
  if (kind === 'quote') {
    return 'quote';
  }
  if (kind === 'credit_note') {
    return 'credit_note';
  }
  return 'invoice';
}

async function present(tx: TenantTransaction, actor: Actor, row: DocRow) {
  const today = johannesburgToday();
  const lines = await linesOf(tx, row.id);
  const balance = row.kind === 'invoice' ? await invoiceBalance(tx, row.id) : null;
  const linked =
    row.kind === 'quote'
      ? await one<{ id: string; number: string | null }>(
          tx,
          sql`
          SELECT id, number FROM o2c_documents
          WHERE quote_id = ${row.id} AND kind = 'invoice'
          LIMIT 1
        `,
        )
      : null;
  const source = row.invoice_id
    ? await one<{ number: string | null }>(
        tx,
        sql`SELECT number FROM o2c_documents WHERE id = ${row.invoice_id}`,
      )
    : null;
  const statusLabel =
    row.kind === 'quote'
      ? quoteStatusLabel(row.status, row.valid_until, today)
      : row.kind === 'invoice' && row.status === 'issued' && balance
        ? invoiceStatusLabel({
            totalCents: row.total_cents,
            balanceCents: balance.balance,
            allocatedCents: balance.allocated,
            dueOn: row.due_on ?? today,
            today,
          })
        : row.status === 'draft'
          ? 'Draft'
          : 'Issued';
  const fields = await customFieldState(tx, actor, entityFor(row.kind), row.id);
  const editable =
    row.status === 'draft' &&
    (row.kind === 'quote'
      ? await canWriteQuotes(tx, actor.userId)
      : await canWriteInvoices(tx, actor.userId));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    statusLabel,
    number: row.number,
    customerId: row.party_id,
    customerName: row.customer_name,
    customerVat: row.customer_vat,
    customerAddress: row.customer_address,
    customerContact: row.customer_contact,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    validUntil: row.valid_until,
    notes: row.notes,
    quoteId: row.quote_id,
    invoiceId: row.invoice_id,
    invoiceNumber: source?.number ?? null,
    linkedInvoiceId: linked?.id ?? null,
    linkedInvoiceNumber: linked?.number ?? null,
    net: labelled(row.net_cents),
    vat: labelled(row.vat_cents),
    total: labelled(row.total_cents),
    balance: balance ? labelled(balance.balance) : null,
    allocated: balance ? labelled(balance.allocated) : null,
    credited: balance ? labelled(balance.credited) : null,
    vatRateBasisPoints: row.vat_rate_basis_points,
    deductStock: row.deduct_stock,
    canEdit: editable,
    definitions: fields.definitions,
    values: fields.values,
    canEditFields: fields.canEdit,
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.item_id,
      description: line.description,
      quantity: formatSalesQuantity(parseSalesQuantity(line.quantity)),
      unitPrice: centsToDecimal(line.unit_price_cents),
      discount: centsToDecimal(line.discount_cents),
      net: labelled(line.net_cents),
      vat: labelled(line.vat_cents),
      total: labelled(line.total_cents),
    })),
  };
}

async function loadRow(tx: TenantTransaction, id: string): Promise<DocRow | null> {
  return one<DocRow>(
    tx,
    sql`
      SELECT
        id, kind, status, number, party_id, customer_name, customer_vat, customer_address,
        customer_contact, issued_on::text AS issued_on, due_on::text AS due_on,
        valid_until::text AS valid_until, vat_rate_basis_points, net_cents, vat_cents,
        total_cents, notes, quote_id, invoice_id, deduct_stock
      FROM o2c_documents
      WHERE id = ${id}
    `,
  );
}

export async function getDocument(tx: TenantTransaction, actor: Actor, id: string) {
  const row = await loadRow(tx, id);
  if (!row) {
    throw new SalesError('That document was not found.', 404);
  }
  if (row.kind === 'quote') {
    await assertQuoteRead(tx, actor.userId);
  } else {
    await assertInvoiceRead(tx, actor.userId);
  }
  return present(tx, actor, row);
}

export async function listQuotes(
  tx: TenantTransaction,
  actor: Actor,
  status: string,
  query: string,
) {
  await assertQuoteRead(tx, actor.userId);
  const rows = await many<DocRow>(
    tx,
    sql`
      SELECT
        id, kind, status, number, party_id, customer_name, customer_vat, customer_address,
        customer_contact, issued_on::text, due_on::text, valid_until::text, vat_rate_basis_points,
        net_cents, vat_cents, total_cents, notes, quote_id, invoice_id, deduct_stock
      FROM o2c_documents
      WHERE kind = 'quote'
      ORDER BY created_at DESC
      LIMIT 200
    `,
  );
  const today = johannesburgToday();
  const q = query.trim().toLowerCase();
  const filter = status.trim().toLowerCase();
  const quotes = [];
  for (const row of rows) {
    const label = quoteStatusLabel(row.status, row.valid_until, today);
    if (filter && filter !== 'all' && label.toLowerCase() !== filter) {
      continue;
    }
    if (q && !`${row.number ?? ''} ${row.customer_name}`.toLowerCase().includes(q)) {
      continue;
    }
    quotes.push({
      id: row.id,
      number: row.number,
      customerName: row.customer_name,
      statusLabel: label,
      total: labelled(row.total_cents),
      validUntil: row.valid_until,
    });
  }
  return { quotes, canEdit: await canWriteQuotes(tx, actor.userId) };
}

export async function listInvoices(
  tx: TenantTransaction,
  actor: Actor,
  status: string,
  query: string,
) {
  await assertInvoiceRead(tx, actor.userId);
  const rows = await many<DocRow>(
    tx,
    sql`
      SELECT
        id, kind, status, number, party_id, customer_name, customer_vat, customer_address,
        customer_contact, issued_on::text AS issued_on, due_on::text AS due_on,
        valid_until::text AS valid_until, vat_rate_basis_points, net_cents, vat_cents,
        total_cents, notes, quote_id, invoice_id, deduct_stock
      FROM o2c_documents
      WHERE kind = 'invoice'
      ORDER BY created_at DESC
      LIMIT 200
    `,
  );
  const today = johannesburgToday();
  const q = query.trim().toLowerCase();
  const filter = status.trim().toLowerCase();
  const invoices = [];
  for (const row of rows) {
    const balance = row.status === 'issued' ? await invoiceBalance(tx, row.id) : null;
    const label =
      row.status === 'draft'
        ? 'Draft'
        : invoiceStatusLabel({
            totalCents: row.total_cents,
            balanceCents: balance?.balance ?? row.total_cents,
            allocatedCents: balance?.allocated ?? 0n,
            dueOn: row.due_on ?? today,
            today,
          });
    if (filter && filter !== 'all' && label.toLowerCase() !== filter) {
      continue;
    }
    if (q && !`${row.number ?? ''} ${row.customer_name}`.toLowerCase().includes(q)) {
      continue;
    }
    invoices.push({
      id: row.id,
      number: row.number ?? 'Draft',
      customerName: row.customer_name,
      statusLabel: label,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      total: labelled(row.total_cents),
      balance: labelled(balance?.balance ?? row.total_cents),
    });
  }
  return { invoices, canEdit: await canWriteInvoices(tx, actor.userId) };
}

async function writeHeader(
  tx: TenantTransaction,
  id: string,
  input: {
    customerId: string;
    notes: string;
    validUntil: string | null;
    dueOn: string | null;
    rate: number;
    totals: SalesLineAmounts;
    number: string | null;
    kind: 'quote' | 'invoice';
  },
) {
  const customer = await customerSnapshot(tx, input.customerId);
  await tx.db.execute(sql`
    UPDATE o2c_documents SET
      party_id = ${customer.partyId},
      customer_name = ${customer.name},
      customer_vat = ${customer.vat},
      customer_address = ${customer.address},
      customer_contact = ${customer.contact},
      valid_until = ${input.validUntil},
      due_on = ${input.dueOn},
      vat_rate_basis_points = ${input.rate},
      net_cents = ${input.totals.netCents},
      vat_cents = ${input.totals.vatCents},
      total_cents = ${input.totals.totalCents},
      notes = ${input.notes},
      updated_at = now()
    WHERE id = ${id} AND kind = ${input.kind} AND status = 'draft'
  `);
}

export async function saveQuote(
  tx: TenantTransaction,
  actor: Actor,
  id: string | null,
  input: QuoteInput,
) {
  await assertQuoteWrite(tx, actor.userId);
  const rate = await vatRate(tx);
  const lines = await priceLines(tx, input.lines, rate);
  const totals = sumSalesLines(lines.map((line) => line.amounts));
  const notes = note(input.notes);
  const validUntil = asDate(input.validUntil);
  const customer = await customerSnapshot(tx, input.customerId);
  let documentId = id;
  if (!documentId) {
    documentId = randomUUID();
    const number = await nextDocumentNumber(tx, 'quote');
    await tx.db.execute(sql`
      INSERT INTO o2c_documents (
        id, tenant_id, kind, status, number, party_id, customer_name, customer_vat,
        customer_address, customer_contact, valid_until, vat_rate_basis_points,
        net_cents, vat_cents, total_cents, notes, created_by
      ) VALUES (
        ${documentId}, ${tx.tenantId}, 'quote', 'draft', ${number}, ${customer.partyId},
        ${customer.name}, ${customer.vat}, ${customer.address}, ${customer.contact},
        ${validUntil}, ${rate}, ${totals.netCents}, ${totals.vatCents}, ${totals.totalCents},
        ${notes}, ${actor.userId}
      )
    `);
  } else {
    const current = await loadRow(tx, documentId);
    if (!current || current.kind !== 'quote') {
      throw new SalesError('That quote was not found.', 404);
    }
    if (current.status !== 'draft') {
      throw new SalesError('A quote can only be edited while it is a draft.');
    }
    await archiveLines(tx, documentId);
    await writeHeader(tx, documentId, {
      customerId: input.customerId,
      notes,
      validUntil,
      dueOn: null,
      rate,
      totals,
      number: current.number,
      kind: 'quote',
    });
  }
  await insertLines(tx, documentId, lines);
  await storeCustomFields(tx, actor, 'quote', documentId, input.customFields);
  await audit(tx, actor, 'sales.quote.saved', 'o2c_document', documentId, {
    customer: customer.name,
    totalCents: totals.totalCents.toString(),
  });
  return getDocument(tx, actor, documentId);
}

export async function setQuoteStatus(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  status: 'sent' | 'accepted' | 'declined',
) {
  await assertQuoteWrite(tx, actor.userId);
  const row = await loadRow(tx, id);
  if (!row || row.kind !== 'quote') {
    throw new SalesError('That quote was not found.', 404);
  }
  const today = johannesburgToday();
  const label = quoteStatusLabel(row.status, row.valid_until, today);
  if (status === 'sent' && row.status !== 'draft') {
    throw new SalesError('Only a draft quote can be marked sent.');
  }
  if (status === 'accepted' && (row.status !== 'sent' || label === 'Expired')) {
    throw new SalesError('Accept a quote that has been sent and has not expired.');
  }
  if (status === 'declined' && row.status !== 'draft' && row.status !== 'sent') {
    throw new SalesError('That quote can no longer be declined.');
  }
  await tx.db.execute(sql`
    UPDATE o2c_documents
    SET status = ${status}, updated_at = now(),
        issued_on = CASE WHEN ${status} = 'sent' THEN ${today}::date ELSE issued_on END
    WHERE id = ${id}
  `);
  await audit(tx, actor, `sales.quote.${status}`, 'o2c_document', id, { status });
  return getDocument(tx, actor, id);
}

async function deductStock(
  tx: TenantTransaction,
  actor: Actor,
  documentId: string,
  number: string,
  lineIds: string[],
  lines: Priced[],
) {
  const branch = (await loadBranchContext(tx, actor.userId)).current;
  if (!branch) {
    throw new SalesError('Choose a branch before deducting stock.');
  }
  for (const [index, line] of lines.entries()) {
    if (!line.itemId) {
      continue;
    }
    const item = await one<{
      kind: string;
      base_uom: string;
      track_batches: boolean;
      track_serials: boolean;
    }>(
      tx,
      sql`
        SELECT kind, base_uom, track_batches, track_serials
        FROM scm01_items WHERE id = ${line.itemId}
      `,
    );
    if (!item || item.kind !== 'stock') {
      continue;
    }
    if (item.track_batches || item.track_serials) {
      throw new SalesError(
        'Deduct stock is not available for batch or serial items. Leave it off, or use a plain catalog item.',
      );
    }
    const lineId = lineIds[index];
    if (!lineId) {
      throw new SalesError('A line was missing when stock was deducted.');
    }
    try {
      const moved = await issueStock(tx, actor, {
        itemId: line.itemId,
        branchId: branch.id,
        quantity: formatSalesQuantity(line.quantity),
        uomName: item.base_uom,
        reason: `Tax invoice ${number}`,
        glTreatment: 'sale',
      });
      await tx.db.execute(sql`
        INSERT INTO o2c_stock_links (tenant_id, document_id, line_id, movement_id)
        VALUES (${tx.tenantId}, ${documentId}, ${lineId}, ${moved.movementId})
      `);
    } catch (error) {
      if (error instanceof Error && error.name === 'CatalogError') {
        throw new SalesError(error.message);
      }
      throw error;
    }
  }
  await tx.db.execute(sql`
    UPDATE o2c_documents SET branch_id = ${branch.id}, deduct_stock = true WHERE id = ${documentId}
  `);
}

async function issueDraft(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  kind: 'invoice' | 'credit_note',
  deduct: boolean,
  lines: Priced[],
  lineIds: string[],
) {
  const today = johannesburgToday();
  const number = await nextDocumentNumber(tx, kind);
  const customer = await loadRow(tx, id);
  if (!customer) {
    throw new SalesError('That document was not found.', 404);
  }
  if (deduct && kind === 'invoice') {
    await deductStock(tx, actor, id, number, lineIds, lines);
  }
  const due =
    kind === 'invoice'
      ? (customer.due_on ??
        addCalendarDays(today, (await customerSnapshot(tx, customer.party_id)).termsDays))
      : null;
  const updated = await one<{ id: string }>(tx, sql`
    UPDATE o2c_documents
    SET status = 'issued', number = ${number}, issued_on = ${today}::date, due_on = ${due},
        issued_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'draft'
    RETURNING id
  `);
  if (!updated) throw new SalesError('This document has already been issued.');
  await postSalesDocument(tx, actor, id);
  return number;
}

export async function saveInvoice(
  tx: TenantTransaction,
  actor: Actor,
  id: string | null,
  input: InvoiceInput,
) {
  await assertInvoiceWrite(tx, actor.userId);
  const rate = await vatRate(tx);
  const lines = await priceLines(tx, input.lines, rate);
  const totals = sumSalesLines(lines.map((line) => line.amounts));
  const notes = note(input.notes);
  const dueOn = asDate(input.dueOn);
  const customer = await customerSnapshot(tx, input.customerId);
  let documentId = id;
  if (!documentId) {
    documentId = randomUUID();
    await tx.db.execute(sql`
      INSERT INTO o2c_documents (
        id, tenant_id, kind, status, party_id, customer_name, customer_vat,
        customer_address, customer_contact, due_on, vat_rate_basis_points,
        net_cents, vat_cents, total_cents, notes, created_by
      ) VALUES (
        ${documentId}, ${tx.tenantId}, 'invoice', 'draft', ${customer.partyId},
        ${customer.name}, ${customer.vat}, ${customer.address}, ${customer.contact},
        ${dueOn}, ${rate}, ${totals.netCents}, ${totals.vatCents}, ${totals.totalCents},
        ${notes}, ${actor.userId}
      )
    `);
  } else {
    const current = await loadRow(tx, documentId);
    if (!current || current.kind !== 'invoice') {
      throw new SalesError('That invoice was not found.', 404);
    }
    if (current.status !== 'draft') {
      throw new SalesError('An issued tax invoice cannot be edited. Raise a credit note.');
    }
    await archiveLines(tx, documentId);
    await writeHeader(tx, documentId, {
      customerId: input.customerId,
      notes,
      validUntil: null,
      dueOn,
      rate,
      totals,
      number: null,
      kind: 'invoice',
    });
  }
  await insertLines(tx, documentId, lines);
  await storeCustomFields(tx, actor, 'invoice', documentId, input.customFields);
  await audit(tx, actor, 'sales.invoice.saved', 'o2c_document', documentId, {
    customer: customer.name,
    totalCents: totals.totalCents.toString(),
  });
  return getDocument(tx, actor, documentId);
}

async function assertCustomerCreditPolicy(
  tx: TenantTransaction,
  partyId: string,
  invoiceTotalCents: bigint,
): Promise<void> {
  const credit = await one<{
    credit_hold: boolean;
    credit_hold_reason: string;
    credit_limit_cents: bigint | null;
  }>(
    tx,
    sql`SELECT credit_hold, credit_hold_reason, credit_limit_cents FROM o2c_customer_terms WHERE party_id=${partyId} FOR UPDATE`,
  );
  if (credit?.credit_hold) {
    throw new SalesError(
      `This customer is on credit hold: ${credit.credit_hold_reason || 'contact an administrator'}.`,
      403,
    );
  }
  if (credit?.credit_limit_cents !== null && credit?.credit_limit_cents !== undefined) {
    const openRows = await many<{ id: string }>(
      tx,
      sql`SELECT id FROM o2c_documents WHERE kind='invoice' AND status='issued' AND party_id=${partyId}`,
    );
    let outstanding = 0n;
    for (const invoice of openRows) {
      outstanding += (await invoiceBalance(tx, invoice.id)).balance;
    }
    if (wouldExceedCreditLimit(outstanding, invoiceTotalCents, credit.credit_limit_cents)) {
      throw new SalesError(
        'Issuing this invoice would exceed the customer credit limit. Review the outstanding balance or update the credit limit.',
        403,
      );
    }
  }
}

export async function issueInvoice(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  deductStockRequested: boolean,
) {
  await assertInvoiceWrite(tx, actor.userId);
  const row = await loadRow(tx, id);
  if (!row || row.kind !== 'invoice') {
    throw new SalesError('That invoice was not found.', 404);
  }
  if (row.status !== 'draft') {
    throw new SalesError('This tax invoice has already been issued.');
  }
  await assertCustomerCreditPolicy(tx, row.party_id, row.total_cents);
  const stored = await linesOf(tx, id);
  const priced: Priced[] = stored.map((line) => ({
    itemId: line.item_id,
    description: line.description,
    quantity: parseSalesQuantity(line.quantity),
    unitPriceCents: line.unit_price_cents,
    amounts: {
      extendedCents: line.net_cents + line.discount_cents,
      discountCents: line.discount_cents,
      netCents: line.net_cents,
      vatCents: line.vat_cents,
      totalCents: line.total_cents,
    },
  }));
  const number = await issueDraft(
    tx,
    actor,
    id,
    'invoice',
    deductStockRequested,
    priced,
    stored.map((line) => line.id),
  );
  await audit(tx, actor, 'sales.invoice.issued', 'o2c_document', id, {
    number,
    deductStock: deductStockRequested,
    totalCents: row.total_cents.toString(),
  });
  return getDocument(tx, actor, id);
}

export async function convertQuote(
  tx: TenantTransaction,
  actor: Actor,
  quoteId: string,
  deductStockRequested: boolean,
) {
  await assertQuoteRead(tx, actor.userId);
  await assertInvoiceWrite(tx, actor.userId);
  const quote = await loadRow(tx, quoteId);
  if (!quote || quote.kind !== 'quote') {
    throw new SalesError('That quote was not found.', 404);
  }
  if (quote.status !== 'accepted') {
    throw new SalesError('Accept the quote before creating an invoice.');
  }
  const existing = await one<{ id: string }>(
    tx,
    sql`SELECT id FROM o2c_documents WHERE quote_id = ${quoteId} AND kind = 'invoice'`,
  );
  if (existing) {
    throw new SalesError('This quote already has an invoice.');
  }
  await assertCustomerCreditPolicy(tx, quote.party_id, quote.total_cents);
  const stored = await linesOf(tx, quoteId);
  const priced: Priced[] = stored.map((line) => ({
    itemId: line.item_id,
    description: line.description,
    quantity: parseSalesQuantity(line.quantity),
    unitPriceCents: line.unit_price_cents,
    amounts: {
      extendedCents: line.net_cents + line.discount_cents,
      discountCents: line.discount_cents,
      netCents: line.net_cents,
      vatCents: line.vat_cents,
      totalCents: line.total_cents,
    },
  }));
  const invoiceId = randomUUID();
  const customer = await customerSnapshot(tx, quote.party_id);
  const due = addCalendarDays(johannesburgToday(), customer.termsDays);
  await tx.db.execute(sql`
    INSERT INTO o2c_documents (
      id, tenant_id, kind, status, party_id, customer_name, customer_vat, customer_address,
      customer_contact, due_on, vat_rate_basis_points, net_cents, vat_cents, total_cents,
      notes, quote_id, created_by
    ) VALUES (
      ${invoiceId}, ${tx.tenantId}, 'invoice', 'draft', ${customer.partyId}, ${customer.name},
      ${customer.vat}, ${customer.address}, ${customer.contact}, ${due},
      ${quote.vat_rate_basis_points}, ${quote.net_cents}, ${quote.vat_cents}, ${quote.total_cents},
      ${quote.notes}, ${quoteId}, ${actor.userId}
    )
  `);
  const lineIds = await insertLines(tx, invoiceId, priced);
  const number = await issueDraft(
    tx,
    actor,
    invoiceId,
    'invoice',
    deductStockRequested,
    priced,
    lineIds,
  );
  await audit(tx, actor, 'sales.quote.converted', 'o2c_document', invoiceId, {
    quoteId,
    number,
    totalCents: quote.total_cents.toString(),
  });
  return getDocument(tx, actor, invoiceId);
}

export async function issueCreditNote(
  tx: TenantTransaction,
  actor: Actor,
  invoiceId: string,
  requested: { lineId: string; quantity: string }[],
) {
  await assertInvoiceWrite(tx, actor.userId);
  const invoice = await loadRow(tx, invoiceId);
  if (!invoice || invoice.kind !== 'invoice' || invoice.status !== 'issued') {
    throw new SalesError('Credit a tax invoice that has been issued.');
  }
  const original = await linesOf(tx, invoiceId);
  const byId = new Map(original.map((line) => [line.id, line]));
  const credited = await many<{
    source_line_id: string;
    quantity: string;
    discount_cents: bigint;
    net_cents: bigint;
    vat_cents: bigint;
  }>(
    tx,
    sql`
      SELECT l.source_line_id, SUM(l.quantity)::text AS quantity,
             SUM(l.discount_cents)::bigint AS discount_cents,
             SUM(l.net_cents)::bigint AS net_cents,
             SUM(l.vat_cents)::bigint AS vat_cents
      FROM o2c_lines AS l
      JOIN o2c_documents AS d ON d.id = l.document_id
      WHERE d.invoice_id = ${invoiceId} AND d.kind = 'credit_note' AND d.status = 'issued'
        AND l.archived_at IS NULL AND l.source_line_id IS NOT NULL
      GROUP BY l.source_line_id
    `,
  );
  const used = new Map(credited.map((row) => [row.source_line_id, row]));
  const priced: Priced[] = [];
  const sourceIds: string[] = [];
  for (const request of requested) {
    const quantityText = request.quantity.trim();
    if (!quantityText || quantityText === '0') {
      continue;
    }
    const line = byId.get(request.lineId);
    if (!line) {
      throw new SalesError('That invoice line is not on this tax invoice.');
    }
    const quantity = parseSalesQuantity(quantityText);
    const prior = used.get(line.id);
    const alreadyQty = prior ? parseSalesQuantity(prior.quantity) : 0n;
    const originalQty = parseSalesQuantity(line.quantity);
    const remainingQty = originalQty - alreadyQty;
    if (quantity > remainingQty) {
      throw new SalesError(
        `Only ${formatSalesQuantity(remainingQty)} remains on ${line.description}.`,
      );
    }
    const alreadyDiscount = prior?.discount_cents ?? 0n;
    const alreadyNet = prior?.net_cents ?? 0n;
    const alreadyVat = prior?.vat_cents ?? 0n;
    let amounts: SalesLineAmounts;
    if (quantity === remainingQty) {
      const net = line.net_cents - alreadyNet;
      const vat = line.vat_cents - alreadyVat;
      const discount = line.discount_cents - alreadyDiscount;
      amounts = {
        extendedCents: net + (discount < 0n ? 0n : discount),
        discountCents: discount < 0n ? 0n : discount,
        netCents: net,
        vatCents: vat,
        totalCents: net + vat,
      };
    } else {
      const discount = creditDiscountCents({
        originalQuantity: originalQty,
        originalDiscountCents: line.discount_cents,
        alreadyCreditedQuantity: alreadyQty,
        alreadyCreditedDiscountCents: alreadyDiscount,
        quantity,
      });
      amounts = salesLineAmounts({
        quantity,
        unitPriceCents: line.unit_price_cents,
        discountCents: discount,
        vatBasisPoints: invoice.vat_rate_basis_points,
      });
    }
    priced.push({
      itemId: line.item_id,
      description: line.description,
      quantity,
      unitPriceCents: line.unit_price_cents,
      amounts,
    });
    sourceIds.push(line.id);
  }
  if (priced.length < 1) {
    throw new SalesError('Enter a quantity to credit.');
  }
  const totals = sumSalesLines(priced.map((line) => line.amounts));
  const open = await invoiceBalance(tx, invoiceId);
  if (totals.totalCents > open.balance) {
    throw new SalesError('This credit is more than the amount still owed.');
  }
  const creditId = randomUUID();
  await tx.db.execute(sql`
    INSERT INTO o2c_documents (
      id, tenant_id, kind, status, party_id, customer_name, customer_vat, customer_address,
      customer_contact, vat_rate_basis_points, net_cents, vat_cents, total_cents,
      notes, invoice_id, created_by
    ) VALUES (
      ${creditId}, ${tx.tenantId}, 'credit_note', 'draft', ${invoice.party_id},
      ${invoice.customer_name}, ${invoice.customer_vat}, ${invoice.customer_address},
      ${invoice.customer_contact}, ${invoice.vat_rate_basis_points}, ${totals.netCents},
      ${totals.vatCents}, ${totals.totalCents}, ${''}, ${invoiceId}, ${actor.userId}
    )
  `);
  const lineIds = await insertLines(
    tx,
    creditId,
    priced,
    (_line, index) => sourceIds[index] ?? null,
  );
  void lineIds;
  const number = await issueDraft(tx, actor, creditId, 'credit_note', false, priced, []);
  await audit(tx, actor, 'sales.credit_note.issued', 'o2c_document', creditId, {
    number,
    invoiceId,
    totalCents: totals.totalCents.toString(),
  });
  return getDocument(tx, actor, creditId);
}

/** An open invoice brought in from another system. It posts to Opening Balance Equity. */
export async function importOpeningInvoice(
  tx: TenantTransaction,
  actor: Actor,
  input: {
    partyId: string;
    number: string;
    issuedOn: string;
    dueOn: string;
    amountCents: bigint;
  },
) {
  const number = input.number.trim();
  if (number.length < 1 || number.length > 40) {
    throw new SalesError('Enter the invoice number.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
    throw new SalesError('Enter the invoice date and the due date.');
  }
  if (input.dueOn < input.issuedOn) {
    throw new SalesError('The due date is before the invoice date.');
  }
  if (input.amountCents <= 0n) {
    throw new SalesError('Enter an amount above zero.');
  }
  const existing = await one<{
    id: string;
    total_cents: bigint;
    party_id: string;
    issued_on: string;
  }>(
    tx,
    sql`
      SELECT id, total_cents, party_id, issued_on::text AS issued_on
      FROM o2c_documents
      WHERE kind = 'invoice' AND number = ${number}
    `,
  );
  if (existing) {
    if (
      existing.party_id === input.partyId &&
      existing.total_cents === input.amountCents &&
      existing.issued_on === input.issuedOn
    ) {
      return existing.id;
    }
    throw new SalesError('That invoice number is already used.');
  }
  const customer = await customerSnapshot(tx, input.partyId);
  const id = randomUUID();
  const amount = input.amountCents;
  await tx.db.execute(sql`
    INSERT INTO o2c_documents (
      id, tenant_id, kind, status, origin, party_id, customer_name, customer_vat,
      customer_address, customer_contact, vat_rate_basis_points, net_cents, vat_cents,
      total_cents, notes, created_by
    ) VALUES (
      ${id}, ${tx.tenantId}, 'invoice', 'draft', 'opening', ${customer.partyId},
      ${customer.name}, ${customer.vat}, ${customer.address}, ${customer.contact},
      0, ${amount}, ${0n}, ${amount}, ${'Opening balance'}, ${actor.userId}
    )
  `);
  await tx.db.execute(sql`
    INSERT INTO o2c_lines (
      tenant_id, document_id, position, description, quantity, unit_price_cents,
      discount_cents, net_cents, vat_cents, total_cents
    ) VALUES (
      ${tx.tenantId}, ${id}, 0, ${'Opening balance'}, 1, ${amount}, 0, ${amount}, 0, ${amount}
    )
  `);
  await tx.db.execute(sql`
    UPDATE o2c_documents
    SET status = 'issued', number = ${number}, issued_on = ${input.issuedOn}::date,
        due_on = ${input.dueOn}::date, issued_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'draft'
  `);
  await postSalesDocument(tx, actor, id);
  await audit(tx, actor, 'sales.invoice.opening', 'o2c_document', id, {
    number,
    totalCents: amount.toString(),
    issuedOn: input.issuedOn,
  });
  return id;
}

export async function listCatalog(tx: TenantTransaction, actor: Actor, query: string) {
  await assertQuoteRead(tx, actor.userId).catch(async () => {
    await assertInvoiceRead(tx, actor.userId);
  });
  const q = query.trim().slice(0, 80);
  const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = await many<{
    id: string;
    sku: string;
    name: string;
    kind: string;
    unit: string;
    price: bigint;
    barcode: string | null;
  }>(
    tx,
    sql`
      SELECT id, sku, name, kind, base_uom AS unit, selling_price_cents AS price, barcode
      FROM scm01_items
      WHERE status = 'active'
        AND (
          ${q} = ''
          OR name ILIKE ${like} ESCAPE '\\'
          OR sku ILIKE ${like} ESCAPE '\\'
          OR barcode ILIKE ${like} ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN lower(barcode) = lower(${q}) THEN 0
          WHEN lower(sku) = lower(${q}) THEN 1
          ELSE 2
        END,
        name
      LIMIT 40
    `,
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      code: row.sku,
      name: row.name,
      kind: row.kind,
      unit: row.unit,
      barcode: row.barcode ?? '',
      unitPrice: centsToDecimal(row.price),
    })),
  };
}

export async function companyForPdf(tx: TenantTransaction) {
  return one<{
    company_name: string;
    vat_number: string | null;
    address_line1: string | null;
    address_line2: string | null;
    address_city: string | null;
    address_province: string | null;
    address_postal_code: string | null;
    brand_primary: string;
    logo_storage_key: string | null;
  }>(
    tx,
    sql`
      SELECT
        COALESCE(NULLIF(company_name, ''), display_name) AS company_name,
        vat_number, address_line1, address_line2, address_city, address_province,
        address_postal_code, brand_primary, logo_storage_key
      FROM tenants
    `,
  );
}

export async function bankingForPdf(tx: TenantTransaction) {
  return one<{
    bank_name: string;
    account_name: string;
    account_number: string;
    branch_code: string;
  }>(
    tx,
    sql`
      SELECT bank_name, account_name, account_number, branch_code
      FROM o2c_settings
    `,
  );
}
