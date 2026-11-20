import { sql } from 'drizzle-orm';
import { asNumber, joined, oneOf, rowsOf } from '../db';
import type { PartyDirectory, PartyRecord, PartySnapshot } from '../ports';

function mapParty(row: Record<string, unknown>): PartyRecord {
  return {
    id: String(row.id),
    displayName: String(row.displayName),
    legalName: row.legalName == null ? null : String(row.legalName),
    kind: row.kind as PartyRecord['kind'],
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    vatNumber: row.vatNumber == null ? null : String(row.vatNumber),
    addressLine: row.addressLine == null ? null : String(row.addressLine),
    city: row.city == null ? null : String(row.city),
    postalCode: row.postalCode == null ? null : String(row.postalCode),
    notes: row.notes == null ? null : String(row.notes),
    startedOn: row.startedOn == null ? null : String(row.startedOn).slice(0, 10),
    generation: asNumber(row.generation),
    lastBatchId: row.lastBatchId == null ? null : String(row.lastBatchId),
    archivedAt: row.archivedAt instanceof Date ? row.archivedAt : null,
  };
}

const partyColumns = sql`
  id,
  display_name AS "displayName",
  legal_name AS "legalName",
  kind,
  email,
  phone,
  vat_number AS "vatNumber",
  address_line AS "addressLine",
  city,
  postal_code AS "postalCode",
  notes,
  started_on AS "startedOn",
  generation,
  last_batch_id AS "lastBatchId",
  archived_at AS "archivedAt"
`;

/**
 * Provisional party directory. Swap this object for KRN-02 in register-contacts.ts.
 * Any edit outside an import must call markTouched so the import can be undone safely.
 */
export const provisionalPartyDirectory: PartyDirectory = {
  async findByEmail(tx, email) {
    const row = await oneOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${partyColumns} FROM krn06_parties
          WHERE email = ${email} AND archived_at IS NULL
          LIMIT 1`,
    );
    return row ? mapParty(row) : null;
  },

  async findByVat(tx, vatNumber) {
    const row = await oneOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${partyColumns} FROM krn06_parties
          WHERE vat_number = ${vatNumber} AND archived_at IS NULL
          LIMIT 1`,
    );
    return row ? mapParty(row) : null;
  },

  async get(tx, id) {
    const row = await oneOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${partyColumns} FROM krn06_parties WHERE id = ${id}::uuid`,
    );
    return row ? mapParty(row) : null;
  },

  async listActive(tx) {
    const list = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${partyColumns} FROM krn06_parties
          WHERE archived_at IS NULL
          ORDER BY display_name, id`,
    );
    return list.map(mapParty);
  },

  async createMany(tx, rows) {
    if (rows.length === 0) {
      return;
    }
    const tenant = tx.tenantId;
    const tuples = rows.map(
      (row) => sql`(
        ${row.id}::uuid,
        ${tenant}::uuid,
        ${row.draft.displayName},
        ${row.draft.legalName},
        ${row.draft.kind},
        ${row.draft.email},
        ${row.draft.phone},
        ${row.draft.vatNumber},
        ${row.draft.addressLine},
        ${row.draft.city},
        ${row.draft.postalCode},
        ${row.draft.notes},
        ${row.draft.startedOn}::date,
        ${row.batchId}::uuid
      )`,
    );
    await tx.db.execute(sql`
      INSERT INTO krn06_parties (
        id, tenant_id, display_name, legal_name, kind, email, phone, vat_number,
        address_line, city, postal_code, notes, started_on, last_batch_id
      )
      VALUES ${joined(tuples)}
    `);
  },

  async update(tx, id, draft, batchId) {
    const row = await oneOf<{ generation: number }>(
      tx,
      sql`UPDATE krn06_parties SET
            display_name = ${draft.displayName},
            legal_name = ${draft.legalName},
            kind = ${draft.kind},
            email = ${draft.email},
            phone = ${draft.phone},
            vat_number = ${draft.vatNumber},
            address_line = ${draft.addressLine},
            city = ${draft.city},
            postal_code = ${draft.postalCode},
            notes = ${draft.notes},
            started_on = ${draft.startedOn}::date,
            generation = generation + 1,
            last_batch_id = ${batchId}::uuid,
            updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING generation`,
    );
    if (!row) {
      throw new Error('That contact was not found.');
    }
    return asNumber(row.generation);
  },

  async archive(tx, id) {
    await tx.db.execute(sql`
      UPDATE krn06_parties
      SET archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },

  async restore(tx, id, previous: PartySnapshot) {
    await tx.db.execute(sql`
      UPDATE krn06_parties SET
        display_name = ${previous.displayName},
        legal_name = ${previous.legalName},
        kind = ${previous.kind},
        email = ${previous.email},
        phone = ${previous.phone},
        vat_number = ${previous.vatNumber},
        address_line = ${previous.addressLine},
        city = ${previous.city},
        postal_code = ${previous.postalCode},
        notes = ${previous.notes},
        started_on = ${previous.startedOn}::date,
        generation = ${previous.generation},
        last_batch_id = ${previous.lastBatchId}::uuid,
        updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },

  async markTouched(tx, id) {
    await tx.db.execute(sql`
      UPDATE krn06_parties
      SET generation = generation + 1, last_batch_id = NULL, updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },
};

export function snapshotParty(party: PartyRecord): PartySnapshot {
  return {
    displayName: party.displayName,
    legalName: party.legalName,
    kind: party.kind,
    email: party.email,
    phone: party.phone,
    vatNumber: party.vatNumber,
    addressLine: party.addressLine,
    city: party.city,
    postalCode: party.postalCode,
    notes: party.notes,
    startedOn: party.startedOn,
    generation: party.generation,
    lastBatchId: party.lastBatchId,
  };
}
