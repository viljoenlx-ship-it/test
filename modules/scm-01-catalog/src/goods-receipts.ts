import { randomUUID } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';
import { clampLabelCopies, defaultLabelCopies, nextGoodsReceiptNumber } from '@omnivate/shared';
import { stockAccess } from './access';
import { barcodeArtwork } from './barcode-art';
import { receiveStock, type Actor, type MoveInput } from './catalog';
import { formatQuantity, parseQuantity, quantityPhrase } from './costing';
import { CatalogError } from './errors';
import { ensureItemBarcode } from './item-barcodes';
import { goodsReceiptLines, goodsReceipts, items, labelPrints, settings } from './schema';

export type GoodsReceiptLineInput = MoveInput;

const MAX_LINES = 40;

function centsInput(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function receivedOn(value: Date): string {
  return value.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  });
}

async function readLabelSize(tx: TenantTransaction) {
  const rows = await tx.db.select().from(settings);
  const row = rows[0];
  return {
    widthMm: row?.labelWidthMm ?? '50.00',
    heightMm: row?.labelHeightMm ?? '15.00',
    printer: row?.labelPrinter ?? 'Niimbot M2_H',
  };
}

async function receiptLines(tx: TenantTransaction, goodsReceiptId: string) {
  return tx.db
    .select({
      id: goodsReceiptLines.id,
      lineNo: goodsReceiptLines.lineNo,
      itemId: goodsReceiptLines.itemId,
      quantity: goodsReceiptLines.quantity,
      name: items.name,
      code: items.sku,
      barcode: items.barcode,
      unit: items.baseUom,
      unitPlural: items.baseUomPlural,
    })
    .from(goodsReceiptLines)
    .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
    .where(eq(goodsReceiptLines.goodsReceiptId, goodsReceiptId))
    .orderBy(asc(goodsReceiptLines.lineNo));
}

function lineView(line: {
  id: string;
  itemId: string;
  name: string;
  code: string;
  barcode: string | null;
  quantity: string;
  unit: string;
  unitPlural: string;
}) {
  const micros = parseQuantity(line.quantity);
  return {
    id: line.id,
    itemId: line.itemId,
    name: line.name,
    code: line.code,
    barcode: line.barcode ?? '',
    quantity: formatQuantity(micros),
    quantityLabel: quantityPhrase(micros, line.unit, line.unitPlural),
    unit: line.unit,
    defaultCopies: defaultLabelCopies(formatQuantity(micros)),
  };
}

export async function listGoodsReceipts(tx: TenantTransaction, actor: Actor) {
  await stockAccess(tx, actor.userId);
  const rows = await tx.db
    .select()
    .from(goodsReceipts)
    .orderBy(desc(goodsReceipts.receivedAt))
    .limit(15);
  const lines = rows.length
    ? await tx.db
        .select({
          goodsReceiptId: goodsReceiptLines.goodsReceiptId,
        })
        .from(goodsReceiptLines)
    : [];
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.goodsReceiptId, (counts.get(line.goodsReceiptId) ?? 0) + 1);
  }
  return {
    receipts: rows.map((row) => ({
      id: row.id,
      number: row.number,
      note: row.note,
      receivedOn: receivedOn(row.receivedAt),
      lineCount: counts.get(row.id) ?? 0,
    })),
  };
}

export async function getGoodsReceipt(tx: TenantTransaction, actor: Actor, goodsReceiptId: string) {
  const access = await stockAccess(tx, actor.userId);
  const rows = await tx.db.select().from(goodsReceipts).where(eq(goodsReceipts.id, goodsReceiptId));
  const receipt = rows[0];
  if (!receipt) {
    throw new CatalogError('That goods receipt was not found.', 404);
  }
  const lines = await receiptLines(tx, receipt.id);
  return {
    access: { canPrint: access.operate },
    receipt: {
      id: receipt.id,
      number: receipt.number,
      branchId: receipt.branchId,
      note: receipt.note,
      receivedOn: receivedOn(receipt.receivedAt),
      lines: lines.map(lineView),
    },
  };
}

/**
 * Post one goods receipt by calling the existing receipt movement for each line.
 * The movement rows stay append-only and keep their current shape.
 */
