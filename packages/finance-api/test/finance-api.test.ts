import { describe, expect, it } from 'vitest';
import { HttpError, integerBigint, isoDate, positiveCents } from '../src/index';

describe('finance API input guards', () => {
  it('accepts real ISO calendar dates and rejects impossible dates', () => {
    expect(isoDate('2026-11-20', 'Date')).toBe('2026-11-20');
    expect(() => isoDate('2026-02-30', 'Date')).toThrow(HttpError);
    expect(() => isoDate('20/11/2026', 'Date')).toThrow(HttpError);
  });

  it('keeps integer-cent amounts exact and rejects decimals', () => {
    expect(positiveCents('1050', 'Amount')).toBe(1050n);
    expect(integerBigint('-250', 'Balance', true)).toBe(-250n);
    expect(() => positiveCents('0', 'Amount')).toThrow(HttpError);
    expect(() => integerBigint('12.50', 'Amount')).toThrow(HttpError);
    expect(() => integerBigint('-1', 'Amount')).toThrow(HttpError);
  });
});
