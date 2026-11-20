import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { compileReport } from '../src/compile';
import { formulaToSql } from '../src/formula-sql';
import { getReportSource } from '../src/registry';
import '../src/sources';
import type { ReportDefinition } from '@omnivate/shared';

const dialect = new PgDialect();
const now = new Date('2026-11-19T08:00:00.000Z');

function sqlOf(definition: ReportDefinition) {
  const source = getReportSource(definition.source);
  if (!source) {
    throw new Error(`Missing source ${definition.source}`);
  }
  const compiled = compileReport(source, definition, { now, limit: 50, offset: 0 });
  return {
    page: dialect.sqlToQuery(compiled.page),
    totals: dialect.sqlToQuery(compiled.totals),
    columns: compiled.columns,
  };
}

describe('report query builder', () => {
  it('groups stock receipts and keeps the filter value out of the SQL text', () => {
    const nasty = "Silver Mango'; DROP TABLE tenants";
    const query = sqlOf({
      source: 'stock_receipts',
      columns: ['item'],
      filters: [
        { field: 'supplier', op: 'contains', value: nasty },
        { field: 'received', op: 'this_month' },
      ],
      groupBy: ['item'],
      totals: [
        { field: 'quantity', fn: 'sum' },
        { field: 'value', fn: 'sum' },
      ],
      sort: [{ field: 'value', direction: 'desc' }],
      chart: 'bar',
    });

    expect(query.page.sql).toContain('GROUP BY');
    expect(query.page.sql).toContain('SUM(');
    expect(query.page.sql).not.toContain('DROP');
    expect(query.page.sql).not.toContain('Silver');
    expect(query.page.params).toContain(`%${nasty}%`);
    expect(query.page.params).toContain('2026-11-01');
    expect(query.totals.sql).toContain('SUM(');
    expect(query.columns.map((column) => column.key)).toEqual(['item', 'quantity', 'value']);
  });

  it('refuses to total a text column', () => {
    expect(() =>
      sqlOf({
        source: 'stock_items',
        columns: ['item'],
        filters: [],
        groupBy: ['item'],
        totals: [{ field: 'item', fn: 'sum' }],
        sort: [],
        chart: 'none',
      }),
    ).toThrow(/cannot use that total/);
  });

  it('turns a calculated margin into SQL without eval', () => {
    const sqlText = formulaToSql('selling_price - cost', {
      selling_price: { sql: 'item.selling_price_cents', kind: 'money' },
      cost: { sql: 'item.cost_cents', kind: 'money' },
    });
    expect(sqlText?.kind).toBe('money');
    expect(sqlText?.sql).toContain('item.selling_price_cents');
    expect(sqlText?.sql).toContain('item.cost_cents');
    expect(sqlText?.sql).not.toContain('eval');
  });
});
