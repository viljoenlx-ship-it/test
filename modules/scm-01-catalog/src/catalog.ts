import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  appendAuditEvent,
  assertSegregation,
  BranchAccessError,
  hasPermission,
  loadBranchContext,
  requireBranchAccess,
  roles,
  sodRules,
  tenants,
  userRoles,
  users,
  type TenantTransaction,
} from '@omnivate/kernel';
import { postStockGl } from '@omnivate/module-fin-01';
import { recordChanged } from '@omnivate/module-krn-04';
import {
  formatZar,
  money,
  southAfricaPreset,
  type FormulaNumber,
  zarFromDecimal,
} from '@omnivate/shared';
import { stockAccess, type StockAccess } from './access';
import { barcodeArtwork } from './barcode-art';
import { ensureItemBarcode, freshBarcode, readableBarcode } from './item-barcodes';
import {
  adjustmentNeedsApproval,
  DEFAULT_ADJUSTMENT_APPROVAL_CENTS,
  extendCost,
  formatQuantity,
  parseQuantity,
  QTY_SCALE,
  quantityPhrase,
  toBaseQuantity,
  weightedAverageAfterReceiptReversal,
  weightedAverageOnReceipt,
} from './costing';
import { CatalogError } from './errors';
import {
  adjustmentRequests,
  balances,
  batchBalances,
  batches,
  itemUoms,
  items,
  movements,
  movementSerials,
  pendingPostings,
  serials,
  settings,
} from './schema';

export type Actor = {
  userId: string;
  requestIp: string | null;
  userAgent: string | null;
};

export type ItemWrite = {
  kind: 'stock' | 'service' | 'non_stock';
  sku: string;
  barcode: string;
  name: string;
  description: string;
  category: string;
  baseUom: string;
  baseUomPlural: string;
  cost: string;
  sellingPrice: string;
  reorderLevel: string;
  trackBatches: boolean;
  trackSerials: boolean;
  uoms: { name: string; plural: string; factor: string }[];
};

export type MoveInput = {
  itemId: string;
  branchId: string;
  quantity: string;
  uomName: string;
  unitCost?: string;
  reason?: string;
  batchCode?: string;
  expiresOn?: string;
  serials?: string[];
  toBranchId?: string;
  glTreatment?: 'standard' | 'opening' | 'sale';
  glPartyId?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  stock: 'Stock Item',
  service: 'Service',
  non_stock: 'Non-Stock',
};

type ItemRow = typeof items.$inferSelect;
type MovementRow = typeof movements.$inferSelect;

function centsLabel(value: bigint): string {
  return formatZar(money(value));
}

function centsInput(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function qtyLabel(micros: bigint, singular: string, plural: string): string {
  return quantityPhrase(micros < 0n ? -micros : micros, singular, plural);
}

function signedQtyLabel(micros: bigint, singular: string, plural: string): string {
  const phrase = quantityPhrase(micros, singular, plural);
  return micros > 0n ? `+${phrase}` : phrase.replace(/^-/, '−');
}

function shortDate(value: Date): string {
  return value.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  });
}

function whatLabel(kind: string, quantity: string): string {
  if (kind === 'receipt') return 'Received';
  if (kind === 'issue') return 'Wrote off';
  if (kind === 'transfer_out') return 'Transferred out';
  if (kind === 'transfer_in') return 'Transferred in';
  if (kind === 'reversal') return 'Reversed';
  return parseQuantity(quantity) < 0n ? 'Counted down' : 'Counted up';
}

function snapshot(item: ItemRow, packs: { name: string; factor: string }[]) {
  return {
    name: item.name,
    code: item.sku,
    barcode: item.barcode,
    kind: item.kind,
    category: item.category,
    unit: item.baseUom,
    costCents: item.costCents.toString(),
    sellingPriceCents: item.sellingPriceCents.toString(),
    vatRateBasisPoints: item.vatRateBasisPoints,
    reorderLevel: item.reorderLevel,
    trackBatches: item.trackBatches,
    trackSerials: item.trackSerials,
    status: item.status,
    packs,
  };
}

async function audit(
  tx: TenantTransaction,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
) {
  await appendAuditEvent(tx, {
    action,
    entityType,
    entityId,
    actorId: actor.userId,
    beforeData,
    afterData,
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
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

async function vatRate(tx: TenantTransaction): Promise<number> {
  const rows = await tx.db
    .select({ vat: tenants.vatRateBasisPoints })
    .from(tenants)
    .where(eq(tenants.id, tx.tenantId));
  return rows[0]?.vat ?? southAfricaPreset.vatStandardRateBasisPoints;
}

async function readSettings(tx: TenantTransaction) {
  const rows = await tx.db.select().from(settings);
  const row = rows[0];
  if (row) {
    return row;
  }
  await tx.db.insert(settings).values({
    tenantId: tx.tenantId,
    labelWidthMm: '50.00',
    labelHeightMm: '15.00',
    labelPrinter: 'Niimbot M2_H',
    adjustmentApprovalCents: DEFAULT_ADJUSTMENT_APPROVAL_CENTS,
  });
  const created = await tx.db.select().from(settings);
  const fresh = created[0];
  if (!fresh) {
    throw new CatalogError('Label settings could not be saved.', 500);
  }
  return fresh;
}

type Branch = { id: string; name: string; headOffice: boolean };

async function branchRows(tx: TenantTransaction, userId: string): Promise<Branch[]> {
  const context = await loadBranchContext(tx, userId);
  const rows = context.multiBranch ? context.branches : context.current ? [context.current] : [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    headOffice: row.isHeadOffice,
  }));
}

async function requireBranch(
  tx: TenantTransaction,
  userId: string,
  branchId: string,
): Promise<Branch> {
  try {
    const branch = await requireBranchAccess(tx, userId, branchId);
    return { id: branch.id, name: branch.name, headOffice: branch.isHeadOffice };
  } catch (error) {
    if (error instanceof BranchAccessError) {
      throw new CatalogError(error.message, 403);
    }
    throw error;
  }
}

async function loadItem(tx: TenantTransaction, itemId: string): Promise<ItemRow> {
  const rows = await tx.db.select().from(items).where(eq(items.id, itemId));
  const item = rows[0];
  if (!item) {
    throw new CatalogError('That item was not found.', 404);
  }
  return item;
}

async function packsFor(tx: TenantTransaction, itemId: string) {
  return tx.db
    .select({
      id: itemUoms.id,
      name: itemUoms.name,
      plural: itemUoms.plural,
      factor: itemUoms.factorToBase,
    })
    .from(itemUoms)
    .where(eq(itemUoms.itemId, itemId));
}

async function onHandMap(tx: TenantTransaction): Promise<Map<string, bigint>> {
  const rows = await tx.db
    .select({ itemId: balances.itemId, quantity: balances.quantity })
    .from(balances);
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    totals.set(row.itemId, (totals.get(row.itemId) ?? 0n) + parseQuantity(row.quantity));
  }
  return totals;
}

async function changeBalance(
  tx: TenantTransaction,
  itemId: string,
  branchId: string,
  delta: bigint,
) {
  const rows = await tx.db
    .select({ quantity: balances.quantity })
    .from(balances)
    .where(and(eq(balances.itemId, itemId), eq(balances.branchId, branchId)));
  const next = (rows[0] ? parseQuantity(rows[0].quantity) : 0n) + delta;
  if (next < 0n) {
    throw new CatalogError('There is not enough stock at that branch.');
  }
  const text = formatQuantity(next);
  if (!rows[0]) {
    await tx.db.insert(balances).values({
      tenantId: tx.tenantId,
      itemId,
      branchId,
      quantity: text,
    });
  } else {
    await tx.db
      .update(balances)
      .set({ quantity: text })
      .where(and(eq(balances.itemId, itemId), eq(balances.branchId, branchId)));
  }
}

