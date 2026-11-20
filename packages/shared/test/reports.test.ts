import { describe, expect, it } from 'vitest';
import {
  formatReportNumber,
  formatSaDate,
  parseReportDefinition,
  saDateRange,
  summariseReport,
} from '../src/reports';

describe('report definitions', () => {
  it('describes a grouped receipt report in one sentence', () => {
    expect(
      summariseReport({
        sourceLabel: 'Stock Receipts',
        filters: [
          { label: 'Supplier', op: 'contains', value: 'Silver Mango Packaging' },
          { label: 'Received', op: 'this_month' },
        ],
        groupBy: ['Item'],
        totals: [
          { label: 'Qty', fn: 'sum' },
          { label: 'Value', fn: 'sum' },
        ],
      }),
    ).toBe(
      'Stock Receipts from Silver Mango Packaging, This Month, grouped by Item, showing total Qty and Value',
    );
  });

  it('uses Johannesburg month bounds', () => {
    const now = new Date('2026-11-19T22:30:00.000Z');
    expect(saDateRange('this_month', now)).toEqual({
      from: '2026-11-01T00:00:00+02:00',
      to: '2026-12-01T00:00:00+02:00',
    });
    expect(saDateRange('last_month', now).from).toBe('2026-10-01T00:00:00+02:00');
    expect(saDateRange('this_year', now).from).toBe('2026-01-01T00:00:00+02:00');
  });

  it('formats dates and quantities the South African way', () => {
    expect(formatSaDate('2026-03-04')).toBe('4 Mar 2026');
    expect(formatSaDate('2026-11-19')).toBe('19 Nov 2026');
    expect(formatReportNumber('3400.0000')).toBe('3 400');
    expect(formatReportNumber('-12.5000')).toBe('-12.5');
  });

  it('rejects a source that is not a registry key', () => {
    expect(() =>
      parseReportDefinition({
        source: 'stock_items; drop table tenants',
        columns: ['item'],
        filters: [],
        groupBy: [],
        totals: [],
        sort: [],
        chart: 'none',
      }),
    ).toThrow(/data source/);
  });

  it('keeps a normal definition', () => {
    const parsed = parseReportDefinition({
      source: 'stock_items',
      columns: ['item', 'on_hand'],
      filters: [{ field: 'below_reorder', op: 'is_true' }],
      groupBy: [],
      totals: [{ field: 'on_hand', fn: 'sum' }],
      sort: [{ field: 'item', direction: 'asc' }],
      chart: 'bar',
    });
    expect(parsed.columns).toEqual(['item', 'on_hand']);
    expect(parsed.totals[0]?.fn).toBe('sum');
  });
});
