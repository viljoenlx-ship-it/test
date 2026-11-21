import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import {
  formatZar,
  isPaymentMethod,
  money,
  PAYMENT_METHOD_LABELS,
  zarFromDecimal,
} from '@omnivate/shared';
import { assertInvoiceRead, assertInvoiceWrite, type Actor } from './access';
import { SalesError } from './errors';
import { postCustomerPayment } from '@omnivate/module-fin-01';
import { invoiceBalance } from './documents';
import { isIsoCalendarDate } from './domain';
import { audit, many, one } from './rows';

export type PaymentInput = {
  customerId: string;
  paidOn: string;
  amount: string;
  method: string;
  reference: string;
  allocations: { invoiceId: string; amount: string }[];
};

function centsOf(value: string, label: string): bigint {
  try {
    const amount = zarFromDecimal(value.trim()).amountCents;
    if (amount <= 0n) {
      throw new Error(`Enter ${label} above zero.`);
    }
    return amount;
  } catch (error) {
    throw new SalesError(error instanceof Error ? error.message : `Enter ${label}.`);
  }
}

export async function recordPayment(tx: TenantTransaction, actor: Actor, input: PaymentInput) {
  await assertInvoiceWrite(tx, actor.userId);
  if (!isIsoCalendarDate(input.paidOn.trim())) {
    throw new SalesError('Enter the payment date.');
  }
  if (!isPaymentMethod(input.method)) {
    throw new SalesError('Choose EFT, cash, or card.');
  }
  const reference = input.reference.trim();
  if (reference.length > 80) {
    throw new SalesError('The reference is too long.');
  }
  const amount = centsOf(input.amount, 'the payment amount');
  if (input.allocations.length < 1) {
    throw new SalesError('Allocate the payment to an invoice.');
  }
  const seen = new Set<string>();
  let allocated = 0n;
  const rows: { invoiceId: string; amount: bigint }[] = [];
  for (const allocation of input.allocations) {
    if (seen.has(allocation.invoiceId)) {
      throw new SalesError('Allocate each invoice once.');
    }
    seen.add(allocation.invoiceId);
    const part = centsOf(allocation.amount, 'each allocation');
    const invoice = await one<{ id: string; party_id: string; status: string; number: string }>(
      tx,
      sql`
        SELECT id, party_id, status, number
        FROM o2c_documents
        WHERE id = ${allocation.invoiceId} AND kind = 'invoice'
      `,
    );
    if (!invoice || invoice.status !== 'issued') {
      throw new SalesError('Allocate a payment to an issued tax invoice.');
    }
    if (invoice.party_id !== input.customerId) {
      throw new SalesError('Every invoice on a payment must belong to the same customer.');
    }
    const open = await invoiceBalance(tx, invoice.id);
    if (part > open.balance) {
      throw new SalesError(`${invoice.number} only has ${formatZar(money(open.balance))} open.`);
    }
    allocated += part;
    rows.push({ invoiceId: invoice.id, amount: part });
  }
  if (allocated !== amount) {
    throw new SalesError('The allocations must add up to the payment.');
  }
  const paymentId = randomUUID();
  await tx.db.execute(sql`
    INSERT INTO o2c_payments (
      id, tenant_id, party_id, paid_on, amount_cents, method, reference, created_by
    ) VALUES (
      ${paymentId}, ${tx.tenantId}, ${input.customerId}, ${input.paidOn.trim()}::date,
      ${amount}, ${input.method}, ${reference}, ${actor.userId}
    )
  `);
  for (const row of rows) {
    await tx.db.execute(sql`
      INSERT INTO o2c_allocations (tenant_id, payment_id, invoice_id, amount_cents)
      VALUES (${tx.tenantId}, ${paymentId}, ${row.invoiceId}, ${row.amount})
    `);
  }
  await postCustomerPayment(tx, actor, paymentId);
  await audit(tx, actor, 'sales.payment.recorded', 'o2c_payment', paymentId, {
    amountCents: amount.toString(),
    method: input.method,
    invoices: rows.map((row) => row.invoiceId),
  });
  return {
    id: paymentId,
    amount: { cents: amount.toString(), label: formatZar(money(amount)) },
    method: PAYMENT_METHOD_LABELS[input.method],
  };
}

export async function openInvoicesForCustomer(
  tx: TenantTransaction,
  actor: Actor,
  customerId: string,
) {
  await assertInvoiceRead(tx, actor.userId);
  const rows = await many<{
    id: string;
    number: string;
    issued_on: string;
    due_on: string | null;
    total_cents: bigint;
  }>(
    tx,
    sql`
      SELECT id, number, issued_on::text AS issued_on, due_on::text AS due_on, total_cents
      FROM o2c_documents
      WHERE kind = 'invoice' AND status = 'issued' AND party_id = ${customerId}
      ORDER BY issued_on, number
    `,
  );
  const invoices = [];
  for (const row of rows) {
    const open = await invoiceBalance(tx, row.id);
    if (open.balance <= 0n) {
      continue;
    }
    invoices.push({
      id: row.id,
      number: row.number,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      balance: { cents: open.balance.toString(), label: formatZar(money(open.balance)) },
    });
  }
  return { invoices };
}