async function batchQty(tx: TenantTransaction, batchId: string, branchId: string): Promise<bigint> {
  const rows = await tx.db
    .select({ quantity: batchBalances.quantity })
    .from(batchBalances)
    .where(and(eq(batchBalances.batchId, batchId), eq(batchBalances.branchId, branchId)));
  return rows[0] ? parseQuantity(rows[0].quantity) : 0n;
}

async function changeBatch(
  tx: TenantTransaction,
  batchId: string,
  branchId: string,
  delta: bigint,
) {
  const current = await batchQty(tx, batchId, branchId);
  const next = current + delta;
  if (next < 0n) {
    throw new CatalogError('There is not enough of that batch at this branch.');
  }
  const text = formatQuantity(next);
  if (current === 0n && delta !== 0n) {
    const existing = await tx.db
      .select({ quantity: batchBalances.quantity })
      .from(batchBalances)
      .where(and(eq(batchBalances.batchId, batchId), eq(batchBalances.branchId, branchId)));
    if (existing.length === 0) {
      await tx.db.insert(batchBalances).values({
        tenantId: tx.tenantId,
        batchId,
        branchId,
        quantity: text,
      });
      return;
    }
  }
  await tx.db
    .update(batchBalances)
    .set({ quantity: text })
    .where(and(eq(batchBalances.batchId, batchId), eq(batchBalances.branchId, branchId)));
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length < 1 || text.length > max) {
    throw new CatalogError(`Enter ${label}.`);
  }
  return text;
}

function parseMoney(value: string, label: string): bigint {
  try {
    return zarFromDecimal(value.trim()).amountCents;
  } catch {
    throw new CatalogError(`Enter ${label} in rands, such as 10.50.`);
  }
}

function positiveQty(value: string): bigint {
  let micros: bigint;
  try {
    micros = parseQuantity(value);
  } catch {
    throw new CatalogError('Enter a quantity greater than zero.');
  }
  if (micros <= 0n) {
    throw new CatalogError('Enter a quantity greater than zero.');
  }
  return micros;
}

async function factorFor(
  tx: TenantTransaction,
  item: ItemRow,
  uomName: string,
): Promise<{ factor: bigint; singular: string; plural: string }> {
  const name = uomName.trim();
  if (name.toLowerCase() === item.baseUom.trim().toLowerCase()) {
    return { factor: QTY_SCALE, singular: item.baseUom, plural: item.baseUomPlural };
  }
  const packs = await packsFor(tx, item.id);
  const pack = packs.find((row) => row.name.toLowerCase() === name.toLowerCase());
  if (!pack) {
    throw new CatalogError('Choose a unit this item uses.');
  }
  return { factor: parseQuantity(pack.factor), singular: pack.name, plural: pack.plural };
}

async function ensureSod(tx: TenantTransaction) {
  await tx.db
    .insert(sodRules)
    .values({
      tenantId: tx.tenantId,
      actionA: 'scm.adjustment.approve',
      actionB: 'scm.adjustment.submit',
      description: 'The person who asks for a stock adjustment cannot approve it.',
      enabled: true,
    })
    .onConflictDoNothing({
      target: [sodRules.tenantId, sodRules.actionA, sodRules.actionB],
    });
}

function accessFlags(access: StockAccess) {
  return {
    canEdit: access.editCatalog,
    canOperate: access.operate,
    canApprove: access.approve,
    canSeeCosts: access.costs,
    canSeeQuantities: access.quantities,
    canSeeValuation: access.valuation,
  };
}

function low(item: ItemRow, onHand: bigint): boolean {
  if (item.kind !== 'stock' || item.status !== 'active') {
    return false;
  }
  const reorder = parseQuantity(item.reorderLevel);
  return reorder > 0n && onHand <= reorder;
}

export async function listBranches(tx: TenantTransaction, actor: Actor) {
  await stockAccess(tx, actor.userId);
  const rows = await branchRows(tx, actor.userId);
  return {
    multiBranch: rows.length > 1,
    branches: rows.map((row) => ({ id: row.id, name: row.name, headOffice: row.headOffice })),
  };
}

