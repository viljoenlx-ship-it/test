import { describe, expect, it } from 'vitest';
import { findDuplicate } from '../src/duplicates';
import { matchLine, matchSupplier, nameSimilarity } from '../src/match';
import { checkTotals, decimalCents } from '../src/totals';

const suppliers = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Silver Mango Packaging (Pty) Ltd',
    legalName: 'Silver Mango Packaging (Pty) Ltd',
    tradingName: 'Silver Mango',
    vatNumber: '4991001002',
    roles: ['supplier'],
    status: 'active',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Cedar Kite Grocers (Pty) Ltd',
    legalName: 'Cedar Kite Grocers (Pty) Ltd',
    vatNumber: '4991001001',
    roles: ['customer'],
    status: 'active',
  },
];

const items = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    name: 'Chipboard screw 4 x 50 mm',
    code: 'AT-SCR-450',
    barcode: '9900000001001',
    unit: 'each',
    kind: 'stock',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    name: 'Delivery in the Cape',
    code: 'AT-DEL',
    barcode: '',
    unit: 'trip',
    kind: 'service',
  },
];

describe('matching and totals', () => {
  it('matches a supplier by VAT before name, and ignores a customer', () => {
    const byVat = matchSupplier('Someone Else', '4991 001 002', suppliers);
    expect(byVat).toMatchObject({ partyId: suppliers[0]?.id, method: 'vat' });
    const byName = matchSupplier('Silver Mango Packaging', '', suppliers);
    expect(byName.method).toBe('name');
    expect(byName.partyId).toBe(suppliers[0]?.id);
    const none = matchSupplier('Fictional Quarry Co', '4111111111', suppliers);
    expect(none.method).toBe('none');
    expect(nameSimilarity('Silver Mango', 'Silver Mango Packaging (Pty) Ltd')).toBeGreaterThan(0.7);
  });

  it('matches a line by remembered code, then barcode, then name', () => {
    const remembered = matchLine({
      description: 'Unknown',
      supplierCode: 'SM-SCR',
      memory: [{ supplierCode: 'sm-scr', itemId: items[0]?.id ?? '' }],
      items,
    });
    expect(remembered.method).toBe('supplier_code');
    const barcode = matchLine({
      description: 'Unknown',
      supplierCode: '9900000001001',
      memory: [],
      items,
    });
    expect(barcode.method).toBe('barcode');
    const named = matchLine({
      description: 'Chipboard screw 4 x 50 mm',
      supplierCode: '',
      memory: [],
      items,
    });
    expect(named.method).toBe('name');
    expect(named.itemId).toBe(items[0]?.id);
    const service = matchLine({
      description: 'Delivery in the Cape',
      supplierCode: 'AT-DEL',
      memory: [],
      items,
    });
    expect(service.method).toBe('none');
  });

  it('warns when VAT is not 15 percent or the lines do not add up', () => {
    const fine = checkTotals({
      lineTotalsCents: [decimalCents('100.00'), decimalCents('51.00')],
      subtotalCents: decimalCents('151.00'),
      vatCents: decimalCents('22.65'),
      totalCents: decimalCents('173.65'),
    });
    expect(fine.warnings).toEqual([]);
    const wrongVat = checkTotals({
      lineTotalsCents: [decimalCents('100.00')],
      subtotalCents: decimalCents('100.00'),
      vatCents: decimalCents('10.00'),
      totalCents: decimalCents('110.00'),
    });
    expect(wrongVat.warnings.join(' ')).toMatch(/15%/);
    const wrongLines = checkTotals({
      lineTotalsCents: [decimalCents('40.00')],
      subtotalCents: decimalCents('100.00'),
      vatCents: decimalCents('15.00'),
      totalCents: decimalCents('115.00'),
    });
    expect(wrongLines.warnings.join(' ')).toMatch(/Line totals/);
  });

  it('detects the same supplier and document number', () => {
    const current = {
      id: 'doc-2',
      partyId: suppliers[0]?.id ?? null,
      supplierVat: '4991001002',
      supplierName: 'Silver Mango Packaging (Pty) Ltd',
      documentNumber: 'sm-1044',
      status: 'ready',
    };
    const existing = [
      {
        id: 'doc-1',
        partyId: null,
        supplierVat: '4991 001 002',
        supplierName: 'Other',
        documentNumber: 'SM-1044',
        status: 'posted',
      },
      {
        id: 'doc-3',
        partyId: null,
        supplierVat: '',
        supplierName: 'Silver Mango Packaging (Pty) Ltd',
        documentNumber: 'SM-9',
        status: 'ready',
      },
    ];
    expect(findDuplicate(current, existing)?.id).toBe('doc-1');
    expect(findDuplicate({ ...current, id: 'doc-1' }, existing)).toBeNull();
    expect(
      findDuplicate(current, [
        { ...existing[0]!, id: 'doc-9', status: 'failed', documentNumber: 'SM-1044' },
      ]),
    ).toBeNull();
  });
});
