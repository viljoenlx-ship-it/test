import type { TenantTransaction } from '@omnivate/kernel';

/**
 * The party directory KRN-02 is expected to expose.
 * KRN-06 does not read KRN-02's tables. It calls this port.
 * The provisional implementation lives in bridge/party.ts until that module lands.
 */
export type PartyKind = 'customer' | 'supplier' | 'both' | 'other';

export type PartyDraft = {
  displayName: string;
  legalName: string | null;
  kind: PartyKind;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  notes: string | null;
  /** ISO date yyyy-mm-dd, or null. */
  startedOn: string | null;
};

export type PartyRecord = PartyDraft & {
  id: string;
  generation: number;
  lastBatchId: string | null;
  archivedAt: Date | null;
};

export type PartySnapshot = {
  displayName: string;
  legalName: string | null;
  kind: string;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  notes: string | null;
  startedOn: string | null;
  generation: number;
  lastBatchId: string | null;
};

export type PartyDirectory = {
  findByEmail(tx: TenantTransaction, email: string): Promise<PartyRecord | null>;
  findByVat(tx: TenantTransaction, vatNumber: string): Promise<PartyRecord | null>;
  get(tx: TenantTransaction, id: string): Promise<PartyRecord | null>;
  listActive(tx: TenantTransaction): Promise<PartyRecord[]>;
  createMany(
    tx: TenantTransaction,
    rows: { id: string; draft: PartyDraft; batchId: string }[],
  ): Promise<void>;
  /** Replace the live fields and bump generation. Returns the new generation. */
  update(tx: TenantTransaction, id: string, draft: PartyDraft, batchId: string): Promise<number>;
  /** Hide the contact. Does not delete the row and does not bump generation. */
  archive(tx: TenantTransaction, id: string): Promise<void>;
  restore(tx: TenantTransaction, id: string, previous: PartySnapshot): Promise<void>;
  /**
   * Call this from every edit that is not an import.
   * Undo is refused once the generation no longer matches the import.
   */
  markTouched(tx: TenantTransaction, id: string): Promise<void>;
};

/**
 * The catalog and inventory ledger SCM-01 is expected to expose.
 * Opening stock is a posted movement. Undo posts a reversal. Nothing is deleted.
 */
export type ItemDraft = {
  sku: string;
  name: string;
  unit: string;
  description: string | null;
  /** Unit cost in cents, already exclusive of VAT. */
  costCents: bigint;
  /** On-hand quantity in thousandths of the unit. */
  quantityMilli: bigint;
  branchId: string | null;
  barcode?: string | null;
  /** Null when the spreadsheet left the selling price blank. */
  sellingPriceCents?: bigint | null;
};

export type ItemRecord = ItemDraft & {
  id: string;
  generation: number;
  lastBatchId: string | null;
  archivedAt: Date | null;
};

export type ItemSnapshot = {
  sku: string;
  name: string;
  unit: string;
  description: string | null;
  costCents: string;
  quantityMilli: string;
  branchId: string | null;
  generation: number;
  lastBatchId: string | null;
};

export type CatalogPort = {
  findBySku(tx: TenantTransaction, sku: string): Promise<ItemRecord | null>;
  get(tx: TenantTransaction, id: string): Promise<ItemRecord | null>;
  listActive(tx: TenantTransaction): Promise<ItemRecord[]>;
  movementCount(tx: TenantTransaction, itemId: string): Promise<number>;
  createMany(
    tx: TenantTransaction,
    rows: {
      id: string;
      draft: ItemDraft;
      batchId: string;
      valueCents: bigint;
      branchId: string;
    }[],
  ): Promise<void>;
  /**
   * Set the item to the draft (absolute on-hand quantity) and, when the delta
   * is not zero, post one adjustment movement.
   */
  update(
    tx: TenantTransaction,
    id: string,
    draft: ItemDraft,
    batchId: string,
    deltaQuantityMilli: bigint,
    deltaValueCents: bigint,
    branchId: string,
  ): Promise<{ generation: number; movementCount: number }>;
  postReversal(
    tx: TenantTransaction,
    itemId: string,
    batchId: string,
    quantityMilli: bigint,
    valueCents: bigint,
  ): Promise<void>;
  archive(tx: TenantTransaction, id: string): Promise<void>;
  restore(tx: TenantTransaction, id: string, previous: ItemSnapshot): Promise<void>;
  /** Call this from every edit that is not an import, including a later stock movement. */
  markTouched(tx: TenantTransaction, id: string): Promise<void>;
};