export async function listItems(
  tx: TenantTransaction,
  actor: Actor,
  filter: 'active' | 'low' | 'archived',
  search: string,
) {
  const access = await stockAccess(tx, actor.userId);
  const totals = access.quantities ? await onHandMap(tx) : new Map<string, bigint>();
  const rows = await tx.db.select().from(items);
  const needle = search.trim().toLowerCase();
  const visible = rows
    .filter((item) => {
      if (filter === 'archived') {
        return item.status === 'archived';
      }
      if (item.status !== 'active') {
        return false;
      }
      if (filter === 'low') {
        return low(item, totals.get(item.id) ?? 0n);
      }
      return true;
    })
    .filter((item) => {
      if (!needle) {
        return true;
      }
      return [item.name, item.sku, item.barcode ?? '', item.category]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    })
    .sort((left, right) => {
      const leftExact =
        needle.length > 0 &&
        (left.barcode?.toLowerCase() === needle || left.sku.toLowerCase() === needle);
      const rightExact =
        needle.length > 0 &&
        (right.barcode?.toLowerCase() === needle || right.sku.toLowerCase() === needle);
      if (leftExact !== rightExact) {
        return leftExact ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  return {
    access: accessFlags(access),
    items: visible.map((item) => {
      const onHand = totals.get(item.id) ?? 0n;
      const valueCents = extendCost(onHand, item.costCents);
      return {
        id: item.id,
        name: item.name,
        code: item.sku,
        barcode: item.barcode ?? '',
        kind: item.kind,
        kindLabel: KIND_LABEL[item.kind] ?? item.kind,
        category: item.category,
        unit: item.baseUom,
        cost: access.costs ? centsInput(item.costCents) : null,
        tracksSerials: item.trackSerials,
        tracksBatches: item.trackBatches,
        onHandLabel:
          access.quantities && item.kind === 'stock'
            ? qtyLabel(onHand, item.baseUom, item.baseUomPlural)
            : null,
        costLabel: access.costs ? centsLabel(item.costCents) : null,
        priceLabel: centsLabel(item.sellingPriceCents),
        valueLabel: access.costs && item.kind === 'stock' ? centsLabel(valueCents) : null,
        low: access.quantities ? low(item, onHand) : false,
        archived: item.status === 'archived',
      };
    }),
  };
}

async function replacePacks(
  tx: TenantTransaction,
  itemId: string,
  baseUom: string,
  packs: { name: string; plural: string; factor: string }[],
) {
  await tx.db.delete(itemUoms).where(eq(itemUoms.itemId, itemId));
  const seen = new Set<string>([baseUom.trim().toLowerCase()]);
  for (const pack of packs) {
    const name = cleanText(pack.name, 'a unit name', 40);
    const plural = cleanText(pack.plural, 'the plural of that unit', 40);
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new CatalogError('Each extra unit needs its own name.');
    }
    seen.add(key);
    const factor = positiveQty(pack.factor);
    await tx.db.insert(itemUoms).values({
      tenantId: tx.tenantId,
      itemId,
      name,
      plural,
      factorToBase: formatQuantity(factor),
    });
  }
}

export async function saveItem(
  tx: TenantTransaction,
  actor: Actor,
  itemId: string | null,
  input: ItemWrite,
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.editCatalog) {
    throw new CatalogError('Your role cannot change the catalog.', 403);
  }
  if (input.trackBatches && input.trackSerials) {
    throw new CatalogError('Track batches or serial numbers, not both.');
  }
  const kind = input.kind;
  if (kind !== 'stock' && kind !== 'service' && kind !== 'non_stock') {
    throw new CatalogError('Choose stock, a service, or non-stock.');
  }
  const name = cleanText(input.name, 'a name', 120);
  const sku = cleanText(input.sku, 'an item code', 40);
  const baseUom = cleanText(input.baseUom, 'a unit', 40);
  const baseUomPlural = cleanText(input.baseUomPlural, 'the plural of that unit', 40);
  const suppliedBarcode = input.barcode.trim();
  const generatedBarcode = suppliedBarcode.length === 0;
  if (!generatedBarcode) {
    readableBarcode(suppliedBarcode);
  }
  const barcode = generatedBarcode ? await freshBarcode(tx) : suppliedBarcode;
  const description = input.description.trim();
  if (description.length > 2000) {
    throw new CatalogError('Shorten the description.');
  }
  const category = input.category.trim();
  if (category.length > 80) {
    throw new CatalogError('Shorten the category.');
  }
  const selling = parseMoney(input.sellingPrice, 'the selling price');
  const reorder = kind === 'stock' ? positiveOrZero(input.reorderLevel) : 0n;
  const trackBatches = kind === 'stock' && input.trackBatches;
  const trackSerials = kind === 'stock' && input.trackSerials;
  const rate = await vatRate(tx);

  try {
    if (!itemId) {
      const cost = parseMoney(input.cost, 'the cost');
      const id = randomUUID();
      await tx.db.insert(items).values({
        id,
        tenantId: tx.tenantId,
        kind,
        sku,
        barcode: barcode || null,
        name,
        description,
        category,
        baseUom,
        baseUomPlural,
        costCents: cost,
        sellingPriceCents: selling,
        vatRateBasisPoints: rate,
        reorderLevel: formatQuantity(reorder),
        trackBatches,
        trackSerials,
        status: 'active',
      });
      await replacePacks(tx, id, baseUom, input.uoms);
      const saved = await loadItem(tx, id);
      const packs = await packsFor(tx, id);
      await audit(tx, actor, 'scm.item.created', 'scm_item', id, null, snapshot(saved, packs));
      await noteNumbers(tx, actor, id, 'created', []);
      return { id };
    }

    const current = await loadItem(tx, itemId);
    const onHand = (await onHandMap(tx)).get(itemId) ?? 0n;
    if (current.kind === 'stock' && kind !== 'stock' && onHand !== 0n) {
      throw new CatalogError(
        'Clear the stock before changing this to a service or non-stock item.',
      );
    }
    if (current.trackSerials && !trackSerials) {
      const open = await tx.db
        .select({ id: serials.id })
        .from(serials)
        .where(and(eq(serials.itemId, itemId), eq(serials.status, 'in_stock')))
        .limit(1);
      if (open.length > 0) {
        throw new CatalogError('Serial numbers still in stock cannot be turned off.');
      }
    }
    let cost = parseMoney(input.cost, 'the cost');
    if (current.kind === 'stock' && onHand > 0n) {
      cost = current.costCents;
    }
    const beforePacks = await packsFor(tx, itemId);
    await tx.db
      .update(items)
      .set({
        kind,
        sku,
        barcode: barcode || null,
        name,
        description,
        category,
        baseUom,
        baseUomPlural,
        costCents: cost,
        sellingPriceCents: selling,
        vatRateBasisPoints: rate,
        reorderLevel: formatQuantity(reorder),
        trackBatches,
        trackSerials,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
    await replacePacks(tx, itemId, baseUom, input.uoms);
    const saved = await loadItem(tx, itemId);
    await audit(
      tx,
      actor,
      'scm.item.updated',
      'scm_item',
      itemId,
      snapshot(current, beforePacks),
      snapshot(saved, await packsFor(tx, itemId)),
    );
    const changed: string[] = [];
    if (current.sellingPriceCents !== selling) {
      changed.push('selling_price');
    }
    if (current.costCents !== cost) {
      changed.push('cost');
    }
    if (parseQuantity(current.reorderLevel) !== reorder) {
      changed.push('reorder_level');
    }
    if (changed.length > 0) {
      await noteNumbers(tx, actor, itemId, 'field_changed', changed);
    }
    return { id: itemId };
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new CatalogError(
        generatedBarcode
          ? 'That barcode was just taken. Save again.'
          : 'That item code or barcode is already used.',
      );
    }
    throw error;
  }
}

function positiveOrZero(value: string): bigint {
  const text = value.trim() === '' ? '0' : value;
  let micros: bigint;
  try {
    micros = parseQuantity(text);
  } catch {
    throw new CatalogError('Enter the reorder level as a quantity.');
  }
  if (micros < 0n) {
    throw new CatalogError('The reorder level cannot be negative.');
  }
  return micros;
}

export async function setItemStatus(
  tx: TenantTransaction,
  actor: Actor,
  itemId: string,
  status: 'active' | 'archived',
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.editCatalog) {
    throw new CatalogError('Your role cannot change the catalog.', 403);
  }
  const current = await loadItem(tx, itemId);
  if (current.status === status) {
    return { id: itemId };
  }
  await tx.db.update(items).set({ status, updatedAt: new Date() }).where(eq(items.id, itemId));
  const saved = await loadItem(tx, itemId);
  await audit(
    tx,
    actor,
    status === 'archived' ? 'scm.item.archived' : 'scm.item.restored',
    'scm_item',
    itemId,
    { status: current.status, name: current.name },
    { status: saved.status, name: saved.name },
  );
  return { id: itemId };
}

async function resolveMove(tx: TenantTransaction, item: ItemRow, input: MoveInput) {
  if (item.kind !== 'stock') {
    throw new CatalogError('Only stock items move through the ledger.');
  }
  if (item.status !== 'active') {
    throw new CatalogError('Restore this item before moving stock.');
  }
  const entered = positiveQty(input.quantity);
  const chosen = await factorFor(tx, item, input.uomName);
  const factor = chosen.factor;
  const base = toBaseQuantity(entered, factor);
  if (base <= 0n) {
    throw new CatalogError('That quantity is too small for this unit.');
  }
  const serialList = (input.serials ?? []).map((value) => value.trim()).filter(Boolean);
  if (item.trackSerials) {
    if (factor !== QTY_SCALE) {
      throw new CatalogError('Count serial numbers one at a time, in the base unit.');
    }
    if (BigInt(serialList.length) * QTY_SCALE !== base) {
      throw new CatalogError('Enter one serial number for each unit.');
    }
    if (new Set(serialList.map((value) => value.toLowerCase())).size !== serialList.length) {
      throw new CatalogError('Those serial numbers repeat.');
    }
  } else if (serialList.length > 0) {
    throw new CatalogError('This item does not track serial numbers.');
  }
  let batchId: string | null = null;
  if (item.trackBatches) {
    const code = (input.batchCode ?? '').trim();
    if (code.length < 1 || code.length > 40) {
      throw new CatalogError('Enter the batch or lot.');
    }
    const expires = (input.expiresOn ?? '').trim();
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      throw new CatalogError('Enter the expiry as a date.');
    }
    batchId = await upsertBatch(tx, item.id, code, expires || null);
  } else if ((input.batchCode ?? '').trim()) {
    throw new CatalogError('This item does not track batches.');
  }
  return {
    entered,
    factor,
    base,
    uomName: chosen.singular,
    uomPlural: chosen.plural,
    serialList,
    batchId,
  };
}

async function upsertBatch(
  tx: TenantTransaction,
  itemId: string,
  code: string,
  expiresOn: string | null,
): Promise<string> {
  const existing = await tx.db
    .select()
    .from(batches)
    .where(and(eq(batches.itemId, itemId), eq(batches.code, code)));
  const found = existing[0];
  if (found) {
    if (expiresOn && found.expiresOn !== expiresOn) {
      await tx.db.update(batches).set({ expiresOn }).where(eq(batches.id, found.id));
    }
    return found.id;
  }
  const id = randomUUID();
  await tx.db.insert(batches).values({
    id,
    tenantId: tx.tenantId,
    itemId,
    code,
    expiresOn,
  });
  return id;
}

