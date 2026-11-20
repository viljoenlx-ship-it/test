import type { ReportAggregate, ReportFieldType } from '@omnivate/shared';
import { registerReportSource } from './registry';
import type { ReportField, ReportSource } from './types';

const NUMERIC: ReportAggregate[] = ['sum', 'count', 'avg', 'min', 'max'];
const TEXT: ReportAggregate[] = ['count', 'min', 'max'];

function field(
  key: string,
  label: string,
  type: ReportFieldType,
  expr: string,
  options: { sensitive?: 'cost'; groupable?: boolean; display?: 'action' } = {},
): ReportField {
  const numeric = type === 'number' || type === 'money';
  return {
    key,
    label,
    type,
    expr,
    aggregations: numeric ? NUMERIC : TEXT,
    filterable: true,
    groupable: options.groupable ?? !numeric,
    sensitive: options.sensitive,
    display: options.display,
  };
}

function source(input: ReportSource): void {
  registerReportSource(input);
}

const kindLabel = `CASE item.kind WHEN 'stock' THEN 'Stock' WHEN 'service' THEN 'Service' WHEN 'non_stock' THEN 'Non-Stock' ELSE item.kind END`;
const statusLabel = `CASE item.status WHEN 'active' THEN 'Active' WHEN 'archived' THEN 'Archived' ELSE INITCAP(item.status) END`;
const moveKind = `CASE m.kind WHEN 'receipt' THEN 'Received' WHEN 'issue' THEN 'Issued' WHEN 'adjustment' THEN 'Adjustment' WHEN 'transfer_in' THEN 'Transfer In' WHEN 'transfer_out' THEN 'Transfer Out' WHEN 'reversal' THEN 'Reversal' ELSE INITCAP(m.kind) END`;
const johannesburgDay = `(m.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date`;
const receiptDay = `(receipt.received_at AT TIME ZONE 'Africa/Johannesburg')::date`;
const auditDay = `(ev.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date`;

source({
  key: 'stock_items',
  label: 'Stock Items',
  description: 'What is on hand at each branch. Cost and stock value follow the role.',
  moduleId: 'SCM-01',
  read: { scope: 'scm.catalog', moduleId: 'SCM-01' },
  fromSql: `scm01_items AS item
    LEFT JOIN scm01_balances AS bal ON bal.item_id = item.id AND bal.tenant_id = item.tenant_id
    LEFT JOIN krn03_branches AS branch ON branch.id = bal.branch_id AND branch.tenant_id = item.tenant_id`,
  joins: [
    { key: 'balance', label: 'On Hand' },
    { key: 'branch', label: 'Branch' },
  ],
  entityType: 'scm.item',
  customJoin: `LEFT JOIN krn04_field_values AS cf ON cf.entity_id = item.id AND cf.entity_type = 'scm.item' AND cf.tenant_id = item.tenant_id`,
  formulaFields: {
    on_hand: { sql: 'COALESCE(bal.quantity, 0)', kind: 'number' },
    reorder_level: { sql: 'item.reorder_level', kind: 'number' },
    selling_price: { sql: 'item.selling_price_cents', kind: 'money' },
    cost: { sql: 'item.cost_cents', kind: 'money' },
  },
  sensitiveFormulaKeys: ['cost'],
  defaultColumns: ['item', 'code', 'branch', 'on_hand', 'value'],
  fields: [
    field('item', 'Item', 'text', 'item.name'),
    field('code', 'Code', 'text', 'item.sku'),
    field('category', 'Category', 'text', 'item.category'),
    field('kind', 'Kind', 'text', kindLabel),
    field('unit', 'Unit', 'text', 'item.base_uom'),
    field('branch', 'Branch', 'text', `COALESCE(branch.name, '')`),
    field('on_hand', 'On Hand', 'number', 'COALESCE(bal.quantity, 0)'),
    field('reorder_level', 'Reorder Level', 'number', 'item.reorder_level'),
    field(
      'below_reorder',
      'Below Reorder',
      'boolean',
      `(item.kind = 'stock' AND item.status = 'active' AND item.reorder_level > 0 AND COALESCE(bal.quantity, 0) <= item.reorder_level)`,
    ),
    field('cost', 'Cost', 'money', 'item.cost_cents', { sensitive: 'cost' }),
    field('selling_price', 'Selling Price', 'money', 'item.selling_price_cents'),
    field(
      'value',
      'Stock Value',
      'money',
      'ROUND(COALESCE(bal.quantity, 0) * item.cost_cents)::bigint',
      { sensitive: 'cost' },
    ),
    field(
      'vat',
      'VAT Rate',
      'text',
      `TRIM(TO_CHAR(item.vat_rate_basis_points / 100.0, 'FM999')) || '%'`,
    ),
    field('status', 'Status', 'text', statusLabel),
  ],
});

