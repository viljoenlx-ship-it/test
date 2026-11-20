import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

function quantity(name = 'quantity') {
  return numeric(name, { precision: 18, scale: 4 });
}

export const settings = pgTable('scm01_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  labelWidthMm: numeric('label_width_mm', { precision: 6, scale: 2 }).notNull(),
  labelHeightMm: numeric('label_height_mm', { precision: 6, scale: 2 }).notNull(),
  labelPrinter: text('label_printer').notNull(),
  adjustmentApprovalCents: bigint('adjustment_approval_cents', { mode: 'bigint' }).notNull(),
});

export const items = pgTable(
  'scm01_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    kind: text('kind').notNull(),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    baseUom: text('base_uom').notNull(),
    baseUomPlural: text('base_uom_plural').notNull(),
    costCents: bigint('cost_cents', { mode: 'bigint' }).notNull(),
    sellingPriceCents: bigint('selling_price_cents', { mode: 'bigint' }).notNull(),
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull(),
    reorderLevel: numeric('reorder_level', { precision: 18, scale: 4 }).notNull(),
    trackBatches: boolean('track_batches').notNull(),
    trackSerials: boolean('track_serials').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('scm01_items_sku').on(table.tenantId, table.sku)],
);

export const itemUoms = pgTable(
  'scm01_item_uoms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    itemId: uuid('item_id').notNull(),
    name: text('name').notNull(),
    plural: text('plural').notNull(),
    factorToBase: numeric('factor_to_base', { precision: 18, scale: 4 }).notNull(),
  },
  (table) => [unique('scm01_item_uoms_name').on(table.tenantId, table.itemId, table.name)],
);

export const batches = pgTable(
  'scm01_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    itemId: uuid('item_id').notNull(),
    code: text('code').notNull(),
    expiresOn: date('expires_on'),
  },
  (table) => [unique('scm01_batches_code').on(table.tenantId, table.itemId, table.code)],
);

export const serials = pgTable(
  'scm01_serials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    itemId: uuid('item_id').notNull(),
    serial: text('serial').notNull(),
    branchId: uuid('branch_id'),
    status: text('status').notNull(),
  },
  (table) => [unique('scm01_serials_serial').on(table.tenantId, table.itemId, table.serial)],
);

export const movements = pgTable('scm01_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  kind: text('kind').notNull(),
  quantity: quantity().notNull(),
  uomName: text('uom_name').notNull(),
  uomPlural: text('uom_plural').notNull(),
  uomFactor: numeric('uom_factor', { precision: 18, scale: 4 }).notNull(),
  enteredQuantity: numeric('entered_quantity', { precision: 18, scale: 4 }).notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'bigint' }).notNull(),
  valueCents: bigint('value_cents', { mode: 'bigint' }).notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  reversesMovementId: uuid('reverses_movement_id'),
  transferGroupId: uuid('transfer_group_id'),
  batchId: uuid('batch_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorId: uuid('actor_id'),
});

export const movementSerials = pgTable(
  'scm01_movement_serials',
  {
    tenantId: uuid('tenant_id').notNull(),
    movementId: uuid('movement_id').notNull(),
    serialId: uuid('serial_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.movementId, table.serialId] })],
);

export const balances = pgTable(
  'scm01_balances',
  {
    tenantId: uuid('tenant_id').notNull(),
    itemId: uuid('item_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    quantity: quantity().notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.itemId, table.branchId] })],
);

export const batchBalances = pgTable(
  'scm01_batch_balances',
  {
    tenantId: uuid('tenant_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    quantity: quantity().notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.batchId, table.branchId] })],
);

export const adjustmentRequests = pgTable('scm01_adjustment_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  quantity: quantity().notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'bigint' }).notNull(),
  valueCents: bigint('value_cents', { mode: 'bigint' }).notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  movementId: uuid('movement_id'),
  requestedBy: uuid('requested_by').notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const goodsReceipts = pgTable(
  'scm01_goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    number: text('number').notNull(),
    branchId: uuid('branch_id').notNull(),
    note: text('note').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    actorId: uuid('actor_id'),
  },
  (table) => [unique('scm01_goods_receipts_number').on(table.tenantId, table.number)],
);

export const goodsReceiptLines = pgTable(
  'scm01_goods_receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    goodsReceiptId: uuid('goods_receipt_id').notNull(),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').notNull(),
    movementId: uuid('movement_id').notNull(),
    quantity: quantity().notNull(),
  },
  (table) => [
    unique('scm01_goods_receipt_lines_no').on(table.tenantId, table.goodsReceiptId, table.lineNo),
    unique('scm01_goods_receipt_lines_movement').on(table.movementId),
  ],
);

export const labelPrints = pgTable('scm01_label_prints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  goodsReceiptId: uuid('goods_receipt_id').notNull(),
  itemId: uuid('item_id').notNull(),
  copies: integer('copies').notNull(),
  barcode: text('barcode').notNull(),
  printedAt: timestamp('printed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorId: uuid('actor_id'),
});

export const pendingPostings = pgTable('scm01_pending_postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  movementId: uuid('movement_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  memo: text('memo').notNull(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  signedValueCents: bigint('signed_value_cents', { mode: 'bigint' }).notNull(),
  currencyCode: text('currency_code').notNull(),
  debitAccount: text('debit_account').notNull(),
  creditAccount: text('credit_account').notNull(),
  quantity: quantity().notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'bigint' }).notNull(),
});
