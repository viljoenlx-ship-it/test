import { describe, expect, it } from 'vitest';
import { isHealthResponse } from '../src/health';
import { southAfricaPreset } from '../src/preset';

describe('South Africa preset', () => {
  it('uses 15% VAT, ZAR, and Africa/Johannesburg', () => {
    expect(southAfricaPreset.currency).toBe('ZAR');
    expect(southAfricaPreset.vatStandardRateBasisPoints).toBe(1500);
    expect(southAfricaPreset.vatStandardRateLabel).toBe('15%');
    expect(southAfricaPreset.timeZone).toBe('Africa/Johannesburg');
    expect(southAfricaPreset.locale).toBe('en-ZA');
    expect(southAfricaPreset.financialYearStartMonth).toBe(3);
    expect(southAfricaPreset.accountingBasis).toBe('accrual');
  });

  it('accepts a health payload that carries the same preset', () => {
    expect(
      isHealthResponse({
        status: 'ok',
        service: 'omnivate-api',
        database: 'up',
        currency: southAfricaPreset.currency,
        timeZone: southAfricaPreset.timeZone,
        vatStandardRateBasisPoints: southAfricaPreset.vatStandardRateBasisPoints,
      }),
    ).toBe(true);
    expect(isHealthResponse({ status: 'ok', currency: 'USD' })).toBe(false);
  });
});
