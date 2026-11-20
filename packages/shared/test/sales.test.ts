import { describe, expect, it } from 'vitest';
import { vatOn, money } from '../src/money';
import {
  agingBucket,
  centsToDecimal,
  creditDiscountCents,
  documentNumber,
  invoiceStatusLabel,
  parseSalesQuantity,
  quoteStatusLabel,
  roundHalfAway,
  salesLineAmounts,
  sumSalesLines,
} from '../src/sales';

describe('sales VAT rounding', () => {
  it('rounds half a cent away from zero on the line and on VAT', () => {
    expect(roundHalfAway(15n, 10n)).toBe(2n);
    expect(roundHalfAway(-15n, 10n)).toBe(-2n);

    const tenCents = salesLineAmounts({
      quantity: parseSalesQuantity('1'),
      unitPriceCents: 10n,
      discountCents: 0n,
      vatBasisPoints: 1500,
    });
    expect(tenCents.netCents).toBe(10n);
    expect(tenCents.vatCents).toBe(2n);
    expect(tenCents.totalCents).toBe(12n);
    expect(vatOn(money(10n), 1500).amountCents).toBe(2n);
  });

  it('takes VAT on the discounted net, not the list price', () => {
    const line = salesLineAmounts({
      quantity: parseSalesQuantity('3'),
      unitPriceCents: 333n,
      discountCents: 100n,
      vatBasisPoints: 1500,
    });
    expect(line.extendedCents).toBe(999n);
    expect(line.netCents).toBe(899n);
    expect(line.vatCents).toBe(135n);
    expect(line.totalCents).toBe(1034n);
  });

  it('keeps a fractional quantity exact', () => {
    const line = salesLineAmounts({
      quantity: parseSalesQuantity('2.5'),
      unitPriceCents: 1000n,
      discountCents: 0n,
      vatBasisPoints: 1500,
    });
    expect(line.netCents).toBe(2500n);
    expect(line.vatCents).toBe(375n);
    expect(centsToDecimal(line.totalCents)).toBe('28.75');
  });

  it('makes a full credit the exact inverse of the invoice line', () => {
    const invoice = salesLineAmounts({
      quantity: parseSalesQuantity('4'),
      unitPriceCents: 6800n,
      discountCents: 500n,
      vatBasisPoints: 1500,
    });
    const firstQty = parseSalesQuantity('1.5');
    const firstDiscount = creditDiscountCents({
      originalQuantity: parseSalesQuantity('4'),
      originalDiscountCents: 500n,
      alreadyCreditedQuantity: 0n,
      alreadyCreditedDiscountCents: 0n,
      quantity: firstQty,
    });
    const restDiscount = creditDiscountCents({
      originalQuantity: parseSalesQuantity('4'),
      originalDiscountCents: 500n,
      alreadyCreditedQuantity: firstQty,
      alreadyCreditedDiscountCents: firstDiscount,
      quantity: parseSalesQuantity('2.5'),
    });
    expect(firstDiscount + restDiscount).toBe(500n);
    const rest = salesLineAmounts({
      quantity: parseSalesQuantity('2.5'),
      unitPriceCents: 6800n,
      discountCents: restDiscount,
      vatBasisPoints: 1500,
    });
    const first = salesLineAmounts({
      quantity: firstQty,
      unitPriceCents: 6800n,
      discountCents: firstDiscount,
      vatBasisPoints: 1500,
    });
    expect(sumSalesLines([first, rest]).netCents).toBe(invoice.netCents);
  });

  it('names quote and invoice states, and ages open balances', () => {
    expect(documentNumber('invoice', 2026, 1)).toBe('INV-2026-00001');
    expect(quoteStatusLabel('sent', '2026-11-01', '2026-11-19')).toBe('Expired');
    expect(quoteStatusLabel('accepted', '2026-11-01', '2026-11-19')).toBe('Accepted');
    expect(
      invoiceStatusLabel({
        totalCents: 1000n,
        balanceCents: 400n,
        allocatedCents: 600n,
        dueOn: '2026-12-01',
        today: '2026-11-19',
      }),
    ).toBe('Partly Paid');
    expect(
      invoiceStatusLabel({
        totalCents: 1000n,
        balanceCents: 400n,
        allocatedCents: 600n,
        dueOn: '2026-10-01',
        today: '2026-11-19',
      }),
    ).toBe('Overdue');
    expect(agingBucket(30)).toBe('current');
    expect(agingBucket(31)).toBe('days_30');
    expect(agingBucket(90)).toBe('days_60');
    expect(agingBucket(91)).toBe('days_90');
  });
});
