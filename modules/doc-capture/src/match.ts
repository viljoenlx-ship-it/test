import { normalSupplierName, normalVat } from './duplicates';

export type SupplierCandidate = {
  id: string;
  displayName: string;
  legalName: string | null;
  tradingName?: string | null;
  vatNumber: string | null;
  roles: readonly string[];
  status: string;
};

export type SupplierMatch = {
  partyId: string | null;
  method: 'vat' | 'name' | 'none';
  score: number;
};

export type CatalogCandidate = {
  id: string;
  name: string;
  code: string;
  barcode: string;
  unit: string;
  kind: string;
};

export type CodeMemory = {
  supplierCode: string;
  itemId: string;
};

export type LineMatch = {
  itemId: string | null;
  method: 'supplier_code' | 'barcode' | 'sku' | 'name' | 'none';
  score: number;
};

const NAME_THRESHOLD = 0.72;

/** Bigram Dice coefficient on a normalised name. */
export function nameSimilarity(left: string, right: string): number {
  const a = normalSupplierName(left);
  const b = normalSupplierName(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.92;
  }
  const grams = (text: string) => {
    const counts = new Map<string, number>();
    const padded = ` ${text} `;
    for (let index = 0; index < padded.length - 1; index += 1) {
      const gram = padded.slice(index, index + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let leftCount = 0;
  let rightCount = 0;
  let overlap = 0;
  for (const count of leftGrams.values()) {
    leftCount += count;
  }
  for (const count of rightGrams.values()) {
    rightCount += count;
  }
  for (const [gram, count] of leftGrams) {
    overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  if (leftCount + rightCount === 0) {
    return 0;
  }
  return (2 * overlap) / (leftCount + rightCount);
}

function supplierNames(candidate: SupplierCandidate): string[] {
  return [candidate.displayName, candidate.legalName ?? '', candidate.tradingName ?? ''].filter(
    (name) => name.trim().length > 0,
  );
}

/** VAT number first, then the closest supplier name. */
export function matchSupplier(
  supplierName: string,
  supplierVat: string,
  candidates: readonly SupplierCandidate[],
): SupplierMatch {
  const suppliers = candidates.filter(
    (candidate) => candidate.status === 'active' && candidate.roles.includes('supplier'),
  );
  const vat = normalVat(supplierVat);
  if (vat.length >= 9) {
    const byVat = suppliers.find((candidate) => normalVat(candidate.vatNumber ?? '') === vat);
    if (byVat) {
      return { partyId: byVat.id, method: 'vat', score: 1 };
    }
  }
  let best: SupplierMatch = { partyId: null, method: 'none', score: 0 };
  for (const candidate of suppliers) {
    for (const name of supplierNames(candidate)) {
      const score = nameSimilarity(supplierName, name);
      if (score > best.score) {
        best = { partyId: candidate.id, method: 'name', score };
      }
    }
  }
  if (best.score < NAME_THRESHOLD) {
    return { partyId: null, method: 'none', score: best.score };
  }
  return { ...best, method: 'name' };
}

function normalCode(value: string): string {
  return value.trim().toLowerCase();
}

/** Remembered supplier code, then barcode, item code, then a fuzzy name. */
export function matchLine(input: {
  description: string;
  supplierCode: string;
  memory: readonly CodeMemory[];
  items: readonly CatalogCandidate[];
}): LineMatch {
  const stock = input.items.filter((item) => item.kind === 'stock');
  const code = normalCode(input.supplierCode);
  if (code) {
    const remembered = input.memory.find((row) => normalCode(row.supplierCode) === code);
    if (remembered && stock.some((item) => item.id === remembered.itemId)) {
      return { itemId: remembered.itemId, method: 'supplier_code', score: 1 };
    }
    const byBarcode = stock.find((item) => item.barcode && normalCode(item.barcode) === code);
    if (byBarcode) {
      return { itemId: byBarcode.id, method: 'barcode', score: 1 };
    }
    const bySku = stock.find((item) => normalCode(item.code) === code);
    if (bySku) {
      return { itemId: bySku.id, method: 'sku', score: 1 };
    }
  }
  let best: LineMatch = { itemId: null, method: 'none', score: 0 };
  for (const item of stock) {
    const score = nameSimilarity(input.description, item.name);
    if (score > best.score) {
      best = { itemId: item.id, method: 'name', score };
    }
  }
  if (best.score < NAME_THRESHOLD || !best.itemId) {
    return { itemId: null, method: 'none', score: best.score };
  }
  return best;
}
