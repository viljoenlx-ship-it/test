import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  activeModuleSet,
  appendAuditEvent,
  hasPermission,
  PermissionDeniedError,
  tenantId,
  tenants,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import { createParty, listPartiesForImport } from '@omnivate/module-krn-02';
import {
  listBranches,
  listItems,
  receiveGoods,
  reverseMovement,
  saveItem,
} from '@omnivate/module-scm-01';
import { formatZar, money, southAfricaPreset, zarFromDecimal } from '@omnivate/shared';
import { copy, statusLabel, type DocumentStatus } from './copy';
import { findDuplicate, type DuplicateCandidate } from './duplicates';
import { DocumentError } from './errors';
import { countPages, sniffDocument, tidyFilename } from './files';
import { matchLine, matchSupplier, type CatalogCandidate, type SupplierCandidate } from './match';
import { premiumConfigured, resolveReader, type ReaderChoice } from './providers';
import { headerConfidence, isLowConfidence, lineConfidence, type ReaderDocument } from './reader';
import { documents, lines, pageUsage, receiptLinks, settings, supplierCodes } from './schema';
import { currentDocumentStore } from './storage';
import { checkTotals } from './totals';

export type Actor = {
  userId: string;
  requestIp: string | null;
  userAgent: string | null;
};

type DocumentRow = typeof documents.$inferSelect;
type LineRow = typeof lines.$inferSelect;

const inflight = new Set<string>();

export function usagePeriod(now = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  return formatted.slice(0, 7);
}

export function periodLabel(period: string): string {
  const [year = '2026', month = '01'] = period.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function centsToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function displayQuantity(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : (whole ?? value);
}

function moneyOrNull(value: string, label: string): bigint {
  const text = value.trim();
  if (!text) {
    throw new DocumentError(`Enter ${label}.`);
  }
  try {
    return zarFromDecimal(text).amountCents;
  } catch {
    throw new DocumentError(`Enter ${label} in rands, such as 10.50.`);
  }
}

function tidyQuantity(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) {
    throw new DocumentError('Enter a quantity greater than zero.');
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  if (text === '0') {
    throw new DocumentError('Enter a quantity greater than zero.');
  }
  return text;
}

async function enabled(tx: TenantTransaction): Promise<boolean> {
  const rows = await tx.db.select({ enabled: settings.enabled }).from(settings);
  return rows[0]?.enabled ?? true;
}

async function requireEnabled(tx: TenantTransaction): Promise<void> {
  if (!(await enabled(tx))) {
    throw new DocumentError(copy.switchedOff, 403, 'module_off');
  }
}

async function can(
  tx: TenantTransaction,
  userId: string,
  action: 'read' | 'operate' | 'post' | 'approve',
) {
  return hasPermission(tx, userId, { scope: 'scm.catalog', action, moduleId: 'SCM-01' });
}

export async function captureAccess(tx: TenantTransaction, userId: string) {
  await requireEnabled(tx);
  const review =
    (await can(tx, userId, 'operate')) ||
    (await can(tx, userId, 'post')) ||
    (await can(tx, userId, 'approve'));
  if (!review) {
    throw new DocumentError(copy.cannotReview, 403, 'forbidden');
  }
  return { canCapture: await can(tx, userId, 'operate'), canReview: true };
}

async function requireCapture(tx: TenantTransaction, userId: string) {
  const access = await captureAccess(tx, userId);
  if (!access.canCapture) {
    throw new DocumentError(copy.cannotCapture, 403, 'forbidden');
  }
}

async function vatRate(tx: TenantTransaction): Promise<number> {
  const rows = await tx.db
    .select({ vat: tenants.vatRateBasisPoints })
    .from(tenants)
    .where(eq(tenants.id, tx.tenantId));
  return rows[0]?.vat ?? southAfricaPreset.vatStandardRateBasisPoints;
}

async function addPages(
  tx: TenantTransaction,
  pages: number,
  reader: 'standard' | 'premium',
): Promise<void> {
  await tx.db.execute(sql`
    INSERT INTO doc_page_usage (tenant_id, period, reader, pages)
    VALUES (${tx.tenantId}, ${usagePeriod()}, ${reader}, ${pages})
    ON CONFLICT (tenant_id, period, reader)
    DO UPDATE SET pages = doc_page_usage.pages + EXCLUDED.pages
  `);
}

function asConfidence(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number') {
      record[key] = entry;
    }
  }
  return record;
}