source({
  key: 'stock_movements',
  label: 'Stock Movements',
  description: 'Every receipt, issue, adjustment, and transfer on the stock ledger.',
  moduleId: 'SCM-01',
  read: { scope: 'scm.catalog', moduleId: 'SCM-01' },
  fromSql: `scm01_movements AS m
    JOIN scm01_items AS item ON item.id = m.item_id AND item.tenant_id = m.tenant_id
    LEFT JOIN krn03_branches AS branch ON branch.id = m.branch_id AND branch.tenant_id = m.tenant_id
    LEFT JOIN users AS actor ON actor.id = m.actor_id`,
  joins: [
    { key: 'item', label: 'Stock Item' },
    { key: 'branch', label: 'Branch' },
    { key: 'actor', label: 'Person' },
  ],
  defaultColumns: ['occurred', 'item', 'branch', 'kind', 'quantity', 'reason'],
  fields: [
    field('occurred', 'Date', 'date', johannesburgDay),
    field('item', 'Item', 'text', 'item.name'),
    field('code', 'Code', 'text', 'item.sku'),
    field('branch', 'Branch', 'text', `COALESCE(branch.name, '')`),
    field('kind', 'Kind', 'text', moveKind),
    field('quantity', 'Quantity', 'number', 'm.quantity'),
    field('unit', 'Unit', 'text', 'm.uom_name'),
    field('unit_cost', 'Unit Cost', 'money', 'm.unit_cost_cents', { sensitive: 'cost' }),
    field('value', 'Value', 'money', 'm.value_cents', { sensitive: 'cost' }),
    field('reason', 'Reason', 'text', 'm.reason'),
    field('person', 'Person', 'text', `COALESCE(actor.display_name, '')`),
    field(
      'write_off',
      'Write-Off',
      'boolean',
      `(m.kind = 'adjustment' OR m.reason ILIKE '%write%' OR m.reason ILIKE '%damag%')`,
    ),
  ],
});

source({
  key: 'stock_receipts',
  label: 'Stock Receipts',
  description:
    'Goods received notes and their lines. Each row is one line, with the supplier, the branch, and the item.',
  moduleId: 'SCM-01',
  read: { scope: 'scm.catalog', moduleId: 'SCM-01' },
  fromSql: `scm01_goods_receipt_lines AS line
    JOIN scm01_goods_receipts AS receipt ON receipt.id = line.goods_receipt_id AND receipt.tenant_id = line.tenant_id
    JOIN scm01_movements AS move ON move.id = line.movement_id AND move.tenant_id = line.tenant_id
    JOIN scm01_items AS item ON item.id = line.item_id AND item.tenant_id = line.tenant_id
    LEFT JOIN parties AS supplier ON supplier.id = receipt.supplier_party_id AND supplier.tenant_id = receipt.tenant_id
    LEFT JOIN krn03_branches AS branch ON branch.id = receipt.branch_id AND branch.tenant_id = receipt.tenant_id`,
  joins: [
    { key: 'receipt', label: 'Goods Received Note' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'item', label: 'Stock Item' },
    { key: 'branch', label: 'Branch' },
  ],
  defaultColumns: ['received', 'supplier', 'grv_number', 'item', 'quantity', 'value'],
  fields: [
    field('grv_number', 'GRV Number', 'text', 'receipt.number'),
    field('received', 'Received', 'date', receiptDay),
    field(
      'supplier',
      'Supplier',
      'text',
      `COALESCE(NULLIF(btrim(supplier.display_name), ''), 'No Supplier')`,
    ),
    field('branch', 'Branch', 'text', `COALESCE(branch.name, '')`),
    field('item', 'Item', 'text', 'item.name'),
    field('code', 'Code', 'text', 'item.sku'),
    field('quantity', 'Qty', 'number', 'line.quantity'),
    field('unit', 'Unit', 'text', 'move.uom_name'),
    field('unit_cost', 'Unit Cost', 'money', 'move.unit_cost_cents', { sensitive: 'cost' }),
    field('value', 'Value', 'money', 'move.value_cents', { sensitive: 'cost' }),
    field('reference', 'Reference', 'text', `COALESCE(receipt.note, '')`),
    field('line', 'Line', 'number', 'line.line_no'),
  ],
});

source({
  key: 'branches',
  label: 'Branches',
  description: 'The places this company works from.',
  moduleId: 'KRN-03',
  read: { scope: 'krn', moduleId: 'KRN-03' },
  fromSql: 'krn03_branches AS branch',
  joins: [],
  defaultColumns: ['name', 'code', 'city', 'province', 'active'],
  fields: [
    field('name', 'Branch', 'text', 'branch.name'),
    field('code', 'Code', 'text', 'branch.code'),
    field('city', 'City', 'text', `COALESCE(branch.city, '')`),
    field('province', 'Province', 'text', `COALESCE(branch.province, '')`),
    field('active', 'Active', 'boolean', 'branch.active'),
    field('head_office', 'Head Office', 'boolean', 'branch.is_head_office'),
  ],
});

