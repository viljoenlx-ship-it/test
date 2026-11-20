import { describe, expect, it } from 'vitest';
import {
  evaluateFormula,
  formulaCents,
  formulaCycle,
  formulaDecimal,
  parseFormula,
  presentFormula,
  previewFormula,
  tokensToFormula,
  type FormulaNumber,
} from '../src/index';

const fields = new Set([
  'qty',
  'price',
  'length',
  'width',
  'area',
  'on_hand',
  'reorder_level',
  'split',
]);

function nums(
  values: Record<string, string>,
  moneyKeys: string[] = [],
): Record<string, FormulaNumber> {
  const result: Record<string, FormulaNumber> = {};
  for (const [key, text] of Object.entries(values)) {
    result[key] = { kind: moneyKeys.includes(key) ? 'money' : 'number', text };
  }
  return result;
}

describe('formula engine', () => {
  it('multiplies quantity by a price in cents', () => {
    const result = evaluateFormula(
      'qty * price',
      fields,
      nums({ qty: '4', price: '1250' }, ['price']),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formulaCents(result.scaled)).toEqual({ ok: true, cents: 5000 });
      expect(presentFormula(result.scaled, { display: 'money', places: 0, unit: '' })).toBe(
        'R50.00',
      );
    }
  });

  it('multiplies length by width and keeps a decimal', () => {
    const result = evaluateFormula('length × width', fields, nums({ length: '2.5', width: '4' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formulaDecimal(result.scaled, 2)).toEqual({ ok: true, text: '10.00' });
      expect(presentFormula(result.scaled, { display: 'number', places: 1, unit: 'm²' })).toBe(
        '10.0 m²',
      );
    }
  });

  it('honours brackets, ROUND, MIN, MAX, and IF', () => {
    const values = nums({ qty: '3', price: '10', on_hand: '4', reorder_level: '6', split: '2' });
    const bracketed = evaluateFormula('(qty + 1) * split', fields, values);
    expect(bracketed.ok && formulaDecimal(bracketed.scaled, 0)).toEqual({ ok: true, text: '8' });

    const rounded = evaluateFormula('ROUND(10 / 3, 2)', fields, values);
    expect(rounded.ok && formulaDecimal(rounded.scaled, 2)).toEqual({ ok: true, text: '3.33' });

    const lowest = evaluateFormula('MIN(qty, split, 1)', fields, values);
    expect(lowest.ok && formulaDecimal(lowest.scaled, 0)).toEqual({ ok: true, text: '1' });

    const highest = evaluateFormula('MAX(qty, reorder_level)', fields, values);
    expect(highest.ok && formulaDecimal(highest.scaled, 0)).toEqual({ ok: true, text: '6' });

    const chosen = evaluateFormula('IF(on_hand < reorder_level, price, 0)', fields, values);
    expect(chosen.ok && formulaDecimal(chosen.scaled, 0)).toEqual({ ok: true, text: '10' });

    const other = evaluateFormula('IF(on_hand >= reorder_level, 1, 0)', fields, values);
    expect(other.ok && formulaDecimal(other.scaled, 0)).toEqual({ ok: true, text: '0' });
  });

  it('does not evaluate the unused branch of IF, so a zero there is safe', () => {
    const result = evaluateFormula('IF(1 = 1, 5, 1 / 0)', fields, {});
    expect(result.ok && formulaDecimal(result.scaled, 0)).toEqual({ ok: true, text: '5' });
  });

  it('rejects division by zero', () => {
    const result = evaluateFormula('price / split', fields, nums({ price: '10', split: '0' }));
    expect(result).toMatchObject({ ok: false, code: 'divide_by_zero' });
  });

  it('rejects a circular reference and a field that is not on the list', () => {
    const cycle = formulaCycle(
      [
        { key: 'area', label: 'Area', formula: 'length * width' },
        { key: 'length', label: 'Length', formula: 'area / width' },
      ],
      new Set(['area', 'length', 'width']),
    );
    expect(cycle).toMatch(/Area uses Length/);
    expect(cycle).toMatch(/Length uses Area/);

    const self = formulaCycle(
      [{ key: 'area', label: 'Area', formula: 'area * 2' }],
      new Set(['area']),
    );
    expect(self).toMatch(/Area uses itself/);

    const foreign = parseFormula('eval(1)', fields);
    expect(foreign.ok).toBe(false);
    expect(foreign.ok ? '' : foreign.message).toMatch(/list/);
    expect(parseFormula('process.exit(1)', fields).ok).toBe(false);
  });

  it('builds a formula from picked fields instead of a raw expression', () => {
    const source = tokensToFormula([
      { kind: 'field', key: 'qty' },
      { kind: 'op', op: '*' },
      { kind: 'field', key: 'price' },
    ]);
    expect(source).toBe('qty * price');
    const preview = previewFormula(
      source,
      [
        { key: 'qty', kind: 'number', label: 'Quantity' },
        { key: 'price', kind: 'money', label: 'Price' },
      ],
      { qty: '4', price: '12.50' },
      { display: 'money', places: 0, unit: '' },
    );
    expect(preview).toEqual({ ok: true, text: 'R50.00' });
  });
});