async function applySerials(
  tx: TenantTransaction,
  item: ItemRow,
  movementId: string,
  branchId: string,
  serialList: string[],
  inbound: boolean,
) {
  for (const serial of serialList) {
    const rows = await tx.db
      .select()
      .from(serials)
      .where(and(eq(serials.itemId, item.id), eq(serials.serial, serial)));
    const current = rows[0];
    let serialId: string;
    if (inbound) {
      if (current?.status === 'in_stock') {
        throw new CatalogError(`Serial ${serial} is already in stock.`);
      }
      if (current) {
        serialId = current.id;
        await tx.db
          .update(serials)
          .set({ status: 'in_stock', branchId })
          .where(eq(serials.id, current.id));
      } else {
        serialId = randomUUID();
        await tx.db.insert(serials).values({
          id: serialId,
          tenantId: tx.tenantId,
          itemId: item.id,
          serial,
          branchId,
          status: 'in_stock',
        });
      }
    } else {
      if (!current || current.status !== 'in_stock' || current.branchId !== branchId) {
        throw new CatalogError(`Serial ${serial} is not in stock at that branch.`);
      }
      serialId = current.id;
      await tx.db
        .update(serials)
        .set({ status: 'issued', branchId: null })
        .where(eq(serials.id, current.id));
    }
    await tx.db.insert(movementSerials).values({
      tenantId: tx.tenantId,
      movementId,
      serialId,
    });
  }
}

function journalSides(kind: string, valueCents: bigint): { debit: string; credit: string } | null {
  if (valueCents === 0n || kind === 'transfer_in' || kind === 'transfer_out') {
    return null;
  }
  const increase = valueCents > 0n;
  if (kind === 'issue') {
    return increase
      ? { debit: 'inventory', credit: 'stock_write_off' }
      : { debit: 'stock_write_off', credit: 'inventory' };
  }
  if (kind === 'adjustment') {
    return increase
      ? { debit: 'inventory', credit: 'inventory_adjustment' }
      : { debit: 'inventory_adjustment', credit: 'inventory' };
  }
  return increase
    ? { debit: 'inventory', credit: 'stock_receipts_clearing' }
    : { debit: 'stock_receipts_clearing', credit: 'inventory' };
}

async function writePosting(
  tx: TenantTransaction,
  movementId: string,
  memo: string,
  quantityMicros: bigint,
  unitCostCents: bigint,
  valueCents: bigint,
  kind: string,
) {
  const sides = journalSides(kind, valueCents);
  if (!sides) {
    return;
  }
  const amount = valueCents < 0n ? -valueCents : valueCents;
  await tx.db.insert(pendingPostings).values({
    tenantId: tx.tenantId,
    movementId,
    memo,
    amountCents: amount,
    signedValueCents: valueCents,
    currencyCode: 'ZAR',
    debitAccount: sides.debit,
    creditAccount: sides.credit,
    quantity: formatQuantity(quantityMicros),
    unitCostCents,
  });
}

async function insertMovement(
  tx: TenantTransaction,
  actor: Actor,
  item: ItemRow,
  input: {
    branchId: string;
    kind: string;
    signedBase: bigint;
    entered: bigint;
    factor: bigint;
    uomName: string;
    uomPlural: string;
    unitCostCents: bigint;
    reason: string;
    batchId: string | null;
    serialList: string[];
    reversesMovementId?: string;
    transferGroupId?: string;
    journalKind?: string;
    occurredAt?: Date;
    glTreatment?: 'standard' | 'opening' | 'sale';
    glPartyId?: string | null;
  },
): Promise<string> {
  const inbound = input.signedBase > 0n;
  if (input.batchId) {
    await changeBatch(tx, input.batchId, input.branchId, input.signedBase);
  }
  await changeBalance(tx, item.id, input.branchId, input.signedBase);
  const journalKind = input.journalKind ?? input.kind;
  const valueCents =
    journalKind === 'transfer_in' || journalKind === 'transfer_out'
      ? 0n
      : extendCost(input.signedBase, input.unitCostCents);
  const id = randomUUID();
  await tx.db.insert(movements).values({
    id,
    tenantId: tx.tenantId,
    itemId: item.id,
    branchId: input.branchId,
    kind: input.kind,
    quantity: formatQuantity(input.signedBase),
    uomName: input.uomName,
    uomPlural: input.uomPlural,
    uomFactor: formatQuantity(input.factor),
    enteredQuantity: formatQuantity(input.entered < 0n ? -input.entered : input.entered),
    unitCostCents: input.unitCostCents,
    valueCents,
    reason: input.reason,
    status: 'posted',
    reversesMovementId: input.reversesMovementId ?? null,
    transferGroupId: input.transferGroupId ?? null,
    batchId: input.batchId,
    occurredAt: input.occurredAt ?? new Date(),
    actorId: actor.userId,
  });
  if (item.trackSerials) {
    await applySerials(tx, item, id, input.branchId, input.serialList, inbound);
  }
  await writePosting(
    tx,
    id,
    `${item.name} · ${input.reason || input.kind}`,
    input.signedBase,
    input.unitCostCents,
    valueCents,
    journalKind,
  );
  await postStockGl(tx, actor, {
    movementId: id,
    kind: input.kind,
    journalKind,
    valueCents,
    reason: input.reason,
    occurredAt: input.occurredAt ?? new Date(),
    glTreatment: input.glTreatment ?? 'standard',
    partyId: input.glPartyId ?? null,
    reversesMovementId: input.reversesMovementId ?? null,
  });
  return id;
}

export async function receiveStock(tx: TenantTransaction, actor: Actor, input: MoveInput) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot receive stock.', 403);
  }
  const item = await loadItem(tx, input.itemId);
  const branch = await requireBranch(tx, actor.userId, input.branchId);
  const move = await resolveMove(tx, item, input);
  const unitCost = parseMoney(input.unitCost ?? '', 'the cost');
  const onHand = (await onHandMap(tx)).get(item.id) ?? 0n;
  const average = weightedAverageOnReceipt({
    onHandMicros: onHand,
    averageCostCents: item.costCents,
    receiptMicros: move.base,
    receiptUnitCostCents: unitCost,
  });
  const reason = (input.reason ?? '').trim();
  const movementId = await insertMovement(tx, actor, item, {
    branchId: branch.id,
    kind: 'receipt',
    signedBase: move.base,
    entered: move.entered,
    factor: move.factor,
    uomName: move.uomName,
    uomPlural: move.uomPlural,
    unitCostCents: unitCost,
    reason,
    batchId: move.batchId,
    serialList: move.serialList,
    glTreatment: input.glTreatment,
    glPartyId: input.glPartyId,
  });
  await tx.db
    .update(items)
    .set({ costCents: average, updatedAt: new Date() })
    .where(eq(items.id, item.id));
  await audit(tx, actor, 'scm.movement.receipt', 'scm_movement', movementId, null, {
    item: item.name,
    branch: branch.name,
    quantity: formatQuantity(move.base),
    unitCostCents: unitCost.toString(),
    averageCostCents: average.toString(),
  });
  await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand', 'cost']);
  return { movementId, averageCostLabel: centsLabel(average) };
}

export async function issueStock(tx: TenantTransaction, actor: Actor, input: MoveInput) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot issue stock.', 403);
  }
  const reason = cleanText(input.reason ?? '', 'a reason', 200);
  const item = await loadItem(tx, input.itemId);
  const branch = await requireBranch(tx, actor.userId, input.branchId);
  const move = await resolveMove(tx, item, input);
  if (move.batchId && (await batchQty(tx, move.batchId, branch.id)) < move.base) {
    throw new CatalogError('There is not enough of that batch at this branch.');
  }
  const movementId = await insertMovement(tx, actor, item, {
    branchId: branch.id,
    kind: 'issue',
    signedBase: -move.base,
    entered: move.entered,
    factor: move.factor,
    uomName: move.uomName,
    uomPlural: move.uomPlural,
    unitCostCents: item.costCents,
    reason,
    batchId: move.batchId,
    serialList: move.serialList,
    glTreatment: input.glTreatment,
  });
  await audit(tx, actor, 'scm.movement.issue', 'scm_movement', movementId, null, {
    item: item.name,
    branch: branch.name,
    quantity: formatQuantity(move.base),
    reason,
    unitCostCents: item.costCents.toString(),
  });
  await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand']);
  return { movementId };
}