async function loadDocument(tx: TenantTransaction, id: string): Promise<DocumentRow> {
  const rows = await tx.db.select().from(documents).where(eq(documents.id, id));
  const row = rows[0];
  if (!row) {
    throw new DocumentError(copy.notFound, 404, 'not_found');
  }
  return row;
}

async function loadLines(tx: TenantTransaction, documentId: string): Promise<LineRow[]> {
  const rows = await tx.db.select().from(lines).where(eq(lines.documentId, documentId));
  return rows.sort((left, right) => left.lineNo - right.lineNo);
}

async function supplierDirectory(tx: TenantTransaction): Promise<SupplierCandidate[]> {
  const rows = await listPartiesForImport(tx);
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    legalName: row.legalName,
    vatNumber: row.vatNumber,
    roles: row.roles,
    status: row.status,
  }));
}

async function catalog(tx: TenantTransaction, actor: Actor): Promise<CatalogCandidate[]> {
  try {
    const result = await listItems(tx, actor, 'active', '');
    return result.items.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      barcode: item.barcode,
      unit: item.unit,
      kind: item.kind,
    }));
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      (error instanceof Error && error.name === 'CatalogError')
    ) {
      return [];
    }
    throw error;
  }
}

async function remembered(tx: TenantTransaction, partyId: string | null) {
  if (!partyId) {
    return [];
  }
  return tx.db.select().from(supplierCodes).where(eq(supplierCodes.partyId, partyId));
}

async function rememberCode(
  tx: TenantTransaction,
  partyId: string | null,
  supplierCode: string,
  itemId: string | null,
) {
  const code = supplierCode.trim();
  if (!partyId || !itemId || code.length < 1) {
    return;
  }
  await tx.db
    .insert(supplierCodes)
    .values({
      tenantId: tx.tenantId,
      partyId,
      supplierCode: code,
      itemId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [supplierCodes.tenantId, supplierCodes.partyId, supplierCodes.supplierCode],
      set: { itemId, updatedAt: new Date() },
    });
}

async function headOffice(tx: TenantTransaction, actor: Actor): Promise<string | null> {
  try {
    const result = await listBranches(tx, actor);
    return (
      result.branches.find((branch) => branch.headOffice)?.id ?? result.branches[0]?.id ?? null
    );
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      (error instanceof Error && error.name === 'CatalogError')
    ) {
      return null;
    }
    throw error;
  }
}

function duplicateFrom(row: DocumentRow): DuplicateCandidate {
  return {
    id: row.id,
    partyId: row.partyId,
    supplierVat: row.supplierVat,
    supplierName: row.supplierName,
    documentNumber: row.documentNumber,
    status: row.status,
  };
}

async function duplicateFor(tx: TenantTransaction, row: DocumentRow) {
  const existing = await tx.db.select().from(documents);
  return findDuplicate(duplicateFrom(row), existing.map(duplicateFrom));
}

