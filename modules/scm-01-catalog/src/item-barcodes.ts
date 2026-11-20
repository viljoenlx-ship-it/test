import { eq } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';
import { barcodeTextError, nextInternalBarcode, nextInternalSequence } from '@omnivate/shared';
import { stockAccess } from './access';
import type { Actor } from './catalog';
import { CatalogError } from './errors';
import { items } from './schema';

async function takenBarcodes(tx: TenantTransaction): Promise<Set<string>> {
  const rows = await tx.db.select({ barcode: items.barcode }).from(items);
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.barcode) {
      taken.add(row.barcode);
    }
  }
  return taken;
}

export async function freshBarcode(tx: TenantTransaction): Promise<string> {
  const taken = await takenBarcodes(tx);
  return nextInternalBarcode(taken, nextInternalSequence(taken));
}

export function readableBarcode(value: string): string {
  const error = barcodeTextError(value);
  if (error) {
    throw new CatalogError(error);
  }
  return value;
}

/**
 * Keep a supplier barcode. When the item has none, store a tenant-unique Code 128 code.
 * The caller has already checked that this person may receive stock or edit the catalog.
 */
export async function ensureItemBarcode(
  tx: TenantTransaction,
  actor: Actor,
  itemId: string,
): Promise<string> {
  const rows = await tx.db.select().from(items).where(eq(items.id, itemId));
  const item = rows[0];
  if (!item) {
    throw new CatalogError('That item was not found.', 404);
  }
  if (item.barcode) {
    return item.barcode;
  }
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate && !access.editCatalog) {
    throw new CatalogError('Your role cannot assign a barcode.', 403);
  }
  const code = await freshBarcode(tx);
  try {
    await tx.db
      .update(items)
      .set({ barcode: code, updatedAt: new Date() })
      .where(eq(items.id, item.id));
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new CatalogError('That barcode is already used.');
    }
    throw error;
  }
  await appendAuditEvent(tx, {
    action: 'scm.barcode.assigned',
    entityType: 'scm_item',
    entityId: item.id,
    actorId: actor.userId,
    beforeData: { barcode: null },
    afterData: { barcode: code, name: item.name, code: item.sku },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return code;
}

export async function assignItemBarcode(
  tx: TenantTransaction,
  actor: Actor,
  itemId: string,
  barcode: string,
): Promise<{ id: string; barcode: string }> {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate && !access.editCatalog) {
    throw new CatalogError('Your role cannot assign a barcode.', 403);
  }
  const code = readableBarcode(barcode.trim());
  const rows = await tx.db.select().from(items).where(eq(items.id, itemId));
  const item = rows[0];
  if (!item) {
    throw new CatalogError('That item was not found.', 404);
  }
  if (item.barcode === code) {
    return { id: item.id, barcode: code };
  }
  if (item.barcode) {
    throw new CatalogError('That item already has a barcode.');
  }
  try {
    await tx.db
      .update(items)
      .set({ barcode: code, updatedAt: new Date() })
      .where(eq(items.id, item.id));
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new CatalogError('That barcode is already used.');
    }
    throw error;
  }
  await appendAuditEvent(tx, {
    action: 'scm.barcode.assigned',
    entityType: 'scm_item',
    entityId: item.id,
    actorId: actor.userId,
    beforeData: { barcode: null },
    afterData: { barcode: code, name: item.name, code: item.sku },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return { id: item.id, barcode: code };
}

function uniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if ('code' in current && current.code === '23505') {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