export async function transferStock(tx: TenantTransaction, actor: Actor, input: MoveInput) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot transfer stock.', 403);
  }
  const item = await loadItem(tx, input.itemId);
  const from = await requireBranch(tx, actor.userId, input.branchId);
  const to = await requireBranch(tx, actor.userId, input.toBranchId ?? '');
  if (from.id === to.id) {
    throw new CatalogError('Choose two different branches.');
  }
  const move = await resolveMove(tx, item, input);
  if (move.batchId && (await batchQty(tx, move.batchId, from.id)) < move.base) {
    throw new CatalogError('There is not enough of that batch at this branch.');
  }
  const group = randomUUID();
  const reason = (input.reason ?? '').trim() || `Transfer to ${to.name}`;
  const outId = await insertMovement(tx, actor, item, {
    branchId: from.id,
    kind: 'transfer_out',
    signedBase: -move.base,
    entered: move.entered,
    factor: move.factor,
    uomName: move.uomName,
    uomPlural: move.uomPlural,
    unitCostCents: item.costCents,
    reason,
    batchId: move.batchId,
    serialList: move.serialList,
    transferGroupId: group,
  });
  const inId = await insertMovement(tx, actor, item, {
    branchId: to.id,
    kind: 'transfer_in',
    signedBase: move.base,
    entered: move.entered,
    factor: move.factor,
    uomName: move.uomName,
    uomPlural: move.uomPlural,
    unitCostCents: item.costCents,
    reason: (input.reason ?? '').trim() || `Transfer from ${from.name}`,
    batchId: move.batchId,
    serialList: move.serialList,
    transferGroupId: group,
  });
  await audit(tx, actor, 'scm.movement.transfer', 'scm_movement', outId, null, {
    item: item.name,
    from: from.name,
    to: to.name,
    quantity: formatQuantity(move.base),
    pairId: inId,
  });
  return { movementId: outId };
}

export async function adjustStock(
  tx: TenantTransaction,
  actor: Actor,
  input: MoveInput & { direction: 'up' | 'down' },
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate && !access.approve) {
    throw new CatalogError('Your role cannot adjust stock.', 403);
  }
  const reason = cleanText(input.reason ?? '', 'a reason', 200);
  const item = await loadItem(tx, input.itemId);
  const branch = await requireBranch(tx, actor.userId, input.branchId);
  const move = await resolveMove(tx, item, input);
  const signed = input.direction === 'down' ? -move.base : move.base;
  const value = extendCost(signed < 0n ? -signed : signed, item.costCents);
  const threshold = (await readSettings(tx)).adjustmentApprovalCents;
  if (adjustmentNeedsApproval(value, threshold)) {
    const allowed = await hasPermission(tx, actor.userId, {
      scope: 'scm.catalog',
      action: 'approve',
      moduleId: 'SCM-01',
      amountCents: value,
    });
    if (!allowed) {
      if (item.trackBatches || item.trackSerials) {
        throw new CatalogError(
          'A manager needs to post batch and serial adjustments above the approval amount.',
        );
      }
      await ensureSod(tx);
      const id = randomUUID();
      await tx.db.insert(adjustmentRequests).values({
        id,
        tenantId: tx.tenantId,
        itemId: item.id,
        branchId: branch.id,
        quantity: formatQuantity(signed),
        unitCostCents: item.costCents,
        valueCents: value,
        reason,
        status: 'pending',
        requestedBy: actor.userId,
      });
      await audit(tx, actor, 'scm.adjustment.submit', 'scm_adjustment', id, null, {
        item: item.name,
        branch: branch.name,
        quantity: formatQuantity(signed),
        valueCents: value.toString(),
        reason,
      });
      return {
        pending: true as const,
        requestId: id,
        message: `This change is ${centsLabel(value)}, so a manager needs to approve it.`,
      };
    }
  }
  if (move.batchId && signed < 0n && (await batchQty(tx, move.batchId, branch.id)) < move.base) {
    throw new CatalogError('There is not enough of that batch at this branch.');
  }
  const movementId = await insertMovement(tx, actor, item, {
    branchId: branch.id,
    kind: 'adjustment',
    signedBase: signed,
    entered: move.entered,
    factor: move.factor,
    uomName: move.uomName,
    uomPlural: move.uomPlural,
    unitCostCents: item.costCents,
    reason,
    batchId: move.batchId,
    serialList: move.serialList,
  });
  await audit(tx, actor, 'scm.movement.adjustment', 'scm_movement', movementId, null, {
    item: item.name,
    branch: branch.name,
    quantity: formatQuantity(signed),
    reason,
    valueCents: extendCost(signed, item.costCents).toString(),
  });
  await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand']);
  return { pending: false as const, movementId };
}

export async function decideAdjustment(
  tx: TenantTransaction,
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'rejected',
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.approve) {
    throw new CatalogError('Your role cannot approve stock adjustments.', 403);
  }
  const rows = await tx.db
    .select()
    .from(adjustmentRequests)
    .where(eq(adjustmentRequests.id, requestId));
  const request = rows[0];
  if (!request || request.status !== 'pending') {
    throw new CatalogError('That adjustment is no longer waiting.', 404);
  }
  await ensureSod(tx);
  await assertSegregation(tx, {
    actorId: actor.userId,
    action: 'scm.adjustment.approve',
    entityId: request.id,
  });
  if (decision === 'approved') {
    const allowed = await hasPermission(tx, actor.userId, {
      scope: 'scm.catalog',
      action: 'approve',
      moduleId: 'SCM-01',
      amountCents: request.valueCents,
    });
    if (!allowed) {
      throw new CatalogError('This amount is above your approval limit.', 403);
    }
  }
  if (decision === 'rejected') {
    await tx.db
      .update(adjustmentRequests)
      .set({ status: 'rejected', decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(adjustmentRequests.id, request.id));
    await audit(
      tx,
      actor,
      'scm.adjustment.reject',
      'scm_adjustment',
      request.id,
      { status: 'pending', reason: request.reason },
      { status: 'rejected', reason: request.reason },
    );
    return { pending: false as const, movementId: null };
  }

  const item = await loadItem(tx, request.itemId);
  const signed = parseQuantity(request.quantity);
  const entered = signed < 0n ? -signed : signed;
  if (item.trackBatches || item.trackSerials) {
    throw new CatalogError('Approve batch and serial adjustments from a recount, not this queue.');
  }
  const movementId = await insertMovement(tx, actor, item, {
    branchId: request.branchId,
    kind: 'adjustment',
    signedBase: signed,
    entered,
    factor: QTY_SCALE,
    uomName: item.baseUom,
    uomPlural: item.baseUomPlural,
    unitCostCents: request.unitCostCents,
    reason: request.reason,
    batchId: null,
    serialList: [],
  });
  await tx.db
    .update(adjustmentRequests)
    .set({
      status: 'approved',
      movementId,
      decidedBy: actor.userId,
      decidedAt: new Date(),
    })
    .where(eq(adjustmentRequests.id, request.id));
  await audit(
    tx,
    actor,
    'scm.adjustment.approve',
    'scm_adjustment',
    request.id,
    { status: 'pending', valueCents: request.valueCents.toString() },
    { status: 'approved', movementId, valueCents: request.valueCents.toString() },
  );
  await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand']);
  return { pending: false as const, movementId };
}

