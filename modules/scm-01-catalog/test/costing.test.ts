import { describe, expect, it } from 'vitest';
import { code128Values } from '../src/code128';
import {
  formatQuantity,
  parseQuantity,
  quantityPhrase,
  weightedAverageAfterReceiptReversal,
  weightedAverageOnReceipt,
} from '../src/costing';
import { getModule } from '@omnivate/shared';

describe('weighted average costing', () => {
  it('blends two receipts and rounds half a cent away from zero', () => {
    const first = weightedAverageOnReceipt({
      onHandMicros: 0n,
      averageCostCents: 0n,
      receiptMicros: parseQuantity('10'),
      receiptUnitCostCents: 1000n,
    });
    expect(first).toBe(1000n);

    const blended = weightedAverageOnReceipt({
      onHandMicros: parseQuantity('10'),
      averageCostCents: first,
      receiptMicros: parseQuantity('10'),
      receiptUnitCostCents: 3000n,
    });
    expect(blended).toBe(2000n);

    const half = weightedAverageOnReceipt({
      onHandMicros: parseQuantity('1'),
      averageCostCents: 100n,
      receiptMicros: parseQuantity('1'),
      receiptUnitCostCents: 101n,
    });
    expect(half).toBe(101n);
  });

  it('uses the receipt cost when nothing is on hand', () => {
    expect(
      weightedAverageOnReceipt({
        onHandMicros: parseQuantity('-2'),
        averageCostCents: 500n,
        receiptMicros: parseQuantity('5'),
        receiptUnitCostCents: 1200n,
      }),
    ).toBe(1200n);
  });

  it('unwinds a receipt without touching the average of an issue', () => {
    const corrected = weightedAverageAfterReceiptReversal({
      onHandMicros: parseQuantity('16'),
      averageCostCents: 2000n,
      reversalMicros: parseQuantity('10'),
      originalUnitCostCents: 3000n,
    });
    expect(corrected).toBe(333n);
    expect(formatQuantity(parseQuantity('10.50'))).toBe('10.5');
    expect(quantityPhrase(parseQuantity('1'), 'bag', 'bags')).toBe('1 bag');
    expect(quantityPhrase(parseQuantity('12'), 'bag', 'bags')).toBe('12 bags');
    expect(quantityPhrase(parseQuantity('86'), 'metre', 'metres')).toBe('86 metres');
    expect(quantityPhrase(parseQuantity('-3'), 'tube', 'tubes')).toBe('-3 tubes');
  });

  it('keeps SCM-01 prerequisites aligned with the catalog', () => {
    expect(getModule('SCM-01').prerequisites).toEqual(['KRN-03', 'FIN-01']);
    expect(getModule('SCM-01').name).toBe('Universal Catalog & Inventory Ledger');
  });
});

describe('barcode', () => {
  it('uses code set B and the standard checksum', () => {
    expect(code128Values('HI')).toEqual([104, 40, 41, 20, 106]);
  });
});
