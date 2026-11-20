import { describe, expect, it } from 'vitest';
import { compileReport, getReportSource } from '@omnivate/module-ana-03';
import { READY_MADE_REPORTS } from '@omnivate/shared';
import '../src/sources';

describe('FIN-02 report sources', () => {
  it('compiles invoices, payments, and the aged debtors report', () => {
    expect(getReportSource('customer_invoices')?.label).toBe('Customer Invoices');
    expect(getReportSource('customer_payments')?.label).toBe('Customer Payments');
    const source = getReportSource('aged_debtors');
    const ready = READY_MADE_REPORTS.find((report) => report.readyKey === 'aged_debtors');
    expect(source).toBeTruthy();
    expect(ready).toBeTruthy();
    if (!source || !ready) {
      return;
    }
    const compiled = compileReport(source, ready.definition, {
      now: new Date('2026-11-19T10:00:00.000Z'),
      limit: 50,
      offset: 0,
    });
    expect(compiled.columns.map((column) => column.key)).toEqual([
      'customer',
      'current',
      'days_30',
      'days_60',
      'days_90',
      'balance',
    ]);
  });
});
