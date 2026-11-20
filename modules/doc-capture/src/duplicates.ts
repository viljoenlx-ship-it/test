export type DuplicateCandidate = {
  id: string;
  partyId: string | null;
  supplierVat: string;
  supplierName: string;
  documentNumber: string;
  status: string;
};

export function normalVat(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalDocumentNumber(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

export function normalSupplierName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(pty\)\s*ltd\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Same supplier and document number, ignoring the document itself and rows that
 * never produced a number. Failed reads are not duplicates.
 */
export function findDuplicate(
  current: DuplicateCandidate,
  existing: readonly DuplicateCandidate[],
): DuplicateCandidate | null {
  const number = normalDocumentNumber(current.documentNumber);
  if (!number) {
    return null;
  }
  const vat = normalVat(current.supplierVat);
  const name = normalSupplierName(current.supplierName);
  for (const row of existing) {
    if (row.id === current.id || row.status === 'failed') {
      continue;
    }
    if (normalDocumentNumber(row.documentNumber) !== number) {
      continue;
    }
    const sameParty = Boolean(current.partyId) && current.partyId === row.partyId;
    const sameVat = vat.length >= 9 && vat === normalVat(row.supplierVat);
    const sameName = name.length >= 2 && name === normalSupplierName(row.supplierName);
    if (sameParty || sameVat || sameName) {
      return row;
    }
  }
  return null;
}