export async function reverseMovement(
  tx: TenantTransaction,
  actor: Actor,
  movementId: string,
  reason: string,
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.operate) {
    throw new CatalogError('Your role cannot correct stock.', 403);
  }
  const note = cleanText(reason, 'a reason', 200);
  const rows = await tx.db.select().from(movements).where(eq(movements.id, movementId));
  const original = rows[0];
  if (!original) {
    throw new CatalogError('That movement was not found.', 404);
  }
  if (original.kind === 'reversal') {
    throw new CatalogError('Reverse the original movement.');
  }
  const prior = await tx.db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.reversesMovementId, original.id))
    .limit(1);
  if (prior.length > 0) {
    throw new CatalogError('That movement has already been corrected.');
  }
  if (original.transferGroupId) {
    const sides = await tx.db
      .select()
      .from(movements)
      .where(eq(movements.transferGroupId, original.transferGroupId));
    const inbound = sides.find((row) => row.kind === 'transfer_in');
    const outbound = sides.find((row) => row.kind === 'transfer_out');
    if (!inbound || !outbound) {
      throw new CatalogError('That transfer is incomplete.');
    }
    await reverseOne(tx, actor, inbound, note);
    const result = await reverseOne(tx, actor, outbound, note);
    return result;
  }
  return reverseOne(tx, actor, original, note);
}

async function reverseOne(
  tx: TenantTransaction,
  actor: Actor,
  original: MovementRow,
  note: string,
) {
  const item = await loadItem(tx, original.itemId);
  const signed = -parseQuantity(original.quantity);
  const serialLinks = await tx.db
    .select({ serial: serials.serial })
    .from(movementSerials)
    .innerJoin(serials, eq(serials.id, movementSerials.serialId))
    .where(eq(movementSerials.movementId, original.id));
  if (original.batchId && signed < 0n) {
    const have = await batchQty(tx, original.batchId, original.branchId);
    if (have < -signed) {
      throw new CatalogError('There is not enough of that batch left to reverse.');
    }
  }
  const id = await insertMovement(tx, actor, item, {
    branchId: original.branchId,
    kind: 'reversal',
    signedBase: signed,
    entered: parseQuantity(original.enteredQuantity),
    factor: parseQuantity(original.uomFactor),
    uomName: original.uomName,
    uomPlural: original.uomPlural,
    unitCostCents: original.unitCostCents,
    reason: note,
    batchId: original.batchId,
    serialList: serialLinks.map((row) => row.serial),
    reversesMovementId: original.id,
    transferGroupId: original.transferGroupId ?? undefined,
    journalKind: original.kind,
    glTreatment:
      original.reason === 'Opening stock from import' || original.reason.startsWith('Tax invoice')
        ? original.reason.startsWith('Tax invoice')
          ? 'sale'
          : 'opening'
        : 'standard',
  });
  if (original.kind === 'receipt') {
    const onHandAfter = (await onHandMap(tx)).get(item.id) ?? 0n;
    const before = onHandAfter - signed;
    const corrected = weightedAverageAfterReceiptReversal({
      onHandMicros: before,
      averageCostCents: item.costCents,
      reversalMicros: parseQuantity(original.quantity),
      originalUnitCostCents: original.unitCostCents,
    });
    await tx.db
      .update(items)
      .set({ costCents: corrected, updatedAt: new Date() })
      .where(eq(items.id, item.id));
  }
  await audit(
    tx,
    actor,
    'scm.movement.reversal',
    'scm_movement',
    id,
    { reverses: original.id },
    {
      item: item.name,
      quantity: formatQuantity(signed),
      reason: note,
    },
  );
  if (original.kind !== 'transfer_in' && original.kind !== 'transfer_out') {
    await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand']);
  }
  return { movementId: id };
}

export async function getItem(tx: TenantTransaction, actor: Actor, itemId: string) {
  const access = await stockAccess(tx, actor.userId);
  const item = await loadItem(tx, itemId);
  const packs = await packsFor(tx, item.id);
  const branchList = await branchRows(tx, actor.userId);
  const names = new Map(branchList.map((row) => [row.id, row.name]));
  const balanceRows = access.quantities
    ? await tx.db.select().from(balances).where(eq(balances.itemId, item.id))
    : [];
  const history = access.quantities
    ? await tx.db
        .select()
        .from(movements)
        .where(eq(movements.itemId, item.id))
        .orderBy(desc(movements.occurredAt))
    : [];
  const actorNames = await namesByUser(tx);
  const batchRows = item.trackBatches
    ? await tx.db.select().from(batches).where(eq(batches.itemId, item.id))
    : [];
  const batchIds = batchRows.map((batch) => batch.id);
  const batchQtyRows =
    batchIds.length === 0
      ? []
      : await tx.db.select().from(batchBalances).where(inArray(batchBalances.batchId, batchIds));
  const serialRows = item.trackSerials
    ? await tx.db.select().from(serials).where(eq(serials.itemId, item.id))
    : [];
  const pending = access.quantities
    ? await tx.db
        .select()
        .from(adjustmentRequests)
        .where(
          and(eq(adjustmentRequests.itemId, item.id), eq(adjustmentRequests.status, 'pending')),
        )
    : [];
  const onHand = balanceRows.reduce((sum, row) => sum + parseQuantity(row.quantity), 0n);
  const rate = item.vatRateBasisPoints;
  return {
    access: accessFlags(access),
    item: {
      id: item.id,
      name: item.name,
      code: item.sku,
      barcode: item.barcode ?? '',
      description: item.description,
      category: item.category,
      kind: item.kind,
      kindLabel: KIND_LABEL[item.kind] ?? item.kind,
      unit: item.baseUom,
      costLabel: access.costs ? centsLabel(item.costCents) : null,
      cost: access.costs ? formatDecimalFromCents(item.costCents) : null,
      priceLabel: centsLabel(item.sellingPriceCents),
      price: formatDecimalFromCents(item.sellingPriceCents),
      vatLabel: `${(rate / 100).toFixed(rate % 100 === 0 ? 0 : 2)}%`,
      unitPlural: item.baseUomPlural,
      reorder: qtyLabel(parseQuantity(item.reorderLevel), item.baseUom, item.baseUomPlural),
      trackBatches: item.trackBatches,
      trackSerials: item.trackSerials,
      archived: item.status === 'archived',
      onHandLabel: access.quantities ? qtyLabel(onHand, item.baseUom, item.baseUomPlural) : null,
      low: access.quantities ? low(item, onHand) : false,
      packs: packs.map((pack) => ({
        name: pack.name,
        plural: pack.plural,
        factor: formatQuantity(parseQuantity(pack.factor)),
        label: `${pack.name} of ${formatQuantity(parseQuantity(pack.factor))} ${item.baseUomPlural}`,
      })),
    },
    balances: balanceRows.map((row) => ({
      branchId: row.branchId,
      branch: names.get(row.branchId) ?? 'Branch',
      onHandLabel: qtyLabel(parseQuantity(row.quantity), item.baseUom, item.baseUomPlural),
    })),
    totalOnHandLabel: qtyLabel(onHand, item.baseUom, item.baseUomPlural),
    movements: history.map((row) => {
      const signedEntered =
        parseQuantity(row.quantity) < 0n
          ? -parseQuantity(row.enteredQuantity)
          : parseQuantity(row.enteredQuantity);
      return {
        id: row.id,
        what: whatLabel(row.kind, row.quantity),
        branch: names.get(row.branchId) ?? 'Branch',
        quantityLabel: signedQtyLabel(signedEntered, row.uomName, row.uomPlural),
        direction: parseQuantity(row.quantity) < 0n ? 'out' : 'in',
        reason: row.reason,
        whenLabel: shortDate(row.occurredAt),
        valueLabel: access.costs ? centsLabel(row.valueCents) : null,
        actorName: actorNames.get(row.actorId ?? '') ?? 'System',
        reversible: row.kind !== 'reversal',
      };
    }),
    batches: batchRows.map((batch) => ({
      code: batch.code,
      expiresOn: batch.expiresOn,
      places: batchQtyRows
        .filter((row) => row.batchId === batch.id && parseQuantity(row.quantity) !== 0n)
        .map((row) => ({
          branch: names.get(row.branchId) ?? 'Branch',
          onHandLabel: qtyLabel(parseQuantity(row.quantity), item.baseUom, item.baseUomPlural),
        })),
    })),
    serials: serialRows.map((row) => ({
      serial: row.serial,
      statusLabel: row.status === 'in_stock' ? 'In Stock' : 'Issued',
      branch: row.branchId ? (names.get(row.branchId) ?? 'Branch') : '',
    })),
    pending: pending.map((row) => ({
      id: row.id,
      summary: `${quantityPhrase(parseQuantity(row.quantity), item.baseUom, item.baseUomPlural)} at ${names.get(row.branchId) ?? 'Branch'}`,
      reason: row.reason,
      valueLabel: access.costs ? centsLabel(row.valueCents) : null,
    })),
  };
}

