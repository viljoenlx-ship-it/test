import { describe, expect, it } from 'vitest';
import { renderCsv, renderPdf, renderXlsx } from '../src/export-file';
import type { ReportTable } from '../src/run';

const table: ReportTable = {
  summary: 'Stock Items, showing total Stock Value',
  columns: [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'value', label: 'Stock Value', type: 'money' },
  ],
  rows: [
    [
      { text: 'Portland cement', chart: null },
      { text: 'R1 234.56', chart: 1234.56 },
    ],
  ],
  footer: [{ key: 'value', label: 'Total Stock Value', text: 'R1 234.56', chart: 1234.56 }],
  totalRows: 1,
  hidden: [],
  joins: [],
  generatedOn: '19 Nov 2026',
};

const brand = {
  companyName: 'Aubergine Atlas',
  city: 'Cape Town',
  vatNumber: '4999999991',
  primary: '#314056',
  logo: null,
};

function pdfText(body: Buffer): string {
  const parts: string[] = [];
  for (const match of body.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>/g)) {
    parts.push(Buffer.from(match[1] ?? '', 'hex').toString('latin1'));
  }
  return parts.join('');
}

describe('report exports', () => {
  it('writes CSV with a South African amount', () => {
    const file = renderCsv('Stock On Hand', table);
    const text = file.body.toString('utf8');
    expect(file.filename).toBe('stock-on-hand.csv');
    expect(file.body[0]).toBe(0xef);
    expect(text).toContain('Item,Stock Value');
    expect(text).toContain('R1 234.56');
    expect(text).toContain('19 Nov 2026');
  });

  it('writes an xlsx workbook', () => {
    const file = renderXlsx('Stock On Hand', table);
    expect(file.filename.endsWith('.xlsx')).toBe(true);
    expect(file.body.subarray(0, 2).toString()).toBe('PK');
    expect(file.body.toString('utf8')).toContain('Portland cement');
    expect(file.body.toString('utf8')).toContain('R1 234.56');
  });

  it('writes a branded PDF', async () => {
    const file = await renderPdf('Stock On Hand', table, brand);
    expect(file.contentType).toBe('application/pdf');
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(file.body);
    expect(text).toContain('Aubergine Atlas');
    expect(text).toContain('R1 234.56');
    expect(text).toContain('VAT 4999999991');
  });
});
