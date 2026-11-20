import type pg from 'pg';

/**
 * Fictional catalog for the two demo companies.
 * Aubergine Atlas is a hardware yard. Blue Crayon Foundry is a small foundry.
 * Nothing here is a real product, barcode, or price list.
 * branch_id values are the ones KRN-03 should reuse. See 0005_scm01_catalog.sql.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HEAD = 'HEAD';
const OTHER = 'OTHER';
const A_USER = 'a1111111-1111-4111-8111-111111111105';
const B_USER = 'b2222222-2222-4222-8222-222222222205';

type Item = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string;
  category: string;
  kind: 'stock' | 'service' | 'non_stock';
  unit: string;
  cost: bigint;
  price: bigint;
  reorder: string;
  batches: boolean;
  serials: boolean;
};

type Move = {
  id: string;
  item: string;
  branch: string;
  kind: string;
  qty: string;
  entered: string;
  factor: string;
  unit: string;
  cost: bigint;
  value: bigint;
  reason: string;
  at: string;
  batch?: string;
  group?: string;
};

const aubergineItems: Item[] = [
  {
    id: 'c1111111-1111-4111-8111-111111111001',
    sku: 'AT-SCR-450',
    barcode: '9900000001001',
    name: 'Chipboard screw 4 x 50 mm',
    description: 'Yellow zinc. Sold by the hundred as well as one by one.',
    category: 'Fasteners',
    kind: 'stock',
    unit: 'each',
    cost: 85n,
    price: 150n,
    reorder: '500',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111002',
    sku: 'AT-CEM-50',
    barcode: '9900000001002',
    name: 'Portland cement 42.5 N, 50 kg',
    description: 'General purpose 50 kg bag for plaster and mortar.',
    category: 'Cement',
    kind: 'stock',
    unit: 'bag',
    cost: 9800n,
    price: 12500n,
    reorder: '20',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111003',
    sku: 'AT-PINE-38114',
    barcode: '9900000001003',
    name: 'Treated pine 38 x 114 mm',
    description: 'Length sold by the metre.',
    category: 'Timber',
    kind: 'stock',
    unit: 'metre',
    cost: 4250n,
    price: 6800n,
    reorder: '20',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111004',
    sku: 'AT-PVA-5L',
    barcode: '9900000001004',
    name: 'PVA primer 5 L',
    description: 'Interior primer. Track the lot and the expiry.',
    category: 'Paint',
    kind: 'stock',
    unit: 'tin',
    cost: 18900n,
    price: 24900n,
    reorder: '6',
    batches: true,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111005',
    sku: 'AT-LOCK-40',
    barcode: '9900000001005',
    name: 'Brass padlock 40 mm',
    description: 'Each lock has its own serial number.',
    category: 'Security',
    kind: 'stock',
    unit: 'each',
    cost: 14500n,
    price: 22000n,
    reorder: '2',
    batches: false,
    serials: true,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111006',
    sku: 'AT-SIL-CL',
    barcode: '9900000001006',
    name: 'Clear silicone sealant',
    description: '300 ml cartridge.',
    category: 'Sealants',
    kind: 'stock',
    unit: 'tube',
    cost: 4500n,
    price: 7200n,
    reorder: '12',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111007',
    sku: 'AT-DEL-CAPE',
    barcode: null,
    name: 'Delivery in the Cape',
    description: 'A trip with the yard bakkie. Not physical stock.',
    category: 'Services',
    kind: 'service',
    unit: 'trip',
    cost: 0n,
    price: 35000n,
    reorder: '0',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111008',
    sku: 'AT-CUT',
    barcode: null,
    name: 'Cutting charge',
    description: 'Saw time on the yard.',
    category: 'Services',
    kind: 'service',
    unit: 'cut',
    cost: 0n,
    price: 8000n,
    reorder: '0',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111010',
    sku: 'AT-CLIP-12',
    barcode: null,
    name: 'Yard bin clip',
    description: 'Plastic clip for the yard bins. No supplier barcode.',
    category: 'Storage',
    kind: 'stock',
    unit: 'each',
    cost: 250n,
    price: 450n,
    reorder: '8',
    batches: false,
    serials: false,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111009',
    sku: 'AT-SAMPLE',
    barcode: null,
    name: 'Shade-cloth sample card',
    description: 'Handed out at the counter. Not kept as stock.',
    category: 'Marketing',
    kind: 'non_stock',
    unit: 'card',
    cost: 0n,
    price: 0n,
    reorder: '0',
    batches: false,
    serials: false,
  },
];

const foundryItems: Item[] = [
  {
    id: 'd2222222-2222-4222-8222-222222222001',
    sku: 'BC-PUL-180',
    barcode: '9900000002001',
    name: 'Cast pulley 180 mm',
    description: 'Grey iron pulley, 180 mm outside diameter, machined bore.',
    category: 'Finished goods',
    kind: 'stock',
    unit: 'each',
    cost: 64000n,
    price: 98000n,
    reorder: '4',
    batches: false,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222002',
    sku: 'BC-ING-GI',
    barcode: '9900000002002',
    name: 'Grey iron ingot',
    description: 'Raw metal, weighed by the kilogram and kept by heat number.',
    category: 'Raw material',
    kind: 'stock',
    unit: 'kilogram',
    cost: 1850n,
    price: 0n,
    reorder: '200',
    batches: true,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222003',
    sku: 'BC-FLUX-25',
    barcode: '9900000002003',
    name: 'Foundry flux 25 kg',
    description: 'Covering flux. Note the expiry.',
    category: 'Consumables',
    kind: 'stock',
    unit: 'bag',
    cost: 31000n,
    price: 0n,
    reorder: '4',
    batches: true,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222004',
    sku: 'BC-BLT-M12',
    barcode: '9900000002004',
    name: 'M12 set bolt',
    description: 'Packed in boxes of 10.',
    category: 'Fasteners',
    kind: 'stock',
    unit: 'each',
    cost: 420n,
    price: 750n,
    reorder: '100',
    batches: false,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222005',
    sku: 'BC-MACH',
    barcode: null,
    name: 'Machining time',
    description: 'Lathe or mill time for a customer job.',
    category: 'Services',
    kind: 'service',
    unit: 'hour',
    cost: 0n,
    price: 45000n,
    reorder: '0',
    batches: false,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222006',
    sku: 'BC-CARD',
    barcode: null,
    name: 'Visitor card',
    description: 'Printed card for the gate. Not stock.',
    category: 'Marketing',
    kind: 'non_stock',
    unit: 'card',
    cost: 0n,
    price: 0n,
    reorder: '0',
    batches: false,
    serials: false,
  },
  {
    id: 'd2222222-2222-4222-8222-222222222007',
    sku: 'BC-HSG-90',
    barcode: '9900000002007',
    name: 'Gearbox housing',
    description: 'Each housing is serialised.',
    category: 'Finished goods',
    kind: 'stock',
    unit: 'each',
    cost: 210000n,
    price: 340000n,
    reorder: '1',
    batches: false,
    serials: true,
  },
];

function pluralOf(unit: string): string {
  const known: Record<string, string> = {
    each: 'each',
    bag: 'bags',
    metre: 'metres',
    tin: 'tins',
    tube: 'tubes',
    trip: 'trips',
    cut: 'cuts',
    card: 'cards',
    kilogram: 'kilograms',
    hour: 'hours',
    box: 'boxes',
  };
  return known[unit] ?? `${unit}s`;
}

function sides(kind: string, value: bigint): { debit: string; credit: string } | null {
  if (value === 0n) {
    return null;
  }
  const up = value > 0n;
  if (kind === 'issue') {
    return up
      ? { debit: 'inventory', credit: 'stock_write_off' }
      : { debit: 'stock_write_off', credit: 'inventory' };
  }
  if (kind === 'adjustment') {
    return up
      ? { debit: 'inventory', credit: 'inventory_adjustment' }
      : { debit: 'inventory_adjustment', credit: 'inventory' };
  }
  return up
    ? { debit: 'inventory', credit: 'stock_receipts_clearing' }
    : { debit: 'stock_receipts_clearing', credit: 'inventory' };
}

async function seedCompany(
  pool: pg.Pool,
  input: {
    tenant: string;
    user: string;
    headOffice: { id: string; name: string };
    other: { id: string; name: string };
    items: Item[];
    moves: Move[];
    balances: { item: string; branch: string; qty: string }[];
    batches: { id: string; item: string; code: string; expires: string | null }[];
    batchBalances: { batch: string; branch: string; qty: string }[];
    serials: { id: string; item: string; serial: string; branch: string | null; status: string }[];
    serialLinks: { movement: string; serial: string }[];
    packs: { id: string; item: string; name: string; factor: string }[];
    pending: {
      id: string;
      item: string;
      branch: string;
      qty: string;
      cost: bigint;
      value: bigint;
      reason: string;
    };
    auditId: string;
    sodId: string;
  },
): Promise<void> {
  const head = await pool.query<{ id: string }>(
    `SELECT id FROM krn03_branches
     WHERE tenant_id = $1 AND is_head_office AND archived_at IS NULL
     LIMIT 1`,
    [input.tenant],
  );
  const headId = head.rows[0]?.id;
  if (!headId) {
    throw new Error(`Company ${input.tenant} has no Head Office.`);
  }
  const other = await pool.query<{ id: string }>(
    `SELECT id FROM krn03_branches
     WHERE tenant_id = $1 AND NOT is_head_office AND archived_at IS NULL
     ORDER BY name
     LIMIT 1`,
    [input.tenant],
  );
  const otherId = other.rows[0]?.id ?? null;
  const place = (token: string): string => {
    if (token === 'HEAD') return headId;
    if (token === 'OTHER') {
      if (!otherId) {
        throw new Error(`Company ${input.tenant} has no second branch.`);
      }
      return otherId;
    }
    return token;
  };
  await pool.query(
    `INSERT INTO scm01_settings (tenant_id, label_width_mm, label_height_mm, label_printer, adjustment_approval_cents)
     VALUES ($1, 50, 15, 'Niimbot M2_H', 1000000)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [input.tenant],
  );
  for (const item of input.items) {
    await pool.query(
      `INSERT INTO scm01_items (
        id, tenant_id, kind, sku, barcode, name, description, category, base_uom, base_uom_plural,
        cost_cents, selling_price_cents, vat_rate_basis_points, reorder_level,
        track_batches, track_serials, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, 1500, $13, $14, $15, 'active'
      ) ON CONFLICT (id) DO NOTHING`,
      [
        item.id,
        input.tenant,
        item.kind,
        item.sku,
        item.barcode,
        item.name,
        item.description,
        item.category,
        item.unit,
        pluralOf(item.unit),
        item.cost.toString(),
        item.price.toString(),
        item.reorder,
        item.batches,
        item.serials,
      ],
    );
  }
  for (const pack of input.packs) {
    await pool.query(
      `INSERT INTO scm01_item_uoms (id, tenant_id, item_id, name, plural, factor_to_base)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [pack.id, input.tenant, pack.item, pack.name, pluralOf(pack.name), pack.factor],
    );
  }
  for (const batch of input.batches) {
    await pool.query(
      `INSERT INTO scm01_batches (id, tenant_id, item_id, code, expires_on)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [batch.id, input.tenant, batch.item, batch.code, batch.expires],
    );
  }
  for (const serial of input.serials) {
    await pool.query(
      `INSERT INTO scm01_serials (id, tenant_id, item_id, serial, branch_id, status)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [
        serial.id,
        input.tenant,
        serial.item,
        serial.serial,
        serial.branch ? place(serial.branch) : null,
        serial.status,
      ],
    );
  }
  for (const move of input.moves) {
    await pool.query(
      `INSERT INTO scm01_movements (
        id, tenant_id, item_id, branch_id, kind, quantity, uom_name, uom_plural, uom_factor,
        entered_quantity, unit_cost_cents, value_cents, reason, status,
        transfer_group_id, batch_id, occurred_at, actor_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, 'posted',
        $14, $15, $16, $17
      ) ON CONFLICT (id) DO NOTHING`,
      [
        move.id,
        input.tenant,
        move.item,
        place(move.branch),
        move.kind,
        move.qty,
        move.unit,
        pluralOf(move.unit),
        move.factor,
        move.entered,
        move.cost.toString(),
        move.value.toString(),
        move.reason,
        move.group ?? null,
        move.batch ?? null,
        move.at,
        input.user,
      ],
    );
    const journal = sides(move.kind, move.value);
    if (!journal) {
      continue;
    }
    const amount = move.value < 0n ? -move.value : move.value;
    await pool.query(
      `INSERT INTO scm01_pending_postings (
        id, tenant_id, movement_id, occurred_at, memo, amount_cents, signed_value_cents,
        currency_code, debit_account, credit_account, quantity, unit_cost_cents
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'ZAR', $8, $9, $10, $11
      ) ON CONFLICT (id) DO NOTHING`,
      [
        move.id.replace('a3111111-', 'a7111111-').replace('a3222222-', 'a7222222-'),
        input.tenant,
        move.id,
        move.at,
        move.reason,
        amount.toString(),
        move.value.toString(),
        journal.debit,
        journal.credit,
        move.qty,
        move.cost.toString(),
      ],
    );
  }
  for (const link of input.serialLinks) {
    await pool.query(
      `INSERT INTO scm01_movement_serials (tenant_id, movement_id, serial_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [input.tenant, link.movement, link.serial],
    );
  }
  for (const row of input.balances) {
    await pool.query(
      `INSERT INTO scm01_balances (tenant_id, item_id, branch_id, quantity)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [input.tenant, row.item, place(row.branch), row.qty],
    );
  }
  for (const row of input.batchBalances) {
    await pool.query(
      `INSERT INTO scm01_batch_balances (tenant_id, batch_id, branch_id, quantity)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [input.tenant, row.batch, place(row.branch), row.qty],
    );
  }
  await pool.query(
    `INSERT INTO scm01_adjustment_requests (
      id, tenant_id, item_id, branch_id, quantity, unit_cost_cents, value_cents,
      reason, status, requested_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
    ON CONFLICT (id) DO NOTHING`,
    [
      input.pending.id,
      input.tenant,
      input.pending.item,
      place(input.pending.branch),
      input.pending.qty,
      input.pending.cost.toString(),
      input.pending.value.toString(),
      input.pending.reason,
      input.user,
      '2026-11-18T08:00:00.000Z',
    ],
  );
  await pool.query(
    `INSERT INTO sod_rules (id, tenant_id, action_a, action_b, description, enabled)
     VALUES ($1, $2, 'scm.adjustment.approve', 'scm.adjustment.submit', $3, true)
     ON CONFLICT (tenant_id, action_a, action_b) DO NOTHING`,
    [input.sodId, input.tenant, 'The person who asks for a stock adjustment cannot approve it.'],
  );
  await pool.query(
    `INSERT INTO audit_events (
      id, tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data, user_agent
    ) VALUES ($1, $2, NULL, 'seed.demo_stock', 'tenant', $2, NULL, $3::jsonb, 'omnivate-seed')
    ON CONFLICT (id) DO NOTHING`,
    [input.auditId, input.tenant, JSON.stringify({ fictional: true, module: 'SCM-01' })],
  );
}

export async function seedScm01(pool: pg.Pool): Promise<void> {
  await seedCompany(pool, {
    tenant: A,
    user: A_USER,
    headOffice: { id: HEAD, name: 'Head Office' },
    other: { id: OTHER, name: 'Salt River yard' },
    items: aubergineItems,
    packs: [
      {
        id: 'c1111111-1111-4111-8111-111111111101',
        item: 'c1111111-1111-4111-8111-111111111001',
        name: 'box',
        factor: '100',
      },
    ],
    batches: [
      {
        id: 'e1111111-1111-4111-8111-111111111001',
        item: 'c1111111-1111-4111-8111-111111111004',
        code: 'LOT-PVA-2401',
        expires: '2027-06-30',
      },
    ],
    batchBalances: [{ batch: 'e1111111-1111-4111-8111-111111111001', branch: HEAD, qty: '15' }],
    serials: [
      {
        id: 'f1111111-1111-4111-8111-111111111001',
        item: 'c1111111-1111-4111-8111-111111111005',
        serial: 'ATL-1001',
        branch: HEAD,
        status: 'in_stock',
      },
      {
        id: 'f1111111-1111-4111-8111-111111111002',
        item: 'c1111111-1111-4111-8111-111111111005',
        serial: 'ATL-1002',
        branch: HEAD,
        status: 'in_stock',
      },
      {
        id: 'f1111111-1111-4111-8111-111111111003',
        item: 'c1111111-1111-4111-8111-111111111005',
        serial: 'ATL-1003',
        branch: HEAD,
        status: 'in_stock',
      },
      {
        id: 'f1111111-1111-4111-8111-111111111004',
        item: 'c1111111-1111-4111-8111-111111111005',
        serial: 'ATL-1004',
        branch: null,
        status: 'issued',
      },
    ],
    serialLinks: [
      {
        movement: 'a3111111-1111-4111-8111-111111111011',
        serial: 'f1111111-1111-4111-8111-111111111001',
      },
      {
        movement: 'a3111111-1111-4111-8111-111111111011',
        serial: 'f1111111-1111-4111-8111-111111111002',
      },
      {
        movement: 'a3111111-1111-4111-8111-111111111011',
        serial: 'f1111111-1111-4111-8111-111111111003',
      },
      {
        movement: 'a3111111-1111-4111-8111-111111111011',
        serial: 'f1111111-1111-4111-8111-111111111004',
      },
      {
        movement: 'a3111111-1111-4111-8111-111111111012',
        serial: 'f1111111-1111-4111-8111-111111111004',
      },
    ],
    moves: [
      {
        id: 'a3111111-1111-4111-8111-111111111001',
        item: 'c1111111-1111-4111-8111-111111111001',
        branch: HEAD,
        kind: 'receipt',
        qty: '3000',
        entered: '30',
        factor: '100',
        unit: 'box',
        cost: 80n,
        value: 240000n,
        reason: 'Opening delivery from the mill',
        at: '2026-10-02T07:30:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111002',
        item: 'c1111111-1111-4111-8111-111111111001',
        branch: HEAD,
        kind: 'receipt',
        qty: '1000',
        entered: '10',
        factor: '100',
        unit: 'box',
        cost: 100n,
        value: 100000n,
        reason: 'Top-up, higher invoice',
        at: '2026-10-20T09:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111003',
        item: 'c1111111-1111-4111-8111-111111111001',
        branch: HEAD,
        kind: 'issue',
        qty: '-600',
        entered: '600',
        factor: '1',
        unit: 'each',
        cost: 85n,
        value: -51000n,
        reason: 'Damaged box, written off',
        at: '2026-11-03T15:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111006',
        item: 'c1111111-1111-4111-8111-111111111002',
        branch: HEAD,
        kind: 'receipt',
        qty: '30',
        entered: '30',
        factor: '1',
        unit: 'bag',
        cost: 9800n,
        value: 294000n,
        reason: 'Bags off the morning truck',
        at: '2026-09-15T06:40:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111009',
        item: 'c1111111-1111-4111-8111-111111111002',
        branch: HEAD,
        kind: 'issue',
        qty: '-18',
        entered: '18',
        factor: '1',
        unit: 'bag',
        cost: 9800n,
        value: -176400n,
        reason: 'Damaged bags',
        at: '2026-11-01T11:20:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111010',
        item: 'c1111111-1111-4111-8111-111111111004',
        branch: HEAD,
        kind: 'receipt',
        qty: '15',
        entered: '15',
        factor: '1',
        unit: 'tin',
        cost: 18900n,
        value: 283500n,
        reason: 'Lot LOT-PVA-2401',
        at: '2026-09-01T09:00:00.000Z',
        batch: 'e1111111-1111-4111-8111-111111111001',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111011',
        item: 'c1111111-1111-4111-8111-111111111005',
        branch: HEAD,
        kind: 'receipt',
        qty: '4',
        entered: '4',
        factor: '1',
        unit: 'each',
        cost: 14500n,
        value: 58000n,
        reason: 'Four numbered locks',
        at: '2026-09-12T13:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111012',
        item: 'c1111111-1111-4111-8111-111111111005',
        branch: HEAD,
        kind: 'issue',
        qty: '-1',
        entered: '1',
        factor: '1',
        unit: 'each',
        cost: 14500n,
        value: -14500n,
        reason: 'Lock damaged, written off',
        at: '2026-10-18T14:10:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111013',
        item: 'c1111111-1111-4111-8111-111111111003',
        branch: HEAD,
        kind: 'receipt',
        qty: '100',
        entered: '100',
        factor: '1',
        unit: 'metre',
        cost: 4250n,
        value: 425000n,
        reason: 'Timber pack',
        at: '2026-08-20T08:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111014',
        item: 'c1111111-1111-4111-8111-111111111003',
        branch: HEAD,
        kind: 'issue',
        qty: '-14',
        entered: '14',
        factor: '1',
        unit: 'metre',
        cost: 4250n,
        value: -59500n,
        reason: 'Cut for a pergola',
        at: '2026-11-05T16:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111015',
        item: 'c1111111-1111-4111-8111-111111111006',
        branch: HEAD,
        kind: 'receipt',
        qty: '11',
        entered: '11',
        factor: '1',
        unit: 'tube',
        cost: 4500n,
        value: 49500n,
        reason: 'Shelf fill',
        at: '2026-10-05T09:30:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111016',
        item: 'c1111111-1111-4111-8111-111111111006',
        branch: HEAD,
        kind: 'issue',
        qty: '-7',
        entered: '7',
        factor: '1',
        unit: 'tube',
        cost: 4500n,
        value: -31500n,
        reason: 'Tubes past their shelf life',
        at: '2026-10-28T12:00:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111017',
        item: 'c1111111-1111-4111-8111-111111111006',
        branch: HEAD,
        kind: 'adjustment',
        qty: '-1',
        entered: '1',
        factor: '1',
        unit: 'tube',
        cost: 4500n,
        value: -4500n,
        reason: 'Tube damaged in the yard',
        at: '2026-11-12T09:45:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111018',
        item: 'c1111111-1111-4111-8111-111111111001',
        branch: HEAD,
        kind: 'receipt',
        qty: '6',
        entered: '6',
        factor: '1',
        unit: 'each',
        cost: 85n,
        value: 510n,
        reason: 'GRV-1042',
        at: '2026-11-18T08:15:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111019',
        item: 'c1111111-1111-4111-8111-111111111002',
        branch: HEAD,
        kind: 'receipt',
        qty: '2',
        entered: '2',
        factor: '1',
        unit: 'bag',
        cost: 9800n,
        value: 19600n,
        reason: 'GRV-1042',
        at: '2026-11-18T08:15:00.000Z',
      },
      {
        id: 'a3111111-1111-4111-8111-111111111020',
        item: 'c1111111-1111-4111-8111-111111111010',
        branch: HEAD,
        kind: 'receipt',
        qty: '4',
        entered: '4',
        factor: '1',
        unit: 'each',
        cost: 250n,
        value: 1000n,
        reason: 'GRV-1042',
        at: '2026-11-18T08:15:00.000Z',
      },
    ],
    balances: [
      { item: 'c1111111-1111-4111-8111-111111111001', branch: HEAD, qty: '3406' },
      { item: 'c1111111-1111-4111-8111-111111111002', branch: HEAD, qty: '14' },
      { item: 'c1111111-1111-4111-8111-111111111010', branch: HEAD, qty: '4' },
      { item: 'c1111111-1111-4111-8111-111111111003', branch: HEAD, qty: '86' },
      { item: 'c1111111-1111-4111-8111-111111111004', branch: HEAD, qty: '15' },
      { item: 'c1111111-1111-4111-8111-111111111005', branch: HEAD, qty: '3' },
      { item: 'c1111111-1111-4111-8111-111111111006', branch: HEAD, qty: '3' },
    ],
    pending: {
      id: 'a5111111-1111-4111-8111-111111111001',
      item: 'c1111111-1111-4111-8111-111111111002',
      branch: HEAD,
      qty: '6',
      cost: 9800n,
      value: 58800n,
      reason: 'Count found 6 bags more than the system.',
    },
    auditId: 'c9999999-9999-4999-8999-999999999991',
    sodId: 'a6111111-1111-4111-8111-111111111001',
  });

  await seedCompany(pool, {
    tenant: B,
    user: B_USER,
    headOffice: { id: HEAD, name: 'Head Office' },
    other: { id: OTHER, name: 'Seshego workshop' },
    items: foundryItems,
    packs: [
      {
        id: 'd2222222-2222-4222-8222-222222222101',
        item: 'd2222222-2222-4222-8222-222222222004',
        name: 'box',
        factor: '10',
      },
    ],
    batches: [
      {
        id: 'e2222222-2222-4222-8222-222222222001',
        item: 'd2222222-2222-4222-8222-222222222002',
        code: 'HEAT-441',
        expires: null,
      },
      {
        id: 'e2222222-2222-4222-8222-222222222002',
        item: 'd2222222-2222-4222-8222-222222222003',
        code: 'FLX-19',
        expires: '2026-12-01',
      },
    ],
    batchBalances: [
      { batch: 'e2222222-2222-4222-8222-222222222001', branch: HEAD, qty: '80' },
      { batch: 'e2222222-2222-4222-8222-222222222002', branch: HEAD, qty: '1' },
    ],
    serials: [
      {
        id: 'f2222222-2222-4222-8222-222222222001',
        item: 'd2222222-2222-4222-8222-222222222007',
        serial: 'BCH-501',
        branch: HEAD,
        status: 'in_stock',
      },
      {
        id: 'f2222222-2222-4222-8222-222222222002',
        item: 'd2222222-2222-4222-8222-222222222007',
        serial: 'BCH-502',
        branch: HEAD,
        status: 'in_stock',
      },
    ],
    serialLinks: [
      {
        movement: 'a3222222-2222-4222-8222-222222222006',
        serial: 'f2222222-2222-4222-8222-222222222001',
      },
      {
        movement: 'a3222222-2222-4222-8222-222222222006',
        serial: 'f2222222-2222-4222-8222-222222222002',
      },
    ],
    moves: [
      {
        id: 'a3222222-2222-4222-8222-222222222001',
        item: 'd2222222-2222-4222-8222-222222222001',
        branch: HEAD,
        kind: 'receipt',
        qty: '20',
        entered: '20',
        factor: '1',
        unit: 'each',
        cost: 64000n,
        value: 1280000n,
        reason: 'Casting run',
        at: '2026-09-08T07:00:00.000Z',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222002',
        item: 'd2222222-2222-4222-8222-222222222001',
        branch: HEAD,
        kind: 'transfer_out',
        qty: '-3',
        entered: '3',
        factor: '1',
        unit: 'each',
        cost: 64000n,
        value: 0n,
        reason: 'Moved to Durban',
        at: '2026-10-12T08:00:00.000Z',
        group: 'a4222222-2222-4222-8222-222222222001',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222003',
        item: 'd2222222-2222-4222-8222-222222222001',
        branch: OTHER,
        kind: 'transfer_in',
        qty: '3',
        entered: '3',
        factor: '1',
        unit: 'each',
        cost: 64000n,
        value: 0n,
        reason: 'Moved to Durban',
        at: '2026-10-12T08:00:00.000Z',
        group: 'a4222222-2222-4222-8222-222222222001',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222004',
        item: 'd2222222-2222-4222-8222-222222222001',
        branch: HEAD,
        kind: 'issue',
        qty: '-5',
        entered: '5',
        factor: '1',
        unit: 'each',
        cost: 64000n,
        value: -320000n,
        reason: 'Casting scrapped after a crack',
        at: '2026-11-02T13:30:00.000Z',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222005',
        item: 'd2222222-2222-4222-8222-222222222002',
        branch: HEAD,
        kind: 'receipt',
        qty: '80',
        entered: '80',
        factor: '1',
        unit: 'kilogram',
        cost: 1850n,
        value: 148000n,
        reason: 'Heat HEAT-441',
        at: '2026-10-06T06:20:00.000Z',
        batch: 'e2222222-2222-4222-8222-222222222001',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222007',
        item: 'd2222222-2222-4222-8222-222222222003',
        branch: HEAD,
        kind: 'receipt',
        qty: '1',
        entered: '1',
        factor: '1',
        unit: 'bag',
        cost: 31000n,
        value: 31000n,
        reason: 'Last bag of FLX-19',
        at: '2026-11-01T09:00:00.000Z',
        batch: 'e2222222-2222-4222-8222-222222222002',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222008',
        item: 'd2222222-2222-4222-8222-222222222004',
        branch: HEAD,
        kind: 'receipt',
        qty: '500',
        entered: '50',
        factor: '10',
        unit: 'box',
        cost: 420n,
        value: 210000n,
        reason: 'Bolt boxes',
        at: '2026-08-15T10:00:00.000Z',
      },
      {
        id: 'a3222222-2222-4222-8222-222222222006',
        item: 'd2222222-2222-4222-8222-222222222007',
        branch: HEAD,
        kind: 'receipt',
        qty: '2',
        entered: '2',
        factor: '1',
        unit: 'each',
        cost: 210000n,
        value: 420000n,
        reason: 'Housings BCH-501 and BCH-502',
        at: '2026-10-22T11:00:00.000Z',
      },
    ],
    balances: [
      { item: 'd2222222-2222-4222-8222-222222222001', branch: HEAD, qty: '12' },
      { item: 'd2222222-2222-4222-8222-222222222001', branch: OTHER, qty: '3' },
      { item: 'd2222222-2222-4222-8222-222222222002', branch: HEAD, qty: '80' },
      { item: 'd2222222-2222-4222-8222-222222222003', branch: HEAD, qty: '1' },
      { item: 'd2222222-2222-4222-8222-222222222004', branch: HEAD, qty: '500' },
      { item: 'd2222222-2222-4222-8222-222222222007', branch: HEAD, qty: '2' },
    ],
    pending: {
      id: 'a5222222-2222-4222-8222-222222222001',
      item: 'd2222222-2222-4222-8222-222222222001',
      branch: HEAD,
      qty: '40',
      cost: 64000n,
      value: 2560000n,
      reason: 'Pattern-shop count does not match the ledger.',
    },
    auditId: 'c9999999-9999-4999-8999-999999999992',
    sodId: 'a6222222-2222-4222-8222-222222222001',
  });

  await pool.query(
    `INSERT INTO krn03_branch_access (id, tenant_id, user_id, branch_id)
     SELECT
       ('a7222222-2222-4222-8222-22222222200' || row_number() OVER (ORDER BY b.id))::uuid,
       b.tenant_id,
       $1,
       b.id
     FROM krn03_branches AS b
     WHERE b.tenant_id = $2 AND b.archived_at IS NULL
     ON CONFLICT (id) DO NOTHING`,
    [B_USER, B],
  );

  const head = await pool.query<{ id: string }>(
    `SELECT id FROM krn03_branches
     WHERE tenant_id = $1 AND is_head_office AND archived_at IS NULL
     LIMIT 1`,
    [A],
  );
  const headId = head.rows[0]?.id;
  if (!headId) {
    throw new Error('Aubergine Atlas has no Head Office for the sample goods receipt.');
  }
  await pool.query(
    `INSERT INTO scm01_goods_receipts (id, tenant_id, number, branch_id, note, received_at, actor_id)
     VALUES ($1, $2, 'GRV-1042', $3, 'Morning delivery from Cedar Kite', $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    ['a8111111-1111-4111-8111-111111111001', A, headId, '2026-11-18T08:15:00.000Z', A_USER],
  );
  const grvLines = [
    [
      'b8111111-1111-4111-8111-111111111001',
      1,
      'c1111111-1111-4111-8111-111111111001',
      'a3111111-1111-4111-8111-111111111018',
      '6',
    ],
    [
      'b8111111-1111-4111-8111-111111111002',
      2,
      'c1111111-1111-4111-8111-111111111002',
      'a3111111-1111-4111-8111-111111111019',
      '2',
    ],
    [
      'b8111111-1111-4111-8111-111111111003',
      3,
      'c1111111-1111-4111-8111-111111111010',
      'a3111111-1111-4111-8111-111111111020',
      '4',
    ],
  ];
  for (const line of grvLines) {
    await pool.query(
      `INSERT INTO scm01_goods_receipt_lines (
        id, tenant_id, goods_receipt_id, line_no, item_id, movement_id, quantity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING`,
      [line[0], A, 'a8111111-1111-4111-8111-111111111001', line[1], line[2], line[3], line[4]],
    );
  }
}
