import type pg from 'pg';
import {
  documentNumber,
  formatSalesQuantity,
  parseSalesQuantity,
  salesLineAmounts,
  sumSalesLines,
} from '@omnivate/shared';

/**
 * Fictional quotes, tax invoices, and receipts for the two demo companies.
 * Aubergine Atlas Traders and Blue Crayon Foundry are not real businesses.
 * Safe to run again: the fixture rows are replaced.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = 'a1111111-1111-4111-8111-111111111101';
const CEDAR = 'c1111111-1111-4111-8111-111111111101';
const NOAH = 'c1111111-1111-4111-8111-111111111104';
const MOTH = 'c1111111-1111-4111-8111-111111111106';
const SCHOOL = 'c2222222-2222-4222-8222-222222222202';
const PINE = 'c1111111-1111-4111-8111-111111111003';
const DELIVERY = 'c1111111-1111-4111-8111-111111111007';
const SILICONE = 'c1111111-1111-4111-8111-111111111006';

const QUOTE_DRAFT = 'd1111111-1111-4111-8111-111111111201';
const QUOTE_ACCEPTED = 'd1111111-1111-4111-8111-111111111202';
const QUOTE_SENT = 'd1111111-1111-4111-8111-111111111203';
const INV_PART = 'd1111111-1111-4111-8111-111111111301';
const INV_OVERDUE = 'd1111111-1111-4111-8111-111111111302';
const INV_PAID = 'd1111111-1111-4111-8111-111111111303';
const CREDIT = 'd1111111-1111-4111-8111-111111111401';
const PAY_PART = 'd1111111-1111-4111-8111-111111111501';
const PAY_FULL = 'd1111111-1111-4111-8111-111111111502';

type Line = {
  id: string;
  itemId: string | null;
  sourceId: string | null;
  description: string;
  quantity: string;
  unitPrice: bigint;
  discount: bigint;
};

function priced(line: Omit<Line, 'id' | 'sourceId'> & { id: string; sourceId?: string | null }) {
  const quantity = parseSalesQuantity(line.quantity);
  const amounts = salesLineAmounts({
    quantity,
    unitPriceCents: line.unitPrice,
    discountCents: line.discount,
    vatBasisPoints: 1500,
  });
  return { ...line, sourceId: line.sourceId ?? null, quantity, amounts };
}

const draftLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111211',
    itemId: PINE,
    description: 'Treated pine 38 x 114 mm',
    quantity: '4',
    unitPrice: 6800n,
    discount: 0n,
  }),
  priced({
    id: 'd1111111-1111-4111-8111-111111111212',
    itemId: null,
    description: 'Site measure',
    quantity: '1',
    unitPrice: 15000n,
    discount: 1500n,
  }),
];

const acceptedLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111221',
    itemId: PINE,
    description: 'Treated pine 38 x 114 mm',
    quantity: '10',
    unitPrice: 6800n,
    discount: 0n,
  }),
  priced({
    id: 'd1111111-1111-4111-8111-111111111222',
    itemId: DELIVERY,
    description: 'Delivery in the Cape',
    quantity: '1',
    unitPrice: 35000n,
    discount: 0n,
  }),
];

const invoiceLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111311',
    itemId: PINE,
    description: 'Treated pine 38 x 114 mm',
    quantity: '10',
    unitPrice: 6800n,
    discount: 0n,
  }),
  priced({
    id: 'd1111111-1111-4111-8111-111111111312',
    itemId: DELIVERY,
    description: 'Delivery in the Cape',
    quantity: '1',
    unitPrice: 35000n,
    discount: 0n,
  }),
];

const overdueLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111321',
    itemId: null,
    description: 'Workshop call-out',
    quantity: '1',
    unitPrice: 20000n,
    discount: 0n,
  }),
  priced({
    id: 'd1111111-1111-4111-8111-111111111322',
    itemId: SILICONE,
    description: 'Clear silicone sealant',
    quantity: '2',
    unitPrice: 7200n,
    discount: 0n,
  }),
];

const creditLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111411',
    itemId: SILICONE,
    sourceId: 'd1111111-1111-4111-8111-111111111322',
    description: 'Clear silicone sealant',
    quantity: '2',
    unitPrice: 7200n,
    discount: 0n,
  }),
];

const paidLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111331',
    itemId: PINE,
    description: 'Treated pine 38 x 114 mm',
    quantity: '2',
    unitPrice: 6800n,
    discount: 0n,
  }),
];

const sentLines = [
  priced({
    id: 'd1111111-1111-4111-8111-111111111231',
    itemId: null,
    description: 'Gate repair',
    quantity: '1',
    unitPrice: 45000n,
    discount: 0n,
  }),
];

async function insertLines(
  pool: pg.Pool,
  tenant: string,
  documentId: string,
  lines: ReturnType<typeof priced>[],
) {
  for (const [index, line] of lines.entries()) {
    await pool.query(
      `INSERT INTO o2c_lines (
         id, tenant_id, document_id, position, item_id, source_line_id, description,
         quantity, unit_price_cents, discount_cents, net_cents, vat_cents, total_cents
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        line.id,
        tenant,
        documentId,
        index,
        line.itemId,
        line.sourceId,
        line.description,
        formatSalesQuantity(line.quantity),
        line.unitPrice.toString(),
        line.amounts.discountCents.toString(),
        line.amounts.netCents.toString(),
        line.amounts.vatCents.toString(),
        line.amounts.totalCents.toString(),
      ],
    );
  }
}

export async function clearSalesDemo(pool: pg.Pool): Promise<void> {
  const ready = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('public.o2c_documents') IS NOT NULL AS ok`,
  );
  if (!ready.rows[0]?.ok) {
    return;
  }
  const tables = [
    'o2c_stock_links',
    'o2c_allocations',
    'o2c_payments',
    'o2c_lines',
    'o2c_documents',
    'o2c_customer_terms',
    'o2c_sequences',
    'o2c_settings',
  ];
  for (const table of tables) {
    await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  }
  try {
    await pool.query(`DELETE FROM o2c_stock_links WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_allocations WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_payments WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_lines WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_documents WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_customer_terms WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_sequences WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM o2c_settings WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM parties WHERE id = $1`, [MOTH]);
  } finally {
    for (const table of tables) {
      await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  }
}

export async function seedSales(pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE tenants
     SET address_line1 = COALESCE(NULLIF(address_line1, ''), '12 Fictional Wharf'),
         address_city = COALESCE(NULLIF(address_city, ''), 'Cape Town'),
         address_province = COALESCE(address_province, 'Western Cape'),
         address_postal_code = COALESCE(address_postal_code, '8001')
     WHERE id = $1`,
    [A],
  );
  await pool.query(
    `INSERT INTO o2c_settings (tenant_id, bank_name, account_name, account_number, branch_code)
     VALUES ($1, 'Fictional Bank', 'Aubergine Atlas Traders (Pty) Ltd', '1234567890', '632005')
     ON CONFLICT (tenant_id) DO UPDATE SET
       bank_name = EXCLUDED.bank_name,
       account_name = EXCLUDED.account_name,
       account_number = EXCLUDED.account_number,
       branch_code = EXCLUDED.branch_code`,
    [A],
  );
  await pool.query(
    `INSERT INTO o2c_settings (tenant_id, bank_name, account_name, account_number, branch_code)
     VALUES ($1, 'Fictional Bank', 'Blue Crayon Foundry (Pty) Ltd', '2234567890', '450105')
     ON CONFLICT (tenant_id) DO UPDATE SET
       bank_name = EXCLUDED.bank_name,
       account_name = EXCLUDED.account_name,
       account_number = EXCLUDED.account_number,
       branch_code = EXCLUDED.branch_code`,
    [B],
  );

  await pool.query(
    `INSERT INTO parties (
       id, tenant_id, kind, display_name, legal_name, vat_number,
       popia_consent, popia_consent_at, status, created_by
     ) VALUES (
       $1, $2, 'organisation', 'Moth Orchard Hardware (Pty) Ltd', 'Moth Orchard Hardware (Pty) Ltd',
       '4991001008', true, '2026-03-01T08:00:00Z', 'active', $3
     ) ON CONFLICT (id) DO NOTHING`,
    [MOTH, A, OWNER_A],
  );
  await pool.query(
    `INSERT INTO party_roles (tenant_id, party_id, role)
     VALUES ($1, $2, 'customer') ON CONFLICT (party_id, role) DO NOTHING`,
    [A, MOTH],
  );
  await pool.query(
    `INSERT INTO party_addresses (
       tenant_id, party_id, kind, line1, suburb, city, province, postal_code, country, is_primary
     )
     SELECT $1, $2, 'billing', '4 Orchard Lane', 'Observatory', 'Cape Town', 'Western Cape', '7925', 'ZA', true
     WHERE NOT EXISTS (
       SELECT 1 FROM party_addresses WHERE party_id = $2 AND kind = 'billing'
     )`,
    [A, MOTH],
  );
  await pool.query(
    `INSERT INTO party_contacts (tenant_id, party_id, name, email, phone, is_primary)
     SELECT $1, $2, 'Lerato Moth', 'lerato@mothorchard.example', '082 555 0199', true
     WHERE NOT EXISTS (SELECT 1 FROM party_contacts WHERE party_id = $2)`,
    [A, MOTH],
  );

  for (const [party, days] of [
    [CEDAR, 30],
    [NOAH, 7],
    [MOTH, 14],
  ] as const) {
    await pool.query(
      `INSERT INTO o2c_customer_terms (tenant_id, party_id, payment_terms_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, party_id) DO UPDATE SET payment_terms_days = EXCLUDED.payment_terms_days`,
      [A, party, days],
    );
    await pool.query(
      `INSERT INTO party_addresses (
         tenant_id, party_id, kind, line1, city, province, postal_code, country, is_primary
       )
       SELECT tenant_id, party_id, 'billing', line1, city, province, postal_code, country, false
       FROM party_addresses
       WHERE party_id = $1 AND kind = 'physical'
         AND NOT EXISTS (
           SELECT 1 FROM party_addresses AS existing
           WHERE existing.party_id = $1 AND existing.kind = 'billing'
         )
       LIMIT 1`,
      [party],
    );
  }

  const draftTotal = sumSalesLines(draftLines.map((line) => line.amounts));
  const acceptedTotal = sumSalesLines(acceptedLines.map((line) => line.amounts));
  const invoiceTotal = sumSalesLines(invoiceLines.map((line) => line.amounts));
  const overdueTotal = sumSalesLines(overdueLines.map((line) => line.amounts));
  const creditTotal = sumSalesLines(creditLines.map((line) => line.amounts));
  const paidTotal = sumSalesLines(paidLines.map((line) => line.amounts));
  const sentTotal = sumSalesLines(sentLines.map((line) => line.amounts));

  async function header(
    id: string,
    tenant: string,
    kind: 'quote' | 'invoice' | 'credit_note',
    status: string,
    number: string | null,
    party: string,
    name: string,
    vat: string,
    address: string,
    totals: ReturnType<typeof sumSalesLines>,
    extra: {
      issuedOn?: string | null;
      dueOn?: string | null;
      validUntil?: string | null;
      quoteId?: string | null;
      invoiceId?: string | null;
      issuedAt?: string | null;
    },
  ) {
    await pool.query(
      `INSERT INTO o2c_documents (
         id, tenant_id, kind, status, number, party_id, customer_name, customer_vat,
         customer_address, customer_contact, issued_on, due_on, valid_until,
         vat_rate_basis_points, net_cents, vat_cents, total_cents, notes,
         quote_id, invoice_id, created_by, issued_at
       ) VALUES (
         $1,$2,$3,'draft',$4,$5,$6,$7,$8,'', $9,$10,$11,1500,$12,$13,$14,'',$15,$16,$17,$18
       )`,
      [
        id,
        tenant,
        kind,
        kind === 'quote' ? number : null,
        party,
        name,
        vat,
        address,
        null,
        kind === 'invoice' ? (extra.dueOn ?? null) : null,
        extra.validUntil ?? null,
        totals.netCents.toString(),
        totals.vatCents.toString(),
        totals.totalCents.toString(),
        extra.quoteId ?? null,
        extra.invoiceId ?? null,
        OWNER_A,
        null,
      ],
    );
  }

  async function publish(
    id: string,
    kind: 'quote' | 'invoice' | 'credit_note',
    status: string,
    number: string | null,
    extra: { issuedOn?: string | null; dueOn?: string | null; issuedAt?: string | null },
  ) {
    if (kind !== 'quote' && status === 'issued' && number) {
      await pool.query(
        `UPDATE o2c_documents
         SET status = 'issued', number = $2, issued_on = $3::date, due_on = $4::date,
             issued_at = $5::timestamptz
         WHERE id = $1`,
        [id, number, extra.issuedOn, extra.dueOn ?? null, extra.issuedAt],
      );
      return;
    }
    if (kind === 'quote' && status !== 'draft') {
      await pool.query(`UPDATE o2c_documents SET status = $2, issued_on = $3::date WHERE id = $1`, [
        id,
        status,
        extra.issuedOn ?? null,
      ]);
    }
  }

  await header(
    QUOTE_DRAFT,
    A,
    'quote',
    'draft',
    documentNumber('quote', 2026, 1),
    CEDAR,
    'Cedar Kite Grocers (Pty) Ltd',
    '4991001001',
    '14 Kite Street, Observatory, Cape Town',
    draftTotal,
    { validUntil: '2026-12-31' },
  );
  await insertLines(pool, A, QUOTE_DRAFT, draftLines);

  await header(
    QUOTE_ACCEPTED,
    A,
    'quote',
    'accepted',
    documentNumber('quote', 2026, 2),
    CEDAR,
    'Cedar Kite Grocers (Pty) Ltd',
    '4991001001',
    '14 Kite Street, Observatory, Cape Town',
    acceptedTotal,
    { issuedOn: '2026-10-20', validUntil: '2026-11-30' },
  );
  await insertLines(pool, A, QUOTE_ACCEPTED, acceptedLines);
  await publish(QUOTE_ACCEPTED, 'quote', 'accepted', documentNumber('quote', 2026, 2), {
    issuedOn: '2026-10-20',
  });

  await header(
    QUOTE_SENT,
    A,
    'quote',
    'sent',
    documentNumber('quote', 2026, 3),
    NOAH,
    'Noah Pietersen',
    '4991001003',
    '21 Workshop Way, Woodstock, Cape Town',
    sentTotal,
    { issuedOn: '2026-11-02', validUntil: '2026-12-15' },
  );
  await insertLines(pool, A, QUOTE_SENT, sentLines);
  await publish(QUOTE_SENT, 'quote', 'sent', documentNumber('quote', 2026, 3), {
    issuedOn: '2026-11-02',
  });

  await header(
    INV_PART,
    A,
    'invoice',
    'issued',
    documentNumber('invoice', 2026, 1),
    CEDAR,
    'Cedar Kite Grocers (Pty) Ltd',
    '4991001001',
    '14 Kite Street, Observatory, Cape Town',
    invoiceTotal,
    {
      issuedOn: '2026-11-01',
      dueOn: '2026-12-01',
      quoteId: QUOTE_ACCEPTED,
      issuedAt: '2026-11-01T08:00:00Z',
    },
  );
  await insertLines(pool, A, INV_PART, invoiceLines);
  await publish(INV_PART, 'invoice', 'issued', documentNumber('invoice', 2026, 1), {
    issuedOn: '2026-11-01',
    dueOn: '2026-12-01',
    issuedAt: '2026-11-01T08:00:00Z',
  });

  await header(
    INV_OVERDUE,
    A,
    'invoice',
    'issued',
    documentNumber('invoice', 2026, 2),
    NOAH,
    'Noah Pietersen',
    '4991001003',
    '21 Workshop Way, Woodstock, Cape Town',
    overdueTotal,
    { issuedOn: '2026-08-01', dueOn: '2026-08-08', issuedAt: '2026-08-01T08:00:00Z' },
  );
  await insertLines(pool, A, INV_OVERDUE, overdueLines);
  await publish(INV_OVERDUE, 'invoice', 'issued', documentNumber('invoice', 2026, 2), {
    issuedOn: '2026-08-01',
    dueOn: '2026-08-08',
    issuedAt: '2026-08-01T08:00:00Z',
  });

  await header(
    CREDIT,
    A,
    'credit_note',
    'issued',
    documentNumber('credit_note', 2026, 1),
    NOAH,
    'Noah Pietersen',
    '4991001003',
    '21 Workshop Way, Woodstock, Cape Town',
    creditTotal,
    { issuedOn: '2026-08-15', invoiceId: INV_OVERDUE, issuedAt: '2026-08-15T08:00:00Z' },
  );
  await insertLines(pool, A, CREDIT, creditLines);
  await publish(CREDIT, 'credit_note', 'issued', documentNumber('credit_note', 2026, 1), {
    issuedOn: '2026-08-15',
    issuedAt: '2026-08-15T08:00:00Z',
  });

  await header(
    INV_PAID,
    A,
    'invoice',
    'issued',
    documentNumber('invoice', 2026, 3),
    CEDAR,
    'Cedar Kite Grocers (Pty) Ltd',
    '4991001001',
    '14 Kite Street, Observatory, Cape Town',
    paidTotal,
    { issuedOn: '2026-09-12', dueOn: '2026-10-12', issuedAt: '2026-09-12T08:00:00Z' },
  );
  await insertLines(pool, A, INV_PAID, paidLines);
  await publish(INV_PAID, 'invoice', 'issued', documentNumber('invoice', 2026, 3), {
    issuedOn: '2026-09-12',
    dueOn: '2026-10-12',
    issuedAt: '2026-09-12T08:00:00Z',
  });

  await pool.query(
    `INSERT INTO o2c_payments (id, tenant_id, party_id, paid_on, amount_cents, method, reference, created_by)
     VALUES ($1, $2, $3, '2026-11-10', 50000, 'eft', 'CEDAR-EFT-1044', $4)`,
    [PAY_PART, A, CEDAR, OWNER_A],
  );
  await pool.query(
    `INSERT INTO o2c_allocations (tenant_id, payment_id, invoice_id, amount_cents)
     VALUES ($1, $2, $3, 50000)`,
    [A, PAY_PART, INV_PART],
  );
  await pool.query(
    `INSERT INTO o2c_payments (id, tenant_id, party_id, paid_on, amount_cents, method, reference, created_by)
     VALUES ($1, $2, $3, '2026-09-20', $4, 'cash', 'TILL-19', $5)`,
    [PAY_FULL, A, CEDAR, paidTotal.totalCents.toString(), OWNER_A],
  );
  await pool.query(
    `INSERT INTO o2c_allocations (tenant_id, payment_id, invoice_id, amount_cents)
     VALUES ($1, $2, $3, $4)`,
    [A, PAY_FULL, INV_PAID, paidTotal.totalCents.toString()],
  );

  for (const [kind, last] of [
    ['quote', 3],
    ['invoice', 3],
    ['credit_note', 1],
  ] as const) {
    await pool.query(
      `INSERT INTO o2c_sequences (tenant_id, doc_kind, year, last_number)
       VALUES ($1, $2, 2026, $3)
       ON CONFLICT (tenant_id, doc_kind, year)
       DO UPDATE SET last_number = GREATEST(o2c_sequences.last_number, EXCLUDED.last_number)`,
      [A, kind, last],
    );
  }

  const schoolLines = [
    priced({
      id: 'd2222222-2222-4222-8222-222222222211',
      itemId: null,
      description: 'Clay workshop visit',
      quantity: '1',
      unitPrice: 80000n,
      discount: 0n,
    }),
  ];
  const schoolTotal = sumSalesLines(schoolLines.map((line) => line.amounts));
  await pool.query(
    `INSERT INTO o2c_customer_terms (tenant_id, party_id, payment_terms_days)
     VALUES ($1, $2, 30)
     ON CONFLICT (tenant_id, party_id) DO UPDATE SET payment_terms_days = 30`,
    [B, SCHOOL],
  );
  await header(
    'd2222222-2222-4222-8222-222222222301',
    B,
    'invoice',
    'issued',
    documentNumber('invoice', 2026, 1),
    SCHOOL,
    'Polokwane School of Clay',
    '',
    '12 Clay Road, Seshego, Polokwane',
    schoolTotal,
    { issuedOn: '2026-07-01', dueOn: '2026-07-31', issuedAt: '2026-07-01T08:00:00Z' },
  );
  await insertLines(pool, B, 'd2222222-2222-4222-8222-222222222301', schoolLines);
  await publish(
    'd2222222-2222-4222-8222-222222222301',
    'invoice',
    'issued',
    documentNumber('invoice', 2026, 1),
    { issuedOn: '2026-07-01', dueOn: '2026-07-31', issuedAt: '2026-07-01T08:00:00Z' },
  );
  await pool.query(
    `INSERT INTO o2c_sequences (tenant_id, doc_kind, year, last_number)
     VALUES ($1, 'invoice', 2026, 1)
     ON CONFLICT (tenant_id, doc_kind, year)
     DO UPDATE SET last_number = GREATEST(o2c_sequences.last_number, EXCLUDED.last_number)`,
    [B],
  );
}
