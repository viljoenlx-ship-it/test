import { describe, expect, it } from 'vitest';
import { addMoney, formatZar, money, vatOn, zarFromDecimal } from '../src/money';
import { southAfricaPreset } from '../src/preset';

describe('ZAR money', () => {
  it('stores decimal rands as exact cents', () => {
    expect(zarFromDecimal('10.00').amountCents).toBe(1000n);
    expect(zarFromDecimal('10.5').amountCents).toBe(1050n);
    expect(zarFromDecimal('0.10').amountCents).toBe(10n);
    expect(zarFromDecimal('-0.01').amountCents).toBe(-1n);
  });

  it('adds tenths of a rand without binary floating-point drift', () => {
    const sum = addMoney(zarFromDecimal('0.10'), zarFromDecimal('0.20'));
    expect(sum.amountCents).toBe(30n);
    expect(sum.currency).toBe('ZAR');
    expect(formatZar(sum)).toBe('R0.30');
  });

  it('formats amounts past the safe integer limit from bigint cents', () => {
    const huge = money(9007199254740993n);
    expect(formatZar(huge)).toBe('R90 071 992 547 409.93');
  });

  it('rejects floats, extra decimals, and separators', () => {
    expect(() => zarFromDecimal(10.5 as unknown as string)).toThrow(/never floats/);
    expect(() => zarFromDecimal('10.555')).toThrow(/Invalid ZAR amount/);
    expect(() => zarFromDecimal('1,000.00')).toThrow(/Invalid ZAR amount/);
    expect(() => zarFromDecimal('1e2')).toThrow(/Invalid ZAR amount/);
  });

  it('calculates 15% South African VAT in whole cents', () => {
    const rate = southAfricaPreset.vatStandardRateBasisPoints;
    expect(vatOn(zarFromDecimal('100.00'), rate).amountCents).toBe(1500n);
    expect(vatOn(zarFromDecimal('0.10'), rate).amountCents).toBe(2n);
    expect(formatZar(vatOn(zarFromDecimal('100.00'), rate))).toBe('R15.00');
  });

  it('rounds half a cent away from zero so a reversal inverts the tax', () => {
    const rate = southAfricaPreset.vatStandardRateBasisPoints;
    const charge = vatOn(zarFromDecimal('0.10'), rate);
    const reversal = vatOn(zarFromDecimal('-0.10'), rate);
    expect(charge.amountCents).toBe(2n);
    expect(reversal.amountCents).toBe(-2n);
  });
});
