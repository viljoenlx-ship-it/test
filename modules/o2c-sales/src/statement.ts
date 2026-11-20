import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import {
  agingBucket,
  daysBetween,
  formatZar,
  invoiceStatusLabel,
  johannesburgToday,
  money,
} from '@omnivate/shared';
import { assertInvoiceRead, type Actor } from './access';
import { customerSnapshot } from './customers';
import { invoiceBalance } from './documents';
import { many } from './rows';

export async function customerStatement(tx: TenantTransaction, actor: Actor, customerId: string) {
  await assertInvoiceRead(tx, actor.userId);
  const customer = await customerSnapshot(tx, customerId);
  const today = johannesburgToday();
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
  const buckets = { current: 0n, days_30: 0n, days_60: 0n, days_90: 0n };
  const openItems = [];
  for (const row of rows) {
    const open = await invoiceBalance(tx, row.id);
    if (open.balance <= 0n) {
      continue;
    }
    const age = daysBetween(row.issued_on, today);
    const bucket = agingBucket(age);
    buckets[bucket] += open.balance;
    openItems.push({
      id: row.id,
      number: row.number,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      ageDays: age,
      bucket,
      total: formatZar(money(row.total_cents)),
      balance: formatZar(money(open.balance)),
      statusLabel: invoiceStatusLabel({
        totalCents: row.total_cents,
        balanceCents: open.balance,
        allocatedCents: open.allocated,
        dueOn: row.due_on ?? row.issued_on,
        today,
      }),
    });
  }
  const total = buckets.current + buckets.days_30 + buckets.days_60 + buckets.days_90;
  return {
    customer: {
      id: customer.partyId,
      name: customer.name,
      vatNumber: customer.vat,
      address: customer.address,
      contact: customer.contact,
      paymentTermsDays: customer.termsDays,
    },
    asAt: today,
    openItems,
    aging: {
      current: formatZar(money(buckets.current)),
      days30: formatZar(money(buckets.days_30)),
      days60: formatZar(money(buckets.days_60)),
      days90: formatZar(money(buckets.days_90)),
      total: formatZar(money(total)),
    },
  };
}