export async function receiveGoods(
  tx: TenantTransaction,
  actor: Actor,
  input: {
    branchId: string;
    note: string;
    supplierPartyId?: string | null;
    lines: GoodsReceiptLineInput[];
  },
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot receive stock.', 403);
  }
  if (input.lines.length === 0) {
    throw new CatalogError('Add at least one line.');
  }
  if (input.lines.length > MAX_LINES) {
    throw new CatalogError(`A goods receipt can have up to ${MAX_LINES} lines.`);
  }
  const note = input.note.trim();
  if (note.length > 200) {
    throw new CatalogError('Shorten the note.');
  }
  const posted: { itemId: string; movementId: string; quantity: string }[] = [];
  for (const line of input.lines) {
    const quantity = enteredQuantity(line.quantity);
    const result = await receiveStock(tx, actor, {
      ...line,
      branchId: input.branchId,
      quantity,
      reason: line.reason?.trim() || note,
      glPartyId: input.supplierPartyId ?? null,
    });
    posted.push({ itemId: line.itemId, movementId: result.movementId, quantity });
  }
  const numbers = await tx.db.select({ number: goodsReceipts.number }).from(goodsReceipts);
  const id = randomUUID();
  const number = nextGoodsReceiptNumber(numbers.map((row) => row.number));
  try {
    await tx.db.insert(goodsReceipts).values({
      id,
      tenantId: tx.tenantId,
      number,
      branchId: input.branchId,
      note,
      actorId: actor.userId,
    });
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new CatalogError('That goods receipt number was just used. Save again.');
    }
    throw error;
  }
  for (const [index, line] of posted.entries()) {
    await tx.db.insert(goodsReceiptLines).values({
      tenantId: tx.tenantId,
      goodsReceiptId: id,
      lineNo: index + 1,
      itemId: line.itemId,
      movementId: line.movementId,
      quantity: line.quantity,
    });
  }
  await appendAuditEvent(tx, {
    action: 'scm.goods_receipt.posted',
    entityType: 'scm_goods_receipt',
    entityId: id,
    actorId: actor.userId,
    beforeData: null,
    afterData: {
      number,
      lines: posted.map((line) => ({
        itemId: line.itemId,
        movementId: line.movementId,
        quantity: line.quantity,
      })),
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  const view = await getGoodsReceipt(tx, actor, id);
  return { ...view, movements: posted };
}

export async function findScannedItem(tx: TenantTransaction, actor: Actor, code: string) {
  const access = await stockAccess(tx, actor.userId);
  const needle = code.trim().toLowerCase();
  if (!needle) {
    throw new CatalogError('Scan a barcode.');
  }
  const rows = await tx.db
    .select()
    .from(items)
    .where(sql`lower(${items.barcode}) = ${needle} OR lower(${items.sku}) = ${needle}`);
  const item =
    rows.find((row) => row.barcode?.toLowerCase() === needle) ??
    rows.find((row) => row.sku.toLowerCase() === needle) ??
    null;
  if (!item) {
    return { code: code.trim(), item: null };
  }
  return {
    code: code.trim(),
    item: {
      id: item.id,
      name: item.name,
      code: item.sku,
      barcode: item.barcode ?? '',
      unit: item.baseUom,
      kind: item.kind,
      cost: access.costs ? centsInput(item.costCents) : null,
      tracksSerials: item.trackSerials,
      tracksBatches: item.trackBatches,
    },
  };
}

async function labelFace(
  tx: TenantTransaction,
  actor: Actor,
  line: {
    id: string;
    itemId: string;
    name: string;
    code: string;
    barcode: string | null;
    quantity: string;
    unit: string;
    unitPlural: string;
  },
  grvNumber: string,
  when: string,
) {
  const barcode = await ensureItemBarcode(tx, actor, line.itemId);
  const art = barcodeArtwork(barcode);
  const view = lineView({ ...line, barcode });
  const size = await readLabelSize(tx);
  return {
    ...view,
    barcode,
    symbology: art.symbology,
    svg: art.svg,
    modules: art.modules,
    meta: `${grvNumber} · ${when}`,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    printer: size.printer,
  };
}

/** Assign any missing barcodes and return one face per line. Does not record a print. */
export async function previewGoodsReceiptLabels(
  tx: TenantTransaction,
  actor: Actor,
  goodsReceiptId: string,
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot print labels.', 403);
  }
  const receipt = await getGoodsReceipt(tx, actor, goodsReceiptId);
  const lines = await receiptLines(tx, goodsReceiptId);
  const labels = [];
  for (const line of lines) {
    labels.push(
      await labelFace(tx, actor, line, receipt.receipt.number, receipt.receipt.receivedOn),
    );
  }
  const size = await readLabelSize(tx);
  return {
    grvNumber: receipt.receipt.number,
    receivedOn: receipt.receipt.receivedOn,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    printer: size.printer,
    labels,
  };
}

/** Record one audit row per item in the batch, then return the faces to print. */
export async function printGoodsReceiptLabels(
  tx: TenantTransaction,
  actor: Actor,
  goodsReceiptId: string,
  requested: { lineId: string; copies: number }[],
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot print labels.', 403);
  }
  const receipt = await getGoodsReceipt(tx, actor, goodsReceiptId);
  const lines = await receiptLines(tx, goodsReceiptId);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const chosen: { line: (typeof lines)[number]; copies: number }[] = [];
  for (const request of requested) {
    const line = byId.get(request.lineId);
    if (!line) {
      throw new CatalogError('That line is not on this goods receipt.');
    }
    const copies = clampLabelCopies(request.copies);
    if (copies < 1) {
      continue;
    }
    chosen.push({ line, copies });
  }
  if (chosen.length === 0) {
    throw new CatalogError('Choose at least one label.');
  }
  const labels = [];
  const audited: { itemId: string; item: string; copies: number; barcode: string }[] = [];
  for (const entry of chosen) {
    const face = await labelFace(
      tx,
      actor,
      entry.line,
      receipt.receipt.number,
      receipt.receipt.receivedOn,
    );
    await tx.db.insert(labelPrints).values({
      tenantId: tx.tenantId,
      goodsReceiptId,
      itemId: entry.line.itemId,
      copies: entry.copies,
      barcode: face.barcode,
      actorId: actor.userId,
    });
    audited.push({
      itemId: entry.line.itemId,
      item: entry.line.name,
      copies: entry.copies,
      barcode: face.barcode,
    });
    labels.push({ ...face, copies: entry.copies });
  }
  await appendAuditEvent(tx, {
    action: 'scm.label.printed',
    entityType: 'scm_goods_receipt',
    entityId: goodsReceiptId,
    actorId: actor.userId,
    beforeData: null,
    afterData: {
      number: receipt.receipt.number,
      lines: audited,
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  const total = audited.reduce((sum, line) => sum + line.copies, 0);
  const size = await readLabelSize(tx);
  return {
    grvNumber: receipt.receipt.number,
    receivedOn: receipt.receipt.receivedOn,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    printer: size.printer,
    total,
    labels,
  };
}

function enteredQuantity(value: string): string {
  try {
    const micros = parseQuantity(value);
    if (micros <= 0n) {
      throw new Error('low');
    }
    return formatQuantity(micros);
  } catch {
    throw new CatalogError('Enter a quantity greater than zero.');
  }
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
