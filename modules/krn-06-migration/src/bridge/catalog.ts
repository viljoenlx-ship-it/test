import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { asBigint, asNumber, joined, oneOf, rowsOf } from '../db';
import type { CatalogPort, ItemRecord, ItemSnapshot } from '../ports';

function mapItem(row: Record<string, unknown>): ItemRecord {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    unit: String(row.unit),
    description: row.description == null ? null : String(row.description),
    costCents: asBigint(row.costCents),
    quantityMilli: asBigint(row.quantityMilli),
    branchId: row.branchId == null ? null : String(row.branchId),
    generation: asNumber(row.generation),
    lastBatchId: row.lastBatchId == null ? null : String(row.lastBatchId),
    archivedAt: row.archivedAt instanceof Date ? row.archivedAt : null,
  };
}

const itemColumns = sql`
  id,
  sku,
  name,
  unit,
  description,
  cost_cents AS "costCents",
  quantity_milli AS "quantityMilli",
  branch_id AS "branchId",
  generation,
  last_batch_id AS "lastBatchId",
  archived_at AS "archivedAt"
`;

async function countMovements(tx: TenantTransaction, itemId: string): Promise<number> {
  const row = await oneOf<{ count: number }>(
    tx,
    sql`SELECT count(*)::int AS count FROM krn06_stock_movements WHERE item_id = ${itemId}::uuid`,
  );
  return asNumber(row?.count);
}

/**
 * Provisional catalog. Swap this object for SCM-01 in register-stock.ts.
 * Opening stock is inserted as a posted movement. Later stock movement must
 * call markTouched, or be a new movement row, so undo can see the item was used.
 */
export const provisionalCatalog: CatalogPort = {
  async findBySku(tx, sku) {
    const row = await oneOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${itemColumns} FROM krn06_items
          WHERE lower(sku) = lower(${sku}) AND archived_at IS NULL
          LIMIT 1`,
    );
    return row ? mapItem(row) : null;
  },

  async get(tx, id) {
    const row = await oneOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${itemColumns} FROM krn06_items WHERE id = ${id}::uuid`,
    );
    return row ? mapItem(row) : null;
  },

  async listActive(tx) {
    const list = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${itemColumns} FROM krn06_items
          WHERE archived_at IS NULL
          ORDER BY sku, id`,
    );
    return list.map(mapItem);
  },

  movementCount: countMovements,

  async createMany(tx, rows) {
    if (rows.length === 0) {
      return;
    }
    const tenant = tx.tenantId;
    const items = rows.map(
      (row) => sql`(
        ${row.id}::uuid,
        ${tenant}::uuid,
        ${row.draft.sku},
        ${row.draft.name},
        ${row.draft.unit},
        ${row.draft.description},
        ${row.draft.costCents},
        ${row.draft.quantityMilli},
        ${row.branchId}::uuid,
        ${row.batchId}::uuid
      )`,
    );
    await tx.db.execute(sql`
      INSERT INTO krn06_items (
        id, tenant_id, sku, name, unit, description, cost_cents, quantity_milli, branch_id, last_batch_id
      )
      VALUES ${joined(items)}
    `);

    const movements = rows.map(
      (row) => sql`(
        ${randomUUID()}::uuid,
        ${tenant}::uuid,
        ${row.id}::uuid,
        ${row.batchId}::uuid,
        'opening',
        ${row.draft.quantityMilli},
        ${row.valueCents}
      )`,
    );
    await tx.db.execute(sql`
      INSERT INTO krn06_stock_movements (
        id, tenant_id, item_id, batch_id, kind, quantity_milli, value_cents
      )
      VALUES ${joined(movements)}
    `);
  },

  async update(tx, id, draft, batchId, deltaQuantityMilli, deltaValueCents, branchId) {
    const row = await oneOf<{ generation: number }>(
      tx,
      sql`UPDATE krn06_items SET
            sku = ${draft.sku},
            name = ${draft.name},
            unit = ${draft.unit},
            description = ${draft.description},
            cost_cents = ${draft.costCents},
            quantity_milli = ${draft.quantityMilli},
            branch_id = ${branchId}::uuid,
            generation = generation + 1,
            last_batch_id = ${batchId}::uuid,
            updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING generation`,
    );
    if (!row) {
      throw new Error('That stock item was not found.');
    }
    if (deltaQuantityMilli !== 0n || deltaValueCents !== 0n) {
      await tx.db.execute(sql`
        INSERT INTO krn06_stock_movements (
          tenant_id, item_id, batch_id, kind, quantity_milli, value_cents
        )
        VALUES (
          ${tx.tenantId}::uuid,
          ${id}::uuid,
          ${batchId}::uuid,
          'adjustment',
          ${deltaQuantityMilli},
          ${deltaValueCents}
        )
      `);
    }
    return { generation: asNumber(row.generation), movementCount: await countMovements(tx, id) };
  },

  async postReversal(tx, itemId, batchId, quantityMilli, valueCents) {
    if (quantityMilli === 0n && valueCents === 0n) {
      return;
    }
    const original = await oneOf<{ id: string }>(
      tx,
      sql`SELECT id FROM krn06_stock_movements
          WHERE item_id = ${itemId}::uuid AND batch_id = ${batchId}::uuid AND kind <> 'reversal'
          ORDER BY created_at DESC
          LIMIT 1`,
    );
    await tx.db.execute(sql`
      INSERT INTO krn06_stock_movements (
        tenant_id, item_id, batch_id, kind, quantity_milli, value_cents, reverses_id
      )
      VALUES (
        ${tx.tenantId}::uuid,
        ${itemId}::uuid,
        ${batchId}::uuid,
        'reversal',
        ${quantityMilli},
        ${valueCents},
        ${original?.id ?? null}::uuid
      )
    `);
  },

  async archive(tx, id) {
    await tx.db.execute(sql`
      UPDATE krn06_items
      SET archived_at = COALESCE(archived_at, now()), quantity_milli = 0, updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },

  async restore(tx, id, previous: ItemSnapshot) {
    await tx.db.execute(sql`
      UPDATE krn06_items SET
        sku = ${previous.sku},
        name = ${previous.name},
        unit = ${previous.unit},
        description = ${previous.description},
        cost_cents = ${BigInt(previous.costCents)},
        quantity_milli = ${BigInt(previous.quantityMilli)},
        branch_id = ${previous.branchId}::uuid,
        generation = ${previous.generation},
        last_batch_id = ${previous.lastBatchId}::uuid,
        updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },

  async markTouched(tx, id) {
    await tx.db.execute(sql`
      UPDATE krn06_items
      SET generation = generation + 1, last_batch_id = NULL, updated_at = now()
      WHERE id = ${id}::uuid
    `);
  },
};

export function snapshotItem(item: ItemRecord): ItemSnapshot {
  return {
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    description: item.description,
    costCents: item.costCents.toString(),
    quantityMilli: item.quantityMilli.toString(),
    branchId: item.branchId,
    generation: item.generation,
    lastBatchId: item.lastBatchId,
  };
}