export async function captureDocument(
  tx: TenantTransaction,
  actor: Actor,
  input: { filename: string; bytes: Buffer },
): Promise<string> {
  await requireCapture(tx, actor.userId);
  const sniffed = sniffDocument(input.bytes);
  const id = randomUUID();
  await currentDocumentStore().put({
    tenantId: tx.tenantId,
    documentId: id,
    bytes: input.bytes,
    contentType: sniffed.contentType,
  });
  const now = new Date();
  await tx.db.insert(documents).values({
    id,
    tenantId: tx.tenantId,
    status: 'queued',
    filename: tidyFilename(input.filename),
    contentType: sniffed.contentType,
    byteSize: input.bytes.length,
    pageCount: 0,
    billedAt: null,
    storageKey: `${tx.tenantId}/${id}`,
    documentType: null,
    supplierName: '',
    supplierVat: '',
    partyId: null,
    supplierMatch: 'none',
    documentNumber: '',
    documentDate: null,
    dueDate: null,
    currencyCode: 'ZAR',
    subtotalCents: null,
    vatCents: null,
    totalCents: null,
    fieldConfidence: {},
    extracted: {},
    branchId: null,
    failureMessage: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export function kickDocument(company: string, documentId: string): void {
  setImmediate(() => {
    void processDocument(company, documentId).catch(() => {
      console.error('document read failed');
    });
  });
}

async function claim(tx: TenantTransaction, documentId: string): Promise<DocumentRow | null> {
  const row = await loadDocument(tx, documentId).catch((error: unknown) => {
    if (error instanceof DocumentError && error.statusCode === 404) {
      return null;
    }
    throw error;
  });
  if (!row) {
    return null;
  }
  const stale = row.status === 'reading' && Date.now() - row.updatedAt.getTime() > 2 * 60 * 1000;
  if (row.status !== 'queued' && !stale) {
    return null;
  }
  await tx.db
    .update(documents)
    .set({ status: 'reading', failureMessage: null, updatedAt: new Date() })
    .where(eq(documents.id, row.id));
  return row;
}

async function markFailed(company: string, documentId: string): Promise<void> {
  await withTenant(tenantId(company), async (tx) => {
    await tx.db
      .update(documents)
      .set({
        status: 'failed',
        failureMessage: copy.couldNotRead,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.status, 'reading')));
  });
}

async function readerChoice(company: string): Promise<ReaderChoice> {
  return withTenant(tenantId(company), async (tx) => {
    const rows = await tx.db.select({ reader: settings.reader }).from(settings);
    return rows[0]?.reader === 'premium' ? 'premium' : 'standard';
  });
}

async function bill(
  company: string,
  documentId: string,
  pages: number,
  reader: 'standard' | 'premium',
): Promise<void> {
  await withTenant(tenantId(company), async (tx) => {
    const row = await loadDocument(tx, documentId);
    if (row.billedAt) {
      return;
    }
    await addPages(tx, pages, reader);
    await tx.db
      .update(documents)
      .set({ billedAt: new Date(), pageCount: pages, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  });
}

async function writeRead(
  tx: TenantTransaction,
  row: DocumentRow,
  result: ReaderDocument,
  pages: number,
): Promise<void> {
  const actor: Actor = {
    userId: row.createdBy ?? '',
    requestIp: null,
    userAgent: null,
  };
  const directory = actor.userId ? await supplierDirectory(tx) : [];
  const supplier = matchSupplier(
    result.supplierName.value,
    result.supplierVatNumber.value,
    directory,
  );
  const items = actor.userId ? await catalog(tx, actor) : [];
  const memory = await remembered(tx, supplier.partyId);
  const branchId = row.branchId ?? (actor.userId ? await headOffice(tx, actor) : null);
  await tx.db.delete(lines).where(eq(lines.documentId, row.id));
  let lineNo = 1;
  for (const line of result.lines) {
    const matched = matchLine({
      description: line.description.value,
      supplierCode: line.supplierCode.value,
      memory,
      items,
    });
    await tx.db.insert(lines).values({
      tenantId: tx.tenantId,
      documentId: row.id,
      lineNo,
      description: line.description.value,
      supplierCode: line.supplierCode.value,
      quantity: tidyQuantity(line.quantity.value),
      unit: line.unit.value || 'each',
      unitPriceCents: zarFromDecimal(line.unitPriceExcl.value).amountCents,
      vatCents: zarFromDecimal(line.vat.value).amountCents,
      lineTotalCents: zarFromDecimal(line.lineTotal.value).amountCents,
      itemId: matched.itemId,
      matchMethod: matched.method,
      fieldConfidence: lineConfidence(line),
    });
    lineNo += 1;
  }
  const now = new Date();
  await tx.db
    .update(documents)
    .set({
      status: 'ready',
      pageCount: pages,
      documentType: result.documentType,
      supplierName: result.supplierName.value,
      supplierVat: result.supplierVatNumber.value.replace(/\s/g, ''),
      partyId: supplier.partyId,
      supplierMatch: supplier.method,
      documentNumber: result.documentNumber.value,
      documentDate: result.documentDate.value,
      dueDate: result.dueDate.value,
      currencyCode: result.currency.value,
      subtotalCents: zarFromDecimal(result.subtotal.value).amountCents,
      vatCents: zarFromDecimal(result.vat.value).amountCents,
      totalCents: zarFromDecimal(result.total.value).amountCents,
      fieldConfidence: headerConfidence(result),
      extracted: result,
      branchId,
      failureMessage: null,
      updatedAt: now,
    })
    .where(eq(documents.id, row.id));
}

export async function processDocument(company: string, documentId: string): Promise<void> {
  const key = `${company}:${documentId}`;
  if (inflight.has(key)) {
    return;
  }
  inflight.add(key);
  try {
    const claimed = await withTenant(tenantId(company), (tx) => claim(tx, documentId));
    if (!claimed) {
      return;
    }
    const opened = await currentDocumentStore().open({ tenantId: company, documentId });
    if (!opened) {
      await markFailed(company, documentId);
      return;
    }
    const pages = Math.max(countPages(opened.bytes, opened.contentType), 1);
    const resolved = resolveReader(await readerChoice(company));
    await bill(company, documentId, pages, resolved.kind);
    let result: ReaderDocument;
    try {
      result = await resolved.reader.read({
        bytes: opened.bytes,
        contentType: opened.contentType,
        filename: claimed.filename,
      });
      result.pageCount = Math.max(result.pageCount, pages);
    } catch {
      console.error('document read failed');
      await markFailed(company, documentId);
      return;
    }
    try {
      await withTenant(tenantId(company), (tx) => writeRead(tx, claimed, result, result.pageCount));
    } catch {
      console.error('document read failed');
      await markFailed(company, documentId);
    }
  } finally {
    inflight.delete(key);
  }
}

export type DraftLine = {
  id: string;
  description: string;
  supplierCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vat: string;
  lineTotal: string;
  itemId: string | null;
};

export type DocumentDraft = {
  documentType: string;
  supplierName: string;
  supplierVat: string;
  partyId: string | null;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  vat: string;
  total: string;
  branchId: string;
  lines: DraftLine[];
};

function readDraft(input: DocumentDraft): {
  documentType: 'tax_invoice' | 'delivery_note';
  supplierName: string;
  supplierVat: string;
  partyId: string | null;
  documentNumber: string;
  documentDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotalCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
  branchId: string | null;
  lines: {
    id: string;
    description: string;
    supplierCode: string;
    quantity: string;
    unit: string;
    unitPriceCents: bigint;
    vatCents: bigint;
    lineTotalCents: bigint;
    itemId: string | null;
  }[];
} {
  if (input.documentType !== 'tax_invoice' && input.documentType !== 'delivery_note') {
    throw new DocumentError('Choose a tax invoice or a delivery note.');
  }
  const supplierName = input.supplierName.trim().replace(/\s+/g, ' ');
  if (supplierName.length > 160) {
    throw new DocumentError('Shorten the supplier name.');
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DocumentError('Enter a 3-letter currency code.');
  }
  const date = input.documentDate.trim();
  const due = input.dueDate.trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new DocumentError('Enter the document date as YYYY-MM-DD.');
  }
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    throw new DocumentError('Enter the due date as YYYY-MM-DD.');
  }
  const partyId = input.partyId && /^[0-9a-f-]{36}$/i.test(input.partyId) ? input.partyId : null;
  const branchId =
    input.branchId && /^[0-9a-f-]{36}$/i.test(input.branchId) ? input.branchId : null;
  return {
    documentType: input.documentType,
    supplierName,
    supplierVat: input.supplierVat.replace(/\s/g, '').slice(0, 20),
    partyId,
    documentNumber: input.documentNumber.trim().slice(0, 40),
    documentDate: date || null,
    dueDate: due || null,
    currency,
    subtotalCents: moneyOrNull(input.subtotal, 'the subtotal'),
    vatCents: moneyOrNull(input.vat, 'the VAT'),
    totalCents: moneyOrNull(input.total, 'the total'),
    branchId,
    lines: input.lines.map((line) => ({
      id: line.id,
      description: line.description.trim().slice(0, 200),
      supplierCode: line.supplierCode.trim().slice(0, 40),
      quantity: tidyQuantity(line.quantity),
      unit: line.unit.trim().slice(0, 40) || 'each',
      unitPriceCents: moneyOrNull(line.unitPrice, 'the unit price'),
      vatCents: moneyOrNull(line.vat, 'the line VAT'),
      lineTotalCents: moneyOrNull(line.lineTotal, 'the line total'),
      itemId: line.itemId && /^[0-9a-f-]{36}$/i.test(line.itemId) ? line.itemId : null,
    })),
  };
}

export async function saveDocument(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  draft: DocumentDraft,
) {
  await requireCapture(tx, actor.userId);
  const current = await loadDocument(tx, id);
  if (current.status !== 'ready') {
    throw new DocumentError(copy.cannotEdit, 409, 'conflict');
  }
  const next = readDraft(draft);
  const existingLines = await loadLines(tx, id);
  for (const line of next.lines) {
    const prior = existingLines.find((row) => row.id === line.id);
    if (!prior) {
      throw new DocumentError(copy.notFound, 404, 'not_found');
    }
    const method = line.itemId && line.itemId !== prior.itemId ? 'chosen' : prior.matchMethod;
    await tx.db
      .update(lines)
      .set({
        description: line.description,
        supplierCode: line.supplierCode,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        vatCents: line.vatCents,
        lineTotalCents: line.lineTotalCents,
        itemId: line.itemId,
        matchMethod: method,
      })
      .where(eq(lines.id, line.id));
    await rememberCode(tx, next.partyId, line.supplierCode, line.itemId);
  }
  const supplierMatch =
    next.partyId && next.partyId !== current.partyId ? 'chosen' : current.supplierMatch;
  await tx.db
    .update(documents)
    .set({
      documentType: next.documentType,
      supplierName: next.supplierName,
      supplierVat: next.supplierVat,
      partyId: next.partyId,
      supplierMatch,
      documentNumber: next.documentNumber,
      documentDate: next.documentDate,
      dueDate: next.dueDate,
      currencyCode: next.currency,
      subtotalCents: next.subtotalCents,
      vatCents: next.vatCents,
      totalCents: next.totalCents,
      branchId: next.branchId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id));
  return presentDocument(tx, actor, id);
}

export async function createSupplier(tx: TenantTransaction, actor: Actor, id: string) {
  await requireCapture(tx, actor.userId);
  const current = await loadDocument(tx, id);
  if (current.status !== 'ready') {
    throw new DocumentError(copy.cannotEdit, 409, 'conflict');
  }
  const name = current.supplierName.trim();
  if (name.length < 2) {
    throw new DocumentError(copy.supplierName);
  }
  const vat = current.supplierVat.replace(/\s/g, '');
  let partyId: string;
  try {
    const created = await createParty(tx, actor, {
      kind: 'organisation',
      displayName: name,
      legalName: name,
      roles: ['supplier'],
      vatNumber: /^4\d{9}$/.test(vat) ? vat : null,
      popiaConsent: false,
      contacts: [],
      addresses: [],
      channels: [],
      tags: [],
      note: '',
    });
    partyId = created.id;
  } catch (error) {
    const existing = duplicatePartyId(error);
    if (!existing) {
      throw error;
    }
    partyId = existing;
  }
  await tx.db
    .update(documents)
    .set({ partyId, supplierMatch: 'chosen', updatedAt: new Date() })
    .where(eq(documents.id, id));
  await rematchLines(tx, actor, id, partyId);
  return presentDocument(tx, actor, id);
}

function duplicatePartyId(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== 'DuplicatePartyError') {
    return null;
  }
  const matches = (error as { matches?: { id?: string }[] }).matches;
  const id = matches?.[0]?.id;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function rematchLines(
  tx: TenantTransaction,
  actor: Actor,
  documentId: string,
  partyId: string,
) {
  const items = await catalog(tx, actor);
  const memory = await remembered(tx, partyId);
  const rows = await loadLines(tx, documentId);
  for (const row of rows) {
    if (row.itemId && row.matchMethod === 'chosen') {
      continue;
    }
    const matched = matchLine({
      description: row.description,
      supplierCode: row.supplierCode,
      memory,
      items,
    });
    await tx.db
      .update(lines)
      .set({ itemId: matched.itemId, matchMethod: matched.method })
      .where(eq(lines.id, row.id));
  }
}

export async function createItem(
  tx: TenantTransaction,
  actor: Actor,
  documentId: string,
  lineId: string,
) {
  await requireCapture(tx, actor.userId);
  const current = await loadDocument(tx, documentId);
  if (current.status !== 'ready') {
    throw new DocumentError(copy.cannotEdit, 409, 'conflict');
  }
  const row = (await loadLines(tx, documentId)).find((line) => line.id === lineId);
  if (!row) {
    throw new DocumentError(copy.notFound, 404, 'not_found');
  }
  const name = row.description.trim();
  if (name.length < 2) {
    throw new DocumentError(copy.itemName);
  }
  const cost = centsToDecimal(row.unitPriceCents ?? 0n);
  const created = await saveItem(tx, actor, null, {
    kind: 'stock',
    sku: itemCode(row.supplierCode, row.id),
    barcode: '',
    name,
    description: '',
    category: 'Received',
    baseUom: row.unit || 'each',
    baseUomPlural: row.unit || 'each',
    cost,
    sellingPrice: cost,
    reorderLevel: '0',
    trackBatches: false,
    trackSerials: false,
    uoms: [],
  });
  await tx.db
    .update(lines)
    .set({ itemId: created.id, matchMethod: 'chosen' })
    .where(eq(lines.id, row.id));
  await rememberCode(tx, current.partyId, row.supplierCode, created.id);
  return presentDocument(tx, actor, documentId);
}

function itemCode(supplierCode: string, lineId: string): string {
  const cleaned = supplierCode
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 40);
  if (cleaned.length >= 2) {
    return cleaned;
  }
  return `RCV-${lineId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export async function receiveDocument(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  confirmDuplicate: boolean,
) {
  await requireCapture(tx, actor.userId);
  const active = await activeModuleSet(tx);
  if (!active.has('SCM-01')) {
    throw new DocumentError(copy.stockOff, 409, 'module_off');
  }
  const current = await loadDocument(tx, id);
  if (current.status === 'posted') {
    throw new DocumentError(copy.alreadyReceived, 409, 'conflict');
  }
  if (current.status !== 'ready') {
    throw new DocumentError(copy.notReady, 409, 'conflict');
  }
  if (current.currencyCode.trim() !== 'ZAR') {
    throw new DocumentError(copy.currency);
  }
  const duplicate = await duplicateFor(tx, current);
  if (duplicate && !confirmDuplicate) {
    throw new DocumentError(copy.duplicate, 409, 'duplicate');
  }
  const branchId = current.branchId ?? (await headOffice(tx, actor));
  if (!branchId) {
    throw new DocumentError(copy.needBranch);
  }
  const rows = await loadLines(tx, id);
  if (rows.length === 0 || rows.some((row) => !row.itemId)) {
    throw new DocumentError(copy.needItems);
  }
  const note = `Document ${current.documentNumber || current.id.slice(0, 8)}`.slice(0, 200);
  const received = await receiveGoods(tx, actor, {
    branchId,
    note,
    supplierPartyId: current.partyId,
    lines: rows.map((row) => ({
      itemId: row.itemId ?? '',
      branchId,
      quantity: displayQuantity(row.quantity),
      uomName: row.unit,
      unitCost: centsToDecimal(row.unitPriceCents ?? 0n),
      reason: note,
    })),
  });
  const movementIds = received.movements.map((line) => line.movementId);
  for (const [index, row] of rows.entries()) {
    const movementId = movementIds[index];
    if (!movementId) {
      throw new DocumentError(copy.notReady, 500, 'document');
    }
    await tx.db.insert(receiptLinks).values({
      tenantId: tx.tenantId,
      documentId: id,
      lineId: row.id,
      movementId,
    });
    await rememberCode(tx, current.partyId, row.supplierCode, row.itemId);
  }
  await tx.db
    .update(documents)
    .set({
      status: 'posted',
      branchId,
      goodsReceiptId: received.receipt.id,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id));
  await appendAuditEvent(tx, {
    action: 'document.receipt.post',
    entityType: 'doc_document',
    entityId: id,
    actorId: actor.userId,
    beforeData: { status: 'ready' },
    afterData: {
      status: 'posted',
      supplier: current.supplierName,
      documentNumber: current.documentNumber,
      totalCents: current.totalCents?.toString() ?? null,
      branchId,
      goodsReceiptId: received.receipt.id,
      movementIds,
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return presentDocument(tx, actor, id);
}

export async function undoDocument(tx: TenantTransaction, actor: Actor, id: string) {
  await requireCapture(tx, actor.userId);
  const current = await loadDocument(tx, id);
  if (current.status === 'reversed') {
    throw new DocumentError(copy.alreadyUndone, 409, 'conflict');
  }
  if (current.status !== 'posted') {
    throw new DocumentError(copy.notReceived, 409, 'conflict');
  }
  const links = await tx.db.select().from(receiptLinks).where(eq(receiptLinks.documentId, id));
  const reversalIds: string[] = [];
  for (const link of links) {
    const reversed = await reverseMovement(
      tx,
      actor,
      link.movementId,
      `Undid document ${current.documentNumber || current.id.slice(0, 8)}`.slice(0, 200),
    );
    reversalIds.push(reversed.movementId);
  }
  await tx.db
    .update(documents)
    .set({ status: 'reversed', updatedAt: new Date() })
    .where(eq(documents.id, id));
  await appendAuditEvent(tx, {
    action: 'document.receipt.undo',
    entityType: 'doc_document',
    entityId: id,
    actorId: actor.userId,
    beforeData: { status: 'posted' },
    afterData: {
      status: 'reversed',
      supplier: current.supplierName,
      documentNumber: current.documentNumber,
      reversalIds,
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return presentDocument(tx, actor, id);
}

function moneyLabel(value: bigint | null): string {
  return value === null ? '—' : formatZar(money(value));
}

export async function presentDocument(tx: TenantTransaction, actor: Actor, id: string) {
  const access = await captureAccess(tx, actor.userId);
  const row = await loadDocument(tx, id);
  const lineRows = await loadLines(tx, id);
  const items = await catalog(tx, actor);
  const directory = await supplierDirectory(tx);
  const party = directory.find((candidate) => candidate.id === row.partyId);
  const duplicate = await duplicateFor(tx, row);
  const links = await tx.db.select().from(receiptLinks).where(eq(receiptLinks.documentId, id));
  let branches: { id: string; name: string; headOffice: boolean }[] = [];
  try {
    branches = (await listBranches(tx, actor)).branches;
  } catch (error) {
    if (
      !(error instanceof PermissionDeniedError) &&
      !(error instanceof Error && error.name === 'CatalogError')
    ) {
      throw error;
    }
  }
  const rate = await vatRate(tx);
  const totals = checkTotals({
    lineTotalsCents: lineRows.map((line) => line.lineTotalCents ?? 0n),
    subtotalCents: row.subtotalCents,
    vatCents: row.vatCents,
    totalCents: row.totalCents,
    vatRateBasisPoints: rate,
  });
  const confidence = asConfidence(row.fieldConfidence);
  const low = Object.entries(confidence)
    .filter(([, value]) => isLowConfidence(value))
    .map(([key]) => key);
  for (const line of lineRows) {
    for (const [key, value] of Object.entries(asConfidence(line.fieldConfidence))) {
      if (isLowConfidence(value)) {
        low.push(`line.${line.lineNo}.${key}`);
      }
    }
  }
  return {
    id: row.id,
    status: row.status as DocumentStatus,
    statusLabel: statusLabel(row.status),
    filename: row.filename,
    contentType: row.contentType,
    pageCount: row.pageCount,
    documentType: row.documentType ?? 'tax_invoice',
    supplierName: row.supplierName,
    supplierVat: row.supplierVat,
    partyId: row.partyId,
    partyName: party?.displayName ?? null,
    supplierMatch: row.supplierMatch,
    documentNumber: row.documentNumber,
    documentDate: row.documentDate ?? '',
    dueDate: row.dueDate ?? '',
    currency: row.currencyCode.trim(),
    subtotal: row.subtotalCents === null ? '' : centsToDecimal(row.subtotalCents),
    vat: row.vatCents === null ? '' : centsToDecimal(row.vatCents),
    total: row.totalCents === null ? '' : centsToDecimal(row.totalCents),
    totalLabel: moneyLabel(row.totalCents),
    branchId: row.branchId ?? branches.find((branch) => branch.headOffice)?.id ?? '',
    branches,
    confidence,
    lowConfidence: row.status === 'ready' ? low : [],
    lines: lineRows.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      description: line.description,
      supplierCode: line.supplierCode,
      quantity: displayQuantity(line.quantity),
      unit: line.unit,
      unitPrice: line.unitPriceCents === null ? '' : centsToDecimal(line.unitPriceCents),
      vat: line.vatCents === null ? '' : centsToDecimal(line.vatCents),
      lineTotal: line.lineTotalCents === null ? '' : centsToDecimal(line.lineTotalCents),
      itemId: line.itemId,
      itemName: items.find((item) => item.id === line.itemId)?.name ?? null,
      matchMethod: line.matchMethod,
      confidence: asConfidence(line.fieldConfidence),
    })),
    warnings: row.status === 'ready' || row.status === 'posted' ? totals.warnings : [],
    duplicate: duplicate
      ? {
          id: duplicate.id,
          documentNumber: duplicate.documentNumber,
          statusLabel: statusLabel(duplicate.status),
        }
      : null,
    receipts: links.map((link) => {
      const line = lineRows.find((rowLine) => rowLine.id === link.lineId);
      return {
        movementId: link.movementId,
        lineId: link.lineId,
        itemId: line?.itemId ?? null,
        itemName: items.find((item) => item.id === line?.itemId)?.name ?? line?.description ?? '',
      };
    }),
    failureMessage: row.failureMessage,
    goodsReceiptId: row.goodsReceiptId,
    canCapture: access.canCapture,
    canReview: access.canReview,
  };
}

export async function listDocuments(tx: TenantTransaction, actor: Actor) {
  const access = await captureAccess(tx, actor.userId);
  const rows = await tx.db.select().from(documents).orderBy(desc(documents.createdAt)).limit(100);
  const links = await tx.db.select().from(receiptLinks);
  const lineRows = await tx.db.select().from(lines);
  return {
    canCapture: access.canCapture,
    documents: rows.map((row) => {
      const link = links.find((item) => item.documentId === row.id);
      const line = lineRows.find((item) => item.id === link?.lineId);
      return {
        id: row.id,
        status: row.status,
        statusLabel: statusLabel(row.status),
        supplierName: row.supplierName,
        documentNumber: row.documentNumber,
        documentDate: row.documentDate ?? '',
        totalLabel: moneyLabel(row.totalCents),
        receiptItemId: line?.itemId ?? null,
        hasReceipt: Boolean(link),
      };
    }),
  };
}

export async function fileFor(tx: TenantTransaction, actor: Actor, id: string) {
  await captureAccess(tx, actor.userId);
  const row = await loadDocument(tx, id);
  const opened = await currentDocumentStore().open({ tenantId: tx.tenantId, documentId: id });
  if (!opened) {
    throw new DocumentError(copy.notFound, 404, 'not_found');
  }
  return { bytes: opened.bytes, contentType: row.contentType };
}

export async function maybeContinue(
  company: string,
  rowStatus: string,
  updatedAt: Date,
  id: string,
) {
  const stale = rowStatus === 'reading' && Date.now() - updatedAt.getTime() > 2 * 60 * 1000;
  if (rowStatus === 'queued' || stale) {
    kickDocument(company, id);
  }
}

export async function readUpdatedAt(tx: TenantTransaction, id: string): Promise<Date | null> {
  const rows = await tx.db
    .select({ status: documents.status, updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.id, id));
  const row = rows[0];
  if (!row) {
    return null;
  }
  await maybeContinue(tx.tenantId, row.status, row.updatedAt, id);
  return row.updatedAt;
}

export async function captureOverview(tx: TenantTransaction) {
  const rows = await tx.db
    .select({ enabled: settings.enabled, reader: settings.reader })
    .from(settings);
  const period = usagePeriod();
  const usage = await tx.db.select().from(pageUsage).where(eq(pageUsage.period, period));
  const reader = rows[0]?.reader === 'premium' ? 'premium' : 'standard';
  const fellBack = reader === 'premium' && !premiumConfigured();
  let standardPages = 0;
  let premiumPages = 0;
  for (const row of usage) {
    if (row.reader === 'premium') {
      premiumPages += row.pages;
    } else {
      standardPages += row.pages;
    }
  }
  return {
    enabled: rows[0]?.enabled ?? true,
    reader,
    fellBack,
    note: fellBack ? copy.premiumFallback : null,
    period,
    periodLabel: periodLabel(period),
    pagesRead: standardPages + premiumPages,
    pagesReadStandard: standardPages,
    pagesReadPremium: premiumPages,
  };
}

export async function setCaptureEnabled(
  tx: TenantTransaction,
  operator: { id: string; requestIp: string | null; userAgent: string | null },
  next: boolean,
  reader: ReaderChoice,
) {
  const before = await captureOverview(tx);
  const now = new Date();
  const unchanged =
    before.enabled === next &&
    before.reader === reader &&
    (await tx.db.select().from(settings)).length > 0;
  if (unchanged) {
    return before;
  }
  await tx.db
    .insert(settings)
    .values({ tenantId: tx.tenantId, enabled: next, reader, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.tenantId,
      set: { enabled: next, reader, updatedAt: now },
    });
  await appendAuditEvent(tx, {
    action: 'document.capture.settings',
    entityType: 'doc_settings',
    entityId: tx.tenantId,
    actorId: null,
    operatorId: operator.id,
    actorKind: 'operator',
    beforeData: { enabled: before.enabled, reader: before.reader },
    afterData: { enabled: next, reader },
    requestIp: operator.requestIp,
    userAgent: operator.userAgent,
  });
  return captureOverview(tx);
}
