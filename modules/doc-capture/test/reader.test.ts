import { afterEach, describe, expect, it } from 'vitest';
import { demoDocument } from '../src/demo-reader';
import { countPages, sniffDocument } from '../src/files';
import { headerConfidence, isLowConfidence, parseReaderOutput } from '../src/reader';
import { resolveReader } from '../src/providers';
import { checkTotals, decimalCents } from '../src/totals';

const valid = {
  documentType: 'tax_invoice',
  supplierName: { value: 'Silver Mango Packaging (Pty) Ltd', confidence: 0.9 },
  supplierVatNumber: { value: '4991001002', confidence: 0.9 },
  documentNumber: { value: 'SM-1', confidence: 0.9 },
  documentDate: { value: '2026-03-04', confidence: 0.9 },
  dueDate: { value: '', confidence: 0.4 },
  currency: { value: 'zar', confidence: 0.9 },
  lines: [
    {
      description: { value: 'Chipboard screw 4 x 50 mm', confidence: 0.9 },
      supplierCode: { value: 'SM-SCR', confidence: 0.5 },
      quantity: { value: '2', confidence: 0.9 },
      unit: { value: 'each', confidence: 0.9 },
      unitPriceExcl: { value: '10.50', confidence: 0.9 },
      vat: { value: '3.15', confidence: 0.9 },
      lineTotal: { value: '21.00', confidence: 0.9 },
    },
  ],
  subtotal: { value: '21.00', confidence: 0.9 },
  vat: { value: '3.15', confidence: 0.9 },
  total: { value: '24.15', confidence: 0.9 },
  pageCount: 1,
};

describe('reader output', () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['DOCUMENT_READER_PROVIDER', 'OPENAI_API_KEY']) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('accepts structured fields and normalises currency and an empty due date', () => {
    const parsed = parseReaderOutput(valid);
    expect(parsed.currency.value).toBe('ZAR');
    expect(parsed.dueDate.value).toBeNull();
    expect(parsed.lines[0]?.unitPriceExcl.value).toBe('10.50');
    expect(isLowConfidence(headerConfidence(parsed).dueDate)).toBe(true);
    expect(isLowConfidence(parsed.lines[0]?.supplierCode.confidence)).toBe(true);
  });

  it('rejects money that is not a decimal string and confidence outside 0 to 1', () => {
    expect(() =>
      parseReaderOutput({
        ...valid,
        total: { value: 24.15, confidence: 0.9 },
      }),
    ).toThrow(/text/i);
    expect(() =>
      parseReaderOutput({
        ...valid,
        total: { value: '24.15', confidence: 1.2 },
      }),
    ).toThrow(/confidence/i);
    expect(() =>
      parseReaderOutput({
        ...valid,
        subtotal: { value: '24.159', confidence: 0.9 },
      }),
    ).toThrow(/money/i);
  });

  it('falls back to the included reader when premium has no key', () => {
    saved.DOCUMENT_READER_PROVIDER = process.env.DOCUMENT_READER_PROVIDER;
    saved.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    delete process.env.DOCUMENT_READER_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    expect(resolveReader('premium')).toMatchObject({
      kind: 'standard',
      fellBack: true,
      reader: { name: 'standard' },
    });
    expect(resolveReader('standard')).toMatchObject({ kind: 'standard', fellBack: false });
    process.env.OPENAI_API_KEY = 'test-key';
    expect(resolveReader('premium').kind).toBe('premium');
    expect(resolveReader('premium').reader.name).toBe('openai');
  });

  it('returns a fictional invoice whose totals agree', () => {
    const document = demoDocument('silver-mango-invoice.png');
    expect(document.supplierVatNumber.value).toBe('4991001002');
    expect(document.documentNumber.value).toBe('SM-1044');
    const totals = checkTotals({
      lineTotalsCents: document.lines.map((line) => decimalCents(line.lineTotal.value)),
      subtotalCents: decimalCents(document.subtotal.value),
      vatCents: decimalCents(document.vat.value),
      totalCents: decimalCents(document.total.value),
    });
    expect(totals.warnings).toEqual([]);
    const mismatch = demoDocument('mismatch-invoice.png');
    const bad = checkTotals({
      lineTotalsCents: mismatch.lines.map((line) => decimalCents(line.lineTotal.value)),
      subtotalCents: decimalCents(mismatch.subtotal.value),
      vatCents: decimalCents(mismatch.vat.value),
      totalCents: decimalCents(mismatch.total.value),
    });
    expect(bad.warnings.length).toBeGreaterThan(0);
  });

  it('sniffs allowed file types and counts PDF pages', () => {
    expect(sniffDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])).contentType).toBe(
      'image/png',
    );
    expect(sniffDocument(Buffer.from([0xff, 0xd8, 0xff, 0x00])).contentType).toBe('image/jpeg');
    const heic = Buffer.alloc(16);
    heic.write('ftyp', 4, 'ascii');
    heic.write('heic', 8, 'ascii');
    expect(sniffDocument(heic).contentType).toBe('image/heic');
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Type /Page >> endobj\n%%EOF',
    );
    expect(sniffDocument(pdf).contentType).toBe('application/pdf');
    expect(countPages(pdf, 'application/pdf')).toBe(2);
    expect(() => sniffDocument(Buffer.from('hello'))).toThrow(/JPG, PNG, HEIC, or PDF/);
  });
});