async function namesByUser(tx: TenantTransaction): Promise<Map<string, string>> {
  const rows = await tx.db.select({ id: users.id, name: users.displayName }).from(users);
  return new Map(rows.map((row) => [row.id, row.name]));
}

function formatDecimalFromCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export async function dashboard(tx: TenantTransaction, actor: Actor) {
  const access = await stockAccess(tx, actor.userId);
  const rows = await tx.db.select().from(items);
  const totals = access.quantities ? await onHandMap(tx) : new Map<string, bigint>();
  let value = 0n;
  let lowCount = 0;
  for (const item of rows) {
    if (item.status !== 'active' || item.kind !== 'stock') {
      continue;
    }
    const onHand = totals.get(item.id) ?? 0n;
    value += extendCost(onHand, item.costCents);
    if (low(item, onHand)) {
      lowCount += 1;
    }
  }
  const recentRows = access.quantities
    ? await tx.db.select().from(movements).orderBy(desc(movements.occurredAt)).limit(6)
    : [];
  const names = new Map(rows.map((item) => [item.id, item.name]));
  const branches = await branchRows(tx, actor.userId);
  const branchNames = new Map(branches.map((row) => [row.id, row.name]));
  const people = await namesByUser(tx);
  const pendingCount = access.approve
    ? (
        await tx.db
          .select({ id: adjustmentRequests.id })
          .from(adjustmentRequests)
          .where(eq(adjustmentRequests.status, 'pending'))
      ).length
    : 0;
  return {
    access: accessFlags(access),
    stockValueLabel: access.costs ? centsLabel(value) : null,
    lowStockCount: access.quantities ? lowCount : null,
    catalogCount: rows.filter((item) => item.status === 'active').length,
    pendingAdjustments: access.approve ? pendingCount : null,
    recent: recentRows
      .filter((row) => row.kind !== 'transfer_in')
      .map((row) => ({
        id: row.id,
        itemId: row.itemId,
        itemName: names.get(row.itemId) ?? 'Item',
        what: whatLabel(row.kind, row.quantity),
        branch: branchNames.get(row.branchId) ?? 'Branch',
        whenLabel: shortDate(row.occurredAt),
        valueLabel: access.costs ? centsLabel(row.valueCents) : null,
        actorName: people.get(row.actorId ?? '') ?? 'System',
      })),
  };
}

export async function lowStock(tx: TenantTransaction, actor: Actor) {
  const listed = await listItems(tx, actor, 'low', '');
  return listed;
}

export async function valuation(tx: TenantTransaction, actor: Actor) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.valuation) {
    throw new CatalogError('Your role can see quantities, not the stock value.', 403);
  }
  const rows = await tx.db.select().from(items);
  const totals = await onHandMap(tx);
  const lines = rows
    .filter((item) => item.kind === 'stock' && item.status === 'active')
    .map((item) => {
      const onHand = totals.get(item.id) ?? 0n;
      const value = extendCost(onHand, item.costCents);
      return {
        id: item.id,
        name: item.name,
        code: item.sku,
        onHandLabel: qtyLabel(onHand, item.baseUom, item.baseUomPlural),
        costLabel: centsLabel(item.costCents),
        valueCents: value,
        valueLabel: centsLabel(value),
      };
    })
    .filter((line) => line.valueCents !== 0n || true)
    .sort((left, right) => (left.valueCents < right.valueCents ? 1 : -1));
  const total = lines.reduce((sum, line) => sum + line.valueCents, 0n);
  return {
    lines: lines.map(({ valueCents: _valueCents, ...line }) => line),
    totalLabel: centsLabel(total),
    method: 'Weighted average',
  };
}

export async function labelFor(tx: TenantTransaction, actor: Actor, itemId: string) {
  const access = await stockAccess(tx, actor.userId);
  let item = await loadItem(tx, itemId);
  if (!item.barcode && (access.operate || access.editCatalog)) {
    await ensureItemBarcode(tx, actor, item.id);
    item = await loadItem(tx, itemId);
  }
  const config = await readSettings(tx);
  const code = item.barcode || item.sku;
  const art = barcodeArtwork(code);
  return {
    name: item.name,
    code: item.sku,
    barcode: code,
    symbology: art.symbology,
    widthMm: config.labelWidthMm,
    heightMm: config.labelHeightMm,
    printer: config.labelPrinter,
    svg: art.svg,
    modules: art.modules,
  };
}

export async function saveLabelSettings(
  tx: TenantTransaction,
  actor: Actor,
  input: { widthMm: string; heightMm: string; printer: string },
) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.editCatalog) {
    throw new CatalogError('Your role cannot change label settings.', 403);
  }
  const width = Number(input.widthMm);
  const height = Number(input.heightMm);
  if (!Number.isFinite(width) || width < 20 || width > 100) {
    throw new CatalogError('Label width must be between 20 and 100 mm.');
  }
  if (!Number.isFinite(height) || height < 8 || height > 80) {
    throw new CatalogError('Label height must be between 8 and 80 mm.');
  }
  const printer = cleanText(input.printer, 'the printer name', 80);
  const before = await readSettings(tx);
  await tx.db
    .update(settings)
    .set({
      labelWidthMm: width.toFixed(2),
      labelHeightMm: height.toFixed(2),
      labelPrinter: printer,
    })
    .where(eq(settings.tenantId, tx.tenantId));
  await audit(
    tx,
    actor,
    'scm.settings.updated',
    'scm_settings',
    tx.tenantId,
    {
      widthMm: before.labelWidthMm,
      heightMm: before.labelHeightMm,
      printer: before.labelPrinter,
    },
    { widthMm: width.toFixed(2), heightMm: height.toFixed(2), printer },
  );
  return { widthMm: width.toFixed(2), heightMm: height.toFixed(2), printer };
}

export async function getLabelSettings(tx: TenantTransaction, actor: Actor) {
  await stockAccess(tx, actor.userId);
  const config = await readSettings(tx);
  return {
    widthMm: config.labelWidthMm,
    heightMm: config.labelHeightMm,
    printer: config.labelPrinter,
  };
}

export type StockImportRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  description: string;
  costCents: bigint;
  sellingPriceCents: bigint;
  barcode: string | null;
  onHand: string;
  updatedAt: string;
  movementCount: number;
  status: string;
};

/** Active catalog rows for KRN-06. The caller has already checked who may import. */
export async function listItemsForImport(tx: TenantTransaction): Promise<StockImportRow[]> {
  const rows = await tx.db.select().from(items);
  const totals = await onHandMap(tx);
  const movementRows = await tx.db.select({ itemId: movements.itemId }).from(movements);
  const counts = new Map<string, number>();
  for (const row of movementRows) {
    counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1);
  }
  return rows.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.baseUom,
    description: item.description,
    costCents: item.costCents,
    sellingPriceCents: item.sellingPriceCents,
    barcode: item.barcode,
    onHand: formatQuantity(totals.get(item.id) ?? 0n),
    updatedAt: item.updatedAt.toISOString(),
    movementCount: counts.get(item.id) ?? 0,
    status: item.status,
  }));
}

export async function itemImportStamps(tx: TenantTransaction, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  const rows = await tx.db
    .select({ id: items.id, status: items.status, updatedAt: items.updatedAt })
    .from(items)
    .where(inArray(items.id, ids));
  const movementRows = await tx.db
    .select({ itemId: movements.itemId })
    .from(movements)
    .where(inArray(movements.itemId, ids));
  const counts = new Map<string, number>();
  for (const row of movementRows) {
    counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    movementCount: counts.get(row.id) ?? 0,
  }));
}

