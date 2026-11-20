import {
  bigint,
  boolean,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const settings = pgTable('doc_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  enabled: boolean('enabled').notNull(),
  reader: text('reader').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const documents = pgTable('doc_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  status: text('status').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  pageCount: integer('page_count').notNull(),
  billedAt: timestamp('billed_at', { withTimezone: true, mode: 'date' }),
  storageKey: text('storage_key').notNull(),
  documentType: text('document_type'),
  supplierName: text('supplier_name').notNull(),
  supplierVat: text('supplier_vat').notNull(),
  partyId: uuid('party_id'),
  supplierMatch: text('supplier_match').notNull(),
  documentNumber: text('document_number').notNull(),
  documentDate: date('document_date'),
  dueDate: date('due_date'),
  currencyCode: char('currency_code', { length: 3 }).notNull(),
  subtotalCents: bigint('subtotal_cents', { mode: 'bigint' }),
  vatCents: bigint('vat_cents', { mode: 'bigint' }),
  totalCents: bigint('total_cents', { mode: 'bigint' }),
  fieldConfidence: jsonb('field_confidence').notNull(),
  extracted: jsonb('extracted').notNull(),
  branchId: uuid('branch_id'),
  goodsReceiptId: uuid('goods_receipt_id'),
  failureMessage: text('failure_message'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const lines = pgTable(
  'doc_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    lineNo: integer('line_no').notNull(),
    description: text('description').notNull(),
    supplierCode: text('supplier_code').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
    unit: text('unit').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'bigint' }),
    vatCents: bigint('vat_cents', { mode: 'bigint' }),
    lineTotalCents: bigint('line_total_cents', { mode: 'bigint' }),
    itemId: uuid('item_id'),
    matchMethod: text('match_method').notNull(),
    fieldConfidence: jsonb('field_confidence').notNull(),
  },
  (table) => [unique('doc_lines_number').on(table.tenantId, table.documentId, table.lineNo)],
);

export const supplierCodes = pgTable(
  'doc_supplier_codes',
  {
    tenantId: uuid('tenant_id').notNull(),
    partyId: uuid('party_id').notNull(),
    supplierCode: text('supplier_code').notNull(),
    itemId: uuid('item_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.partyId, table.supplierCode] })],
);

export const receiptLinks = pgTable(
  'doc_receipt_links',
  {
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    lineId: uuid('line_id').notNull(),
    movementId: uuid('movement_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lineId] })],
);

export const pageUsage = pgTable(
  'doc_page_usage',
  {
    tenantId: uuid('tenant_id').notNull(),
    period: text('period').notNull(),
    reader: text('reader').notNull(),
    pages: integer('pages').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.period, table.reader] })],
);
