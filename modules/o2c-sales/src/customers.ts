import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { SA_PROVINCES, centsToDecimal, zarFromDecimal } from '@omnivate/shared';
import { salesAccess, type Actor } from './access';
import { SalesError } from './errors';
import { customFieldState, storeCustomFields } from './fields';
import { audit, many, one } from './rows';

export type CustomerInput = {
  name: string;
  vatNumber: string;
  line1: string;
  line2: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  contactName: string;
  email: string;
  phone: string;
  paymentTermsDays: string;
  creditLimit: string;
  creditHold: boolean;
  creditHoldReason: string;
  customFields?: Record<string, unknown>;
};

type CustomerRow = {
  id: string;
  name: string;
  vat: string;
  line1: string | null;
  line2: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  terms: number | null;
  credit_limit_cents: bigint | null;
  credit_hold: boolean;
  credit_hold_reason: string | null;
};

function clean(value: string, label: string, max: number, required: boolean): string {
  const text = value.trim();
  if (required && text.length < 2 && label === 'a customer name') {
    throw new SalesError('Enter a customer name of at least 2 characters.');
  }
  if (required && text.length < 1) {
    throw new SalesError(`Enter ${label}.`);
  }
  if (text.length > max) {
    throw new SalesError(`That ${label} is too long.`);
  }
  return text;
}

function termsOf(value: string): number {
  const text = value.trim() === '' ? '30' : value.trim();
  if (!/^\d{1,3}$/.test(text)) {
    throw new SalesError('Payment terms are a number of days.');
  }
  const days = Number(text);
  if (days > 365) {
    throw new SalesError('Payment terms cannot be more than 365 days.');
  }
  return days;
}

function vatOf(value: string): string | null {
  const text = value.replace(/\s/g, '');
  if (!text) {
    return null;
  }
  if (!/^4\d{9}$/.test(text)) {
    throw new SalesError('A South African VAT number is 10 digits and starts with 4.');
  }
  return text;
}

function provinceOf(value: string): string | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (!(SA_PROVINCES as readonly string[]).includes(text)) {
    throw new SalesError('Choose a South African province.');
  }
  return text;
}

function present(row: CustomerRow) {
  const address = [row.line1, row.line2, row.suburb, row.city, row.province, row.postal_code]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vat,
    line1: row.line1 ?? '',
    line2: row.line2 ?? '',
    suburb: row.suburb ?? '',
    city: row.city ?? '',
    province: row.province ?? '',
    postalCode: row.postal_code ?? '',
    address,
    contactName: row.contact_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    paymentTermsDays: row.terms ?? 30,
    creditLimit: row.credit_limit_cents === null ? '' : centsToDecimal(row.credit_limit_cents),
    creditHold: row.credit_hold ?? false,
    creditHoldReason: row.credit_hold_reason ?? '',
  };
}

const customerSelect = sql`
  SELECT
    p.id,
    p.display_name AS name,
    COALESCE(p.vat_number, '') AS vat,
    a.line1,
    a.line2,
    a.suburb,
    a.city,
    a.province,
    a.postal_code,
    c.name AS contact_name,
    COALESCE(c.email, ch.email) AS email,
    COALESCE(c.phone, ch.phone) AS phone,
    t.payment_terms_days AS terms,
    t.credit_limit_cents, t.credit_hold, t.credit_hold_reason
  FROM parties AS p
  JOIN party_roles AS r ON r.party_id = p.id AND r.role = 'customer'
  LEFT JOIN LATERAL (
    SELECT line1, line2, suburb, city, province, postal_code
    FROM party_addresses
    WHERE party_id = p.id AND kind IN ('billing', 'physical')
    ORDER BY CASE kind WHEN 'billing' THEN 0 ELSE 1 END, is_primary DESC
    LIMIT 1
  ) AS a ON true
  LEFT JOIN LATERAL (
    SELECT name, email, phone
    FROM party_contacts
    WHERE party_id = p.id
    ORDER BY is_primary DESC, created_at
    LIMIT 1
  ) AS c ON true
  LEFT JOIN LATERAL (
    SELECT
      max(value) FILTER (WHERE kind = 'email') AS email,
      max(value) FILTER (WHERE kind = 'phone') AS phone
    FROM party_channels
    WHERE party_id = p.id AND is_primary
  ) AS ch ON true
  LEFT JOIN o2c_customer_terms AS t ON t.party_id = p.id
`;