source({
  key: 'contacts',
  label: 'Contacts',
  description: 'Customers, suppliers, and staff. Identity numbers are not on this report.',
  moduleId: 'KRN-02',
  read: { scope: 'krn', moduleId: 'KRN-02' },
  fromSql: `parties AS party
    LEFT JOIN LATERAL (
      SELECT string_agg(
        CASE role
          WHEN 'customer' THEN 'Customer'
          WHEN 'supplier' THEN 'Supplier'
          WHEN 'staff' THEN 'Staff'
          ELSE INITCAP(role)
        END, ', ' ORDER BY role
      ) AS roles
      FROM party_roles
      WHERE party_id = party.id
    ) AS role_list ON TRUE
    LEFT JOIN LATERAL (
      SELECT city FROM party_addresses
      WHERE party_id = party.id AND is_primary
      ORDER BY created_at
      LIMIT 1
    ) AS address ON TRUE
    LEFT JOIN LATERAL (
      SELECT value AS email FROM party_channels
      WHERE party_id = party.id AND kind = 'email' AND is_primary
      LIMIT 1
    ) AS email_row ON TRUE
    LEFT JOIN LATERAL (
      SELECT value AS phone FROM party_channels
      WHERE party_id = party.id AND kind = 'phone' AND is_primary
      LIMIT 1
    ) AS phone_row ON TRUE`,
  joins: [
    { key: 'roles', label: 'Roles' },
    { key: 'address', label: 'Address' },
    { key: 'channels', label: 'Phone and Email' },
  ],
  entityType: 'krn.party',
  customJoin: `LEFT JOIN krn04_field_values AS cf ON cf.entity_id = party.id AND cf.entity_type = 'krn.party' AND cf.tenant_id = party.tenant_id`,
  defaultColumns: ['name', 'roles', 'city', 'email', 'phone'],
  fields: [
    field('name', 'Name', 'text', 'party.display_name'),
    field(
      'kind',
      'Kind',
      'text',
      `CASE party.kind WHEN 'organisation' THEN 'Organisation' WHEN 'person' THEN 'Person' ELSE INITCAP(party.kind) END`,
    ),
    field('roles', 'Roles', 'text', `COALESCE(role_list.roles, '')`),
    field('city', 'City', 'text', `COALESCE(address.city, '')`),
    field('email', 'Email', 'text', `COALESCE(email_row.email, '')`),
    field('phone', 'Phone', 'text', `COALESCE(phone_row.phone, '')`),
    field('vat', 'VAT Number', 'text', `COALESCE(party.vat_number, '')`),
    field(
      'status',
      'Status',
      'text',
      `CASE party.status WHEN 'active' THEN 'Active' WHEN 'archived' THEN 'Archived' ELSE INITCAP(party.status) END`,
    ),
  ],
});

source({
  key: 'users',
  label: 'Users',
  description:
    'People who can sign in, and the role each person has. Passwords are not on this report.',
  moduleId: 'KRN-01',
  read: { scope: 'krn', moduleId: 'KRN-01' },
  fromSql: `memberships AS mem
    JOIN users AS usr ON usr.id = mem.user_id
    LEFT JOIN user_roles AS ur ON ur.user_id = usr.id AND ur.tenant_id = mem.tenant_id
    LEFT JOIN roles AS role ON role.id = ur.role_id AND role.tenant_id = mem.tenant_id`,
  joins: [
    { key: 'membership', label: 'Membership' },
    { key: 'role', label: 'Role' },
  ],
  defaultColumns: ['name', 'email', 'role', 'status'],
  fields: [
    field('name', 'Name', 'text', 'usr.display_name'),
    field('email', 'Email', 'text', 'usr.email'),
    field('role', 'Role', 'text', `COALESCE(role.name, '')`),
    field('status', 'Status', 'text', 'INITCAP(usr.status)'),
  ],
});

source({
  key: 'audit_log',
  label: 'Audit Log',
  description:
    'What changed, who did it, and when. The stored detail is not copied onto the report.',
  moduleId: 'KRN-01',
  read: { scope: 'krn', moduleId: 'KRN-01' },
  fromSql: `audit_events AS ev
    LEFT JOIN users AS actor ON actor.id = ev.actor_id`,
  joins: [{ key: 'actor', label: 'Person' }],
  defaultColumns: ['occurred', 'action', 'entity', 'person'],
  fields: [
    field('occurred', 'When', 'date', auditDay),
    field('action', 'Action', 'text', 'ev.action', { display: 'action' }),
    field('entity', 'Record', 'text', 'ev.entity_type'),
    field(
      'person',
      'Person',
      'text',
      `COALESCE(actor.display_name, CASE ev.actor_kind WHEN 'operator' THEN 'Operator' WHEN 'system' THEN 'System' ELSE '' END)`,
    ),
  ],
});
