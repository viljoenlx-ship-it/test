import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { tenantId, withTenant, type TenantTransaction } from '@omnivate/kernel';
import { registerBuiltinReader, registerEntityType } from '@omnivate/module-krn-04';
import { centsToDecimal, johannesburgToday, type FormulaNumber } from '@omnivate/shared';
import { salesAccess, type Actor } from './access';
import { getCustomer, listCustomers, saveCustomer, type CustomerInput } from './customers';
import {
  convertQuote,
  getDocument,
  issueCreditNote,
  issueInvoice,
  listCatalog,
  listInvoices,
  listQuotes,
  saveInvoice,
  saveQuote,
  setQuoteStatus,
  type InvoiceInput,
  type LineInput,
  type QuoteInput,
} from './documents';
import { HttpError, readBody, readText, requireActor, route } from './http';
import { openInvoicesForCustomer, recordPayment, type PaymentInput } from './payments';
import { renderDocumentPdf } from './pdf';
import { audit, one } from './rows';
import { customerStatement } from './statement';
import { reminderStageForDaysOverdue } from './domain';
import './sources';

const moneyFields = [
  { key: 'total', label: 'Total', kind: 'money' as const },
  { key: 'vat', label: 'VAT', kind: 'money' as const },
];

registerEntityType({
  key: 'sal.quote',
  moduleId: 'SAL-01',
  label: 'Quote',
  description: 'A price a customer can accept.',
  numericFields: moneyFields,
});
registerEntityType({
  key: 'fin.invoice',
  moduleId: 'FIN-02',
  label: 'Tax Invoice',
  description: 'A tax invoice issued to a customer.',
  numericFields: moneyFields,
});
registerEntityType({
  key: 'fin.credit_note',
  moduleId: 'FIN-02',
  label: 'Credit Note',
  description: 'A credit note against a tax invoice.',
  numericFields: moneyFields,
});
registerEntityType({
  key: 'sal.customer',
  moduleId: 'SAL-01',
  label: 'Customer',
  description: 'A customer on a quote or tax invoice.',
});

async function readMoney(
  tx: TenantTransaction,
  id: string,
): Promise<Record<string, FormulaNumber>> {
  const row = await one<{ total: bigint; vat: bigint }>(
    tx,
    sql`SELECT total_cents AS total, vat_cents AS vat FROM o2c_documents WHERE id = ${id}`,
  );
  return {
    total: { kind: 'money', text: row ? row.total.toString() : null },
    vat: { kind: 'money', text: row ? row.vat.toString() : null },
  };
}

registerBuiltinReader('sal.quote', readMoney);
registerBuiltinReader('fin.invoice', readMoney);
registerBuiltinReader('fin.credit_note', readMoney);

function linesOf(value: unknown): LineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'bad_request', 'Add at least one line.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'bad_request', 'A line was not understood.');
    }
    const row = entry as Record<string, unknown>;
    return {
      itemId: readText(row.itemId) || null,
      description: readText(row.description),
      quantity: readText(row.quantity),
      unitPrice: readText(row.unitPrice),
      discount: readText(row.discount),
    };
  });
}

function customFields(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function quoteInput(body: Record<string, unknown>): QuoteInput {
  return {
    customerId: readText(body.customerId),
    lines: linesOf(body.lines),
    notes: readText(body.notes),
    validUntil: readText(body.validUntil) || null,
    customFields: customFields(body.customFields),
  };
}

function invoiceInput(body: Record<string, unknown>): InvoiceInput {
  return {
    customerId: readText(body.customerId),
    lines: linesOf(body.lines),
    notes: readText(body.notes),
    dueOn: readText(body.dueOn) || null,
    customFields: customFields(body.customFields),
  };
}

function customerInput(body: Record<string, unknown>): CustomerInput {
  return {
    name: readText(body.name),
    vatNumber: readText(body.vatNumber),
    line1: readText(body.line1),
    line2: readText(body.line2),
    suburb: readText(body.suburb),
    city: readText(body.city),
    province: readText(body.province),
    postalCode: readText(body.postalCode),
    contactName: readText(body.contactName),
    email: readText(body.email),
    phone: readText(body.phone),
    paymentTermsDays: readText(body.paymentTermsDays),
    creditLimit: readText(body.creditLimit),
    creditHold: body.creditHold === true,
    creditHoldReason: readText(body.creditHoldReason),
    customFields: customFields(body.customFields),
  };
}

function paymentInput(body: Record<string, unknown>): PaymentInput {
  if (!Array.isArray(body.allocations)) {
    throw new HttpError(400, 'bad_request', 'Allocate the payment to an invoice.');
  }
  return {
    customerId: readText(body.customerId),
    paidOn: readText(body.paidOn),
    amount: readText(body.amount),
    method: readText(body.method),
    reference: readText(body.reference),
    allocations: body.allocations.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new HttpError(400, 'bad_request', 'An allocation was not understood.');
      }
      const row = entry as Record<string, unknown>;
      return { invoiceId: readText(row.invoiceId), amount: readText(row.amount) };
    }),
  };
}