async function assertCustomerAccess(tx: TenantTransaction, actor: Actor, write: boolean) {
  const access = await salesAccess(tx, actor.userId);
  if (write && !access.editCustomers) {
    throw new SalesError('Your role cannot change customers.', 403);
  }
  if (!write && !access.customers) {
    throw new SalesError('Your role cannot open customers.', 403);
  }
  return access;
}

export async function listCustomers(tx: TenantTransaction, actor: Actor, query: string) {
  const access = await assertCustomerAccess(tx, actor, false);
  const q = query.trim().slice(0, 80);
  const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = await many<CustomerRow>(
    tx,
    sql`
      ${customerSelect}
      WHERE p.status = 'active'
        AND (
          ${q} = ''
          OR p.display_name ILIKE ${like} ESCAPE '\\'
          OR COALESCE(p.vat_number, '') ILIKE ${like} ESCAPE '\\'
          OR COALESCE(a.city, '') ILIKE ${like} ESCAPE '\\'
        )
      ORDER BY p.display_name
      LIMIT 200
    `,
  );
  return { customers: rows.map(present), access };
}

export async function getCustomer(tx: TenantTransaction, actor: Actor, id: string) {
  await assertCustomerAccess(tx, actor, false);
  const row = await one<CustomerRow>(tx, sql`${customerSelect} WHERE p.id = ${id}`);
  if (!row) {
    throw new SalesError('That customer was not found.', 404);
  }
  const fields = await customFieldState(tx, actor, 'customer', id);
  return { customer: present(row), ...fields };
}

async function assertVatFree(tx: TenantTransaction, vat: string | null, id: string | null) {
  if (!vat) {
    return;
  }
  const existing = await one<{ id: string }>(
    tx,
    sql`
      SELECT id FROM parties
      WHERE vat_number = ${vat} AND status = 'active' AND (${id}::uuid IS NULL OR id <> ${id})
      LIMIT 1
    `,
  );
  if (existing) {
    throw new SalesError('Another customer already uses that VAT number.');
  }
}