async function assertCanImportStock(tx: TenantTransaction, userId: string): Promise<void> {
  if (await hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-06' })) {
    return;
  }
  const manager = await tx.db
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.key, 'branch_manager')))
    .limit(1);
  if (manager.length > 0) {
    return;
  }
  const access = await stockAccess(tx, userId);
  if (access.editCatalog && access.operate) {
    return;
  }
  throw new CatalogError('Only an owner, a manager, or warehouse can import stock.', 403);
}

/**
 * Create or update a catalog item and post opening stock as a receipt.
 * The receipt updates the weighted-average cost. A negative quantity is an issue.
 */
export async function importOpeningStock(
  tx: TenantTransaction,
  actor: Actor,
  input: {
    itemId: string | null;
    sku: string;
    name: string;
    unit: string;
    description: string;
    unitCost: string;
    quantity: string;
    branchId: string;
    barcode?: string | null;
    sellingPrice?: string | null;
  },
): Promise<{ itemId: string; movementId: string | null; updatedAt: string }> {
  await assertCanImportStock(tx, actor.userId);
  const branch = await requireBranch(tx, actor.userId, input.branchId);
  const name = cleanText(input.name, 'a name', 120);
  const sku = cleanText(input.sku, 'an item code', 40);
  const unit = cleanText(input.unit, 'a unit', 40);
  const plural = unit.toLowerCase() === 'each' || unit.endsWith('s') ? unit : `${unit}s`;
  const description = input.description.trim();
  if (description.length > 2000) {
    throw new CatalogError('Shorten the description.');
  }
  const cost = parseMoney(input.unitCost, 'the cost');
  const selling =
    input.sellingPrice == null || input.sellingPrice.trim() === ''
      ? null
      : parseMoney(input.sellingPrice, 'the selling price');
  const barcode = input.barcode?.trim() ? readableBarcode(input.barcode.trim()) : null;
  const quantity = parseQuantity(input.quantity);
  const rate = await vatRate(tx);
  let itemId = input.itemId;

  if (!itemId) {
    itemId = randomUUID();
    await tx.db.insert(items).values({
      id: itemId,
      tenantId: tx.tenantId,
      kind: 'stock',
      sku,
      barcode,
      name,
      description,
      category: '',
      baseUom: unit,
      baseUomPlural: plural,
      costCents: quantity > 0n ? 0n : cost,
      sellingPriceCents: selling ?? 0n,
      vatRateBasisPoints: rate,
      reorderLevel: formatQuantity(0n),
      trackBatches: false,
      trackSerials: false,
      status: 'active',
    });
    await replacePacks(tx, itemId, unit, []);
    await audit(tx, actor, 'scm.item.created', 'scm_item', itemId, null, {
      name,
      code: sku,
      unit,
      source: 'import',
    });
  } else {
    await tx.db
      .update(items)
      .set({
        sku,
        name,
        description,
        baseUom: unit,
        baseUomPlural: plural,
        ...(barcode ? { barcode } : {}),
        ...(selling != null ? { sellingPriceCents: selling } : {}),
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }

  let movementId: string | null = null;
  const item = await loadItem(tx, itemId);
  if (quantity > 0n) {
    const onHand = (await onHandMap(tx)).get(item.id) ?? 0n;
    const average = weightedAverageOnReceipt({
      onHandMicros: onHand,
      averageCostCents: item.costCents,
      receiptMicros: quantity,
      receiptUnitCostCents: cost,
    });
    movementId = await insertMovement(tx, actor, item, {
      branchId: branch.id,
      kind: 'receipt',
      signedBase: quantity,
      entered: quantity,
      factor: QTY_SCALE,
      uomName: unit,
      uomPlural: plural,
      unitCostCents: cost,
      reason: 'Opening stock from import',
      batchId: null,
      serialList: [],
      glTreatment: 'opening',
    });
    await tx.db
      .update(items)
      .set({ costCents: average, updatedAt: new Date() })
      .where(eq(items.id, item.id));
    await audit(tx, actor, 'scm.movement.receipt', 'scm_movement', movementId, null, {
      item: item.name,
      branch: branch.name,
      quantity: formatQuantity(quantity),
      unitCostCents: cost.toString(),
      averageCostCents: average.toString(),
      source: 'import',
    });
    await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand', 'cost']);
  } else if (quantity < 0n) {
    const issued = -quantity;
    movementId = await insertMovement(tx, actor, item, {
      branchId: branch.id,
      kind: 'issue',
      signedBase: quantity,
      entered: issued,
      factor: QTY_SCALE,
      uomName: unit,
      uomPlural: plural,
      unitCostCents: item.costCents,
      reason: 'Opening stock from import',
      batchId: null,
      serialList: [],
      glTreatment: 'opening',
    });
    await tx.db.update(items).set({ updatedAt: new Date() }).where(eq(items.id, item.id));
    await noteNumbers(tx, actor, item.id, 'field_changed', ['on_hand']);
  } else if (input.itemId) {
    await tx.db
      .update(items)
      .set({ costCents: cost, updatedAt: new Date() })
      .where(eq(items.id, itemId));
  }

  const saved = await loadItem(tx, itemId);
  return { itemId, movementId, updatedAt: saved.updatedAt.toISOString() };
}

export async function readStockNumbers(
  tx: TenantTransaction,
  itemId: string,
): Promise<Record<string, FormulaNumber>> {
  const rows = await tx.db.select().from(items).where(eq(items.id, itemId));
  const item = rows[0];
  if (!item) {
    return {};
  }
  const held = await tx.db
    .select({ quantity: balances.quantity })
    .from(balances)
    .where(eq(balances.itemId, itemId));
  let onHand = 0n;
  for (const row of held) {
    onHand += parseQuantity(row.quantity);
  }
  return {
    on_hand: { kind: 'decimal', text: formatQuantity(onHand) },
    reorder_level: { kind: 'decimal', text: item.reorderLevel },
    selling_price: { kind: 'money', text: item.sellingPriceCents.toString() },
    cost: { kind: 'money', text: item.costCents.toString() },
  };
}

async function noteNumbers(
  tx: TenantTransaction,
  actor: Actor,
  itemId: string,
  event: 'created' | 'field_changed',
  fieldKeys: string[],
): Promise<void> {
  await recordChanged(
    tx,
    { actorId: actor.userId, requestIp: actor.requestIp, userAgent: actor.userAgent },
    { entityType: 'scm.item', entityId: itemId, event, fieldKeys },
  );
}

export async function listPending(tx: TenantTransaction, actor: Actor) {
  const access = await stockAccess(tx, actor.userId);
  if (!access.quantities) {
    return { pending: [], access: accessFlags(access) };
  }
  const rows = await tx.db
    .select()
    .from(adjustmentRequests)
    .where(eq(adjustmentRequests.status, 'pending'))
    .orderBy(desc(adjustmentRequests.createdAt));
  const itemRows = await tx.db.select().from(items);
  const byItem = new Map(itemRows.map((item) => [item.id, item]));
  const branches = await branchRows(tx, actor.userId);
  const branchNames = new Map(branches.map((row) => [row.id, row.name]));
  return {
    access: accessFlags(access),
    pending: rows.map((row) => ({
      id: row.id,
      itemName: byItem.get(row.itemId)?.name ?? 'Item',
      summary: `${quantityPhrase(parseQuantity(row.quantity), byItem.get(row.itemId)?.baseUom ?? 'unit', byItem.get(row.itemId)?.baseUomPlural ?? 'units')} at ${branchNames.get(row.branchId) ?? 'Branch'}`,
      reason: row.reason,
      valueLabel: access.costs ? centsLabel(row.valueCents) : null,
      whenLabel: shortDate(row.createdAt),
    })),
  };
}
