import { getModule } from '@omnivate/shared';
import { describe, expect, it } from 'vitest';
import { matchColumns, normaliseHeader } from '../src/columns';
import { detectDelimiter, parseCsv } from '../src/csv';
import {
  centsToDecimal,
  exclusiveFromInclusive,
  parseSaDate,
  parseSaMoney,
  parseSaQuantity,
  parseVatNumber,
} from '../src/sa-format';
import { contactsTarget } from '../src/targets/register-contacts';

describe('South African spreadsheet values', () => {
  it('keeps the catalog prerequisites for KRN-06', () => {
    expect(getModule('KRN-06').prerequisites).toEqual(['KRN-01', 'KRN-02']);
  });

  it('reads rand amounts with spaces and a comma decimal', () => {
    expect(parseSaMoney('R 1 234,56')).toEqual({ ok: true, value: 123456n });
    expect(parseSaMoney('R1 234.50')).toEqual({ ok: true, value: 123450n });
    expect(parseSaMoney('10,5')).toEqual({ ok: true, value: 1050n });
    expect(parseSaMoney('1.234')).toEqual({ ok: true, value: 123400n });
    expect(parseSaMoney('1,234.56')).toEqual({ ok: true, value: 123456n });
    expect(parseSaMoney('not money').ok).toBe(false);
  });

  it('strips VAT from an inclusive price and keeps half-cent rounding away from zero', () => {
    expect(exclusiveFromInclusive(11_500n, 1500)).toBe(10_000n);
    expect(exclusiveFromInclusive(1_150n, 1500)).toBe(1_000n);
    expect(centsToDecimal(10_000n)).toBe('100.00');
  });

  it('reads day-first dates and quantities with a comma decimal', () => {
    expect(parseSaDate('19/11/2026')).toEqual({ ok: true, value: '2026-11-19' });
    expect(parseSaDate('32/01/2026').ok).toBe(false);
    expect(parseSaDate('2026-11-19')).toEqual({ ok: true, value: '2026-11-19' });
    expect(parseSaQuantity('1 000,5')).toEqual({ ok: true, value: 1_000_500n });
    expect(parseSaQuantity('1.234')).toEqual({ ok: true, value: 1_234n });
    expect(parseSaQuantity('-2').ok).toBe(false);
  });

  it('asks for a 10 digit VAT number', () => {
    expect(parseVatNumber('4123456789')).toEqual({ ok: true, value: '4123456789' });
    expect(parseVatNumber('123')).toEqual({
      ok: false,
      message: 'VAT number should be 10 digits.',
    });
  });

  it('matches headers by label, alias, and a remembered choice', () => {
    const saved = new Map<string, string>([[normaliseHeader('Tax ref'), 'vat_number']]);
    const map = matchColumns(['Tax ref', 'Company'], contactsTarget.fields, saved);
    expect(map['Tax ref']).toBe('vat_number');
    expect(map.Company).toBe('display_name');
  });

  it('treats a semicolon file as a spreadsheet', () => {
    expect(detectDelimiter('Name;Email\nA;b@example.com')).toBe(';');
    const rows = parseCsv('Name;VAT number\nNaledi;4123456789', ';');
    expect(rows[1]).toEqual(['Naledi', '4123456789']);
  });
});
