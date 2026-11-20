import { registerReportSource } from '@omnivate/module-ana-03';
import type { ReportAggregate, ReportFieldType } from '@omnivate/shared';
import type { ReportField } from '@omnivate/module-ana-03';

const NUMERIC: ReportAggregate[] = ['sum', 'count', 'avg', 'min', 'max'];
const TEXT: ReportAggregate[] = ['count', 'min', 'max'];

function field(
  key: string,
  label: string,
  type: ReportFieldType,
  expr: string,
  groupable = type === 'text' || type === 'date',
): ReportField {
  return {
    key,
    label,
    type,
    expr,
    aggregations: type === 'money' || type === 'number' ? NUMERIC : TEXT,
    filterable: true,
    groupable,
  };
}

const openInvoices = `
  SELECT
    doc.id,
    doc.tenant_id,
    party.display_name AS customer_name,
    doc.number AS invoice_number,
    doc.issued_on,
    doc.due_on,
    doc.total_cents,
    COALESCE(pay.paid_cents, 0)::bigint AS paid_cents,
    GREATEST(
      doc.total_cents - COALESCE(cr.credited_cents, 0) - COALESCE(pay.paid_cents, 0),
      0
    )::bigint AS balance_cents,
    CASE
      WHEN GREATEST(doc.total_cents - COALESCE(cr.credited_cents, 0) - COALESCE(pay.paid_cents, 0), 0) = 0 THEN 'Paid'
      WHEN doc.due_on < CURRENT_DATE THEN 'Overdue'
      WHEN COALESCE(pay.paid_cents, 0) > 0 THEN 'Partly Paid'
      ELSE 'Unpaid'
    END AS status_label
  FROM o2c_documents AS doc
  JOIN parties AS party ON party.id = doc.party_id
  LEFT JOIN (
    SELECT invoice_id, SUM(total_cents)::bigint AS credited_cents
    FROM o2c_documents
    WHERE kind = 'credit_note' AND status = 'issued'
    GROUP BY invoice_id
  ) AS cr ON cr.invoice_id = doc.id
  LEFT JOIN (
    SELECT invoice_id, SUM(amount_cents)::bigint AS paid_cents
    FROM o2c_allocations
    GROUP BY invoice_id
  ) AS pay ON pay.invoice_id = doc.id
  WHERE doc.kind = 'invoice' AND doc.status = 'issued'`;

const invoiceFrom = `(${openInvoices}) AS inv`;

const agedFrom = `(
  SELECT
    customer_name,
    invoice_number,
    issued_on,
    balance_cents,
    CASE WHEN (CURRENT_DATE - issued_on) <= 30 THEN balance_cents ELSE 0 END AS current_cents,
    CASE WHEN (CURRENT_DATE - issued_on) BETWEEN 31 AND 60 THEN balance_cents ELSE 0 END AS days_30_cents,
    CASE WHEN (CURRENT_DATE - issued_on) BETWEEN 61 AND 90 THEN balance_cents ELSE 0 END AS days_60_cents,
    CASE WHEN (CURRENT_DATE - issued_on) > 90 THEN balance_cents ELSE 0 END AS days_90_cents
  FROM (${openInvoices}) AS open_inv
  WHERE balance_cents > 0
) AS aged`;

registerReportSource({
  key: 'customer_invoices',
  label: 'Customer Invoices',
  description: 'Issued tax invoices, with what has been paid and what is still open.',
  moduleId: 'FIN-02',
  read: { scope: 'fin.ledger', moduleId: 'FIN-02' },
  fromSql: invoiceFrom,
  joins: [{ key: 'customer', label: 'Customer' }],
  entityType: 'fin.invoice',
  customJoin: `LEFT JOIN krn04_field_values AS cf ON cf.entity_id = inv.id AND cf.entity_type = 'fin.invoice' AND cf.tenant_id = inv.tenant_id`,
  defaultColumns: ['number', 'customer', 'issued', 'total', 'balance', 'status'],
  fields: [
    field('customer', 'Customer', 'text', 'inv.customer_name'),
    field('number', 'Invoice', 'text', 'inv.invoice_number'),
    field('issued', 'Date', 'date', 'inv.issued_on'),
    field('due', 'Due', 'date', 'inv.due_on'),
    field('total', 'Total', 'money', 'inv.total_cents'),
    field('paid', 'Paid', 'money', 'inv.paid_cents'),
    field('balance', 'Balance', 'money', 'inv.balance_cents'),
    field('status', 'Status', 'text', 'inv.status_label'),
  ],
});

registerReportSource({
  key: 'customer_payments',
  label: 'Customer Payments',
  description: 'Receipts from customers, by date, method, and amount.',
  moduleId: 'FIN-02',
  read: { scope: 'fin.ledger', moduleId: 'FIN-02' },
  fromSql: `o2c_payments AS pay
    JOIN parties AS party ON party.id = pay.party_id`,
  joins: [{ key: 'customer', label: 'Customer' }],
  defaultColumns: ['paid_on', 'customer', 'method', 'reference', 'amount'],
  fields: [
    field('paid_on', 'Date', 'date', 'pay.paid_on'),
    field('customer', 'Customer', 'text', 'party.display_name'),
    field(
      'method',
      'Method',
      'text',
      `CASE pay.method WHEN 'eft' THEN 'EFT' WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' ELSE pay.method END`,
    ),
    field('reference', 'Reference', 'text', 'pay.reference'),
    field('amount', 'Amount', 'money', 'pay.amount_cents'),
  ],
});

registerReportSource({
  key: 'aged_debtors',
  label: 'Aged Debtors',
  description: 'Open tax invoices aged 30, 60, and 90 days from the invoice date.',
  moduleId: 'FIN-02',
  read: { scope: 'fin.ledger', moduleId: 'FIN-02' },
  fromSql: agedFrom,
  joins: [{ key: 'customer', label: 'Customer' }],
  defaultColumns: ['customer', 'current', 'days_30', 'days_60', 'days_90', 'balance'],
  fields: [
    field('customer', 'Customer', 'text', 'aged.customer_name'),
    field('number', 'Invoice', 'text', 'aged.invoice_number'),
    field('issued', 'Date', 'date', 'aged.issued_on'),
    field('current', 'Current', 'money', 'aged.current_cents'),
    field('days_30', '30 Days', 'money', 'aged.days_30_cents'),
    field('days_60', '60 Days', 'money', 'aged.days_60_cents'),
    field('days_90', '90 Days And Over', 'money', 'aged.days_90_cents'),
    field('balance', 'Balance', 'money', 'aged.balance_cents'),
  ],
});