function actorOf(actor: Actor): Actor {
  return actor;
}

/** Registers SAL-01 quotes and FIN-02 debtors on the shared API. */
export async function registerO2c(app: FastifyInstance): Promise<void> {
  app.get(
    '/sales/access',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        salesAccess(tx, actor.userId),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/sales/customers',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { q?: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        listCustomers(tx, actorOf(actor), typeof query.q === 'string' ? query.q : ''),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/customers',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveCustomer(tx, actor, null, customerInput(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/customers/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) => getCustomer(tx, actor, id));
      await reply.send(body);
    }),
  );

  app.patch(
    '/sales/customers/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveCustomer(tx, actor, id, customerInput(readBody(request))),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/sales/customers/:id/statement',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        customerStatement(tx, actor, id),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/sales/catalog',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { q?: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        listCatalog(tx, actor, typeof query.q === 'string' ? query.q : ''),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/sales/quotes',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { status?: string; q?: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        listQuotes(tx, actor, readText(query.status) || 'all', readText(query.q)),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/quotes',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveQuote(tx, actor, null, quoteInput(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/quotes/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) => getDocument(tx, actor, id));
      await reply.send(body);
    }),
  );

  app.patch(
    '/sales/quotes/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveQuote(tx, actor, id, quoteInput(readBody(request))),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/quotes/:id/status',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const status = readText(readBody(request).status);
      if (status !== 'sent' && status !== 'accepted' && status !== 'declined') {
        throw new HttpError(400, 'bad_request', 'Choose sent, accepted, or declined.');
      }
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        setQuoteStatus(tx, actor, id, status),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/quotes/:id/invoice',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const deduct = readBody(request).deductStock === true;
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        convertQuote(tx, actor, id, deduct),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/invoices',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const query = request.query as { status?: string; q?: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        listInvoices(tx, actor, readText(query.status) || 'all', readText(query.q)),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/invoices',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveInvoice(tx, actor, null, invoiceInput(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/invoices/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) => getDocument(tx, actor, id));
      await reply.send(body);
    }),
  );

  app.patch(
    '/sales/invoices/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveInvoice(tx, actor, id, invoiceInput(readBody(request))),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/invoices/:id/issue',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const deduct = readBody(request).deductStock === true;
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        issueInvoice(tx, actor, id, deduct),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/invoices/:id/credit-notes',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const raw = readBody(request).lines;
      if (!Array.isArray(raw)) {
        throw new HttpError(400, 'bad_request', 'Choose the lines to credit.');
      }
      const lines = raw.map((entry) => {
        if (!entry || typeof entry !== 'object') {
          throw new HttpError(400, 'bad_request', 'A credit line was not understood.');
        }
        const row = entry as Record<string, unknown>;
        return { lineId: readText(row.lineId), quantity: readText(row.quantity) };
      });
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        issueCreditNote(tx, actor, id, lines),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/invoices/:id/open',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const document = await getDocument(tx, actor, id);
        return openInvoicesForCustomer(tx, actor, document.customerId);
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/payments',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        recordPayment(tx, actor, paymentInput(readBody(request))),
      );
      await reply.code(201).send(body);
    }),
  );

  app.get(
    '/sales/reminders',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const access = await salesAccess(tx, actor.userId);
        if (!access.invoices) throw new HttpError(403, 'forbidden', 'Your role cannot open debtor reminders.');
        const rows = await tx.db.execute(sql`
          SELECT r.id, r.reminder_stage, r.status, r.recipient_email, r.subject, r.message, r.queued_at::text,
            d.number AS invoice_number, d.customer_name, d.due_on::text, d.total_cents::text
          FROM o2c_reminders r JOIN o2c_documents d ON d.id=r.invoice_id
          ORDER BY r.queued_at DESC LIMIT 250
        `);
        return { reminders: (rows as { rows: Record<string, unknown>[] }).rows };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/reminders/generate',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const access = await salesAccess(tx, actor.userId);
        if (!access.issueInvoices) throw new HttpError(403, 'forbidden', 'Your role cannot generate debtor reminders.');
        const today = johannesburgToday();
        const candidates = await tx.db.execute(sql`
          SELECT d.id, d.number, d.customer_name, d.due_on::text AS due_on, d.total_cents,
            COALESCE(c.email, '') AS email,
            GREATEST(d.total_cents - COALESCE(cr.credited,0) - COALESCE(pa.paid,0),0)::bigint AS balance,
            ${today}::date-d.due_on AS days_overdue
          FROM o2c_documents d
          LEFT JOIN LATERAL (SELECT email FROM party_contacts WHERE party_id=d.party_id AND is_primary ORDER BY created_at LIMIT 1) c ON true
          LEFT JOIN (SELECT invoice_id,SUM(total_cents)::bigint AS credited FROM o2c_documents WHERE kind='credit_note' AND status='issued' GROUP BY invoice_id) cr ON cr.invoice_id=d.id
          LEFT JOIN (SELECT invoice_id,SUM(amount_cents)::bigint AS paid FROM o2c_allocations GROUP BY invoice_id) pa ON pa.invoice_id=d.id
          WHERE d.kind='invoice' AND d.status='issued' AND d.due_on<${today}::date
          ORDER BY d.due_on ASC LIMIT 500
        `);
        const rows = (candidates as { rows: Array<Record<string, any>> }).rows;
        let queued = 0;
        for (const invoice of rows) {
          const balance = BigInt(invoice.balance ?? 0);
          if (balance <= 0n) continue;
          const days = Number(invoice.days_overdue ?? 0);
          const stage = reminderStageForDaysOverdue(days);
          if (!stage) continue;
          const subject = `${stage === 'final' ? 'Final reminder' : stage === 'second' ? 'Payment reminder' : 'Overdue invoice'}: ${invoice.number}`;
          const message = `Dear ${invoice.customer_name},\n\nInvoice ${invoice.number} was due on ${invoice.due_on}. The outstanding balance is R ${centsToDecimal(balance)}. Please arrange payment or contact us if you have already paid.\n\nThank you.`;
          const inserted = await tx.db.execute(sql`
            INSERT INTO o2c_reminders (tenant_id, invoice_id, reminder_stage, recipient_email, subject, message, queued_by)
            VALUES (${tx.tenantId}, ${invoice.id}, ${stage}, ${String(invoice.email ?? '')}, ${subject}, ${message}, ${actor.userId})
            ON CONFLICT (tenant_id, invoice_id, reminder_stage) DO NOTHING RETURNING id
          `);
          const insertedRow = (inserted as { rows: Array<{ id: string }> }).rows[0];
          if (insertedRow) {
            queued++;
            await audit(tx, actor, 'sales.debtor_reminder.queued', 'o2c_reminder', insertedRow.id, { invoiceId: String(invoice.id), stage, recipient: String(invoice.email ?? '') });
          }
        }
        return { queued, checked: rows.length, note: 'Reminders are queued for review; this action does not send email.' };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/sales/reminders/:id/sent',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const access = await salesAccess(tx, actor.userId);
        if (!access.issueInvoices) throw new HttpError(403, 'forbidden', 'Your role cannot update debtor reminders.');
        const result = await tx.db.execute(sql`
          UPDATE o2c_reminders SET status='sent', sent_by=${actor.userId}, sent_at=now()
          WHERE id=${id} AND status='queued' RETURNING id, status, sent_at::text
        `);
        const row = (result as { rows: Record<string, unknown>[] }).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Queued reminder not found.');
        await audit(tx, actor, 'sales.debtor_reminder.marked_sent', 'o2c_reminder', id, { status: 'sent' });
        return row;
      });
      await reply.send(body);
    }),
  );

  app.get(
    '/sales/documents/:id/pdf',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const file = await withTenant(tenantId(actor.tenantId), (tx) =>
        renderDocumentPdf(tx, actor, id),
      );
      await reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${file.filename}"`)
        .send(file.body);
    }),
  );
}