export async function saveCustomer(
  tx: TenantTransaction,
  actor: Actor,
  id: string | null,
  input: CustomerInput,
) {
  await assertCustomerAccess(tx, actor, true);
  const name = clean(input.name, 'a customer name', 160, true);
  const vat = vatOf(input.vatNumber);
  const line1 = clean(input.line1, 'a billing address', 160, true);
  const line2 = clean(input.line2, 'an address line', 160, false);
  const suburb = clean(input.suburb, 'a suburb', 80, false);
  const city = clean(input.city, 'a city', 80, true);
  const province = provinceOf(input.province);
  const postalCode = clean(input.postalCode, 'a postal code', 12, false);
  const contactName = clean(input.contactName, 'a contact name', 120, true);
  const email = clean(input.email, 'an email', 160, false).toLowerCase();
  const phone = clean(input.phone, 'a phone number', 40, false);
  const terms = termsOf(input.paymentTermsDays);
  let creditLimit: bigint | null = null;
  if (input.creditLimit.trim()) {
    try {
      creditLimit = zarFromDecimal(input.creditLimit.trim()).amountCents;
      if (creditLimit < 0n) throw new Error('Credit limit cannot be negative.');
    } catch (error) {
      throw new SalesError(error instanceof Error ? error.message : 'Enter a valid credit limit.');
    }
  }
  const creditHold = input.creditHold === true;
  const creditHoldReason = clean(input.creditHoldReason, 'a credit hold reason', 240, false);
  if (creditHold && !creditHoldReason) throw new SalesError('Enter a reason for placing this customer on credit hold.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SalesError('Enter a valid email address.');
  }
  await assertVatFree(tx, vat, id);

  const partyId = id ?? randomUUID();
  if (!id) {
    await tx.db.execute(sql`
      INSERT INTO parties (
        id, tenant_id, kind, display_name, legal_name, vat_number,
        popia_consent, status, created_by
      ) VALUES (
        ${partyId}, ${tx.tenantId}, 'organisation', ${name}, ${name}, ${vat},
        false, 'active', ${actor.userId}
      )
    `);
    await tx.db.execute(sql`
      INSERT INTO party_roles (tenant_id, party_id, role)
      VALUES (${tx.tenantId}, ${partyId}, 'customer')
    `);
  } else {
    const current = await one<{ id: string }>(
      tx,
      sql`
        SELECT p.id
        FROM parties AS p
        JOIN party_roles AS r ON r.party_id = p.id AND r.role = 'customer'
        WHERE p.id = ${id} AND p.status = 'active'
      `,
    );
    if (!current) {
      throw new SalesError('That customer was not found.', 404);
    }
    await tx.db.execute(sql`
      UPDATE parties
      SET display_name = ${name}, vat_number = ${vat}, updated_at = now()
      WHERE id = ${id}
    `);
  }

  const addressId = await one<{ id: string }>(
    tx,
    sql`
      SELECT id FROM party_addresses
      WHERE party_id = ${partyId} AND kind = 'billing'
      ORDER BY is_primary DESC
      LIMIT 1
    `,
  );
  if (addressId) {
    await tx.db.execute(sql`
      UPDATE party_addresses
      SET line1 = ${line1}, line2 = ${line2 || null}, suburb = ${suburb || null},
          city = ${city}, province = ${province}, postal_code = ${postalCode || null},
          is_primary = true
      WHERE id = ${addressId.id}
    `);
  } else {
    await tx.db.execute(sql`
      INSERT INTO party_addresses (
        tenant_id, party_id, kind, line1, line2, suburb, city, province, postal_code, country, is_primary
      ) VALUES (
        ${tx.tenantId}, ${partyId}, 'billing', ${line1}, ${line2 || null}, ${suburb || null},
        ${city}, ${province}, ${postalCode || null}, 'ZA', true
      )
    `);
  }

  const contact = await one<{ id: string }>(
    tx,
    sql`
      SELECT id FROM party_contacts
      WHERE party_id = ${partyId}
      ORDER BY is_primary DESC, created_at
      LIMIT 1
    `,
  );
  if (contact) {
    await tx.db.execute(sql`
      UPDATE party_contacts
      SET name = ${contactName}, email = ${email || null}, phone = ${phone || null}, is_primary = true
      WHERE id = ${contact.id}
    `);
  } else {
    await tx.db.execute(sql`
      INSERT INTO party_contacts (tenant_id, party_id, name, email, phone, is_primary)
      VALUES (${tx.tenantId}, ${partyId}, ${contactName}, ${email || null}, ${phone || null}, true)
    `);
  }

  await tx.db.execute(sql`
    INSERT INTO o2c_customer_terms (tenant_id, party_id, payment_terms_days, credit_limit_cents, credit_hold, credit_hold_reason)
    VALUES (${tx.tenantId}, ${partyId}, ${terms}, ${creditLimit}, ${creditHold}, ${creditHoldReason})
    ON CONFLICT (tenant_id, party_id)
    DO UPDATE SET payment_terms_days = EXCLUDED.payment_terms_days, credit_limit_cents = EXCLUDED.credit_limit_cents,
      credit_hold = EXCLUDED.credit_hold, credit_hold_reason = EXCLUDED.credit_hold_reason, updated_at = now()
  `);

  await storeCustomFields(tx, actor, 'customer', partyId, input.customFields);
  await audit(
    tx,
    actor,
    id ? 'sales.customer.updated' : 'sales.customer.created',
    'party',
    partyId,
    {
      name,
      vatNumber: vat,
      paymentTermsDays: terms,
      creditLimitCents: creditLimit?.toString() ?? null,
      creditHold,
      creditHoldReason,
    },
  );
  return getCustomer(tx, actor, partyId);
}

export async function customerSnapshot(tx: TenantTransaction, partyId: string) {
  const row = await one<CustomerRow>(
    tx,
    sql`${customerSelect} WHERE p.id = ${partyId} AND p.status = 'active'`,
  );
  if (!row) {
    throw new SalesError('Choose a customer.');
  }
  const view = present(row);
  return {
    partyId: view.id,
    name: view.name,
    vat: view.vatNumber,
    address: view.address,
    contact: [view.contactName, view.email, view.phone].filter(Boolean).join(' · '),
    termsDays: view.paymentTermsDays,
  };
}
