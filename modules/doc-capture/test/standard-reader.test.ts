import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReaderDocument } from '../src/reader';
import { LOW_CONFIDENCE } from '../src/reader';
import { parseInvoiceText } from '../src/standard/parse-invoice';
import { extractPdfText } from '../src/standard/pdf-text';
import { standardReader } from '../src/standard-reader';
import { INVOICE_TEXT, invoicePdf } from './invoice-fixture';

function confidences(document: ReaderDocument): number[] {
  const header = [
    document.supplierName,
    document.supplierVatNumber,
    document.documentNumber,
    document.documentDate,
    document.dueDate,
    document.currency,
    document.subtotal,
    document.vat,
    document.total,
  ];
  const lines = document.lines.flatMap((line) => [
    line.description,
    line.supplierCode,
    line.quantity,
    line.unit,
    line.unitPriceExcl,
    line.vat,
    line.lineTotal,
  ]);
  return [...header, ...lines].map((field) => field.confidence);
}

function expectInvoice(document: ReaderDocument) {
  expect(document.documentType).toBe('tax_invoice');
  expect(document.supplierName.value).toBe('North Quince Supplies (Pty) Ltd');
  expect(document.supplierVatNumber.value).toBe('4123456789');
  expect(document.documentNumber.value).toBe('NQ-2201');
  expect(document.documentDate.value).toBe('2026-03-04');
  expect(document.dueDate.value).toBe('2026-04-03');
  expect(document.lines).toHaveLength(2);
  expect(document.lines[0]).toMatchObject({
    description: { value: 'Brass hinge 75 mm' },
    quantity: { value: '12' },
    unitPriceExcl: { value: '18.50' },
    lineTotal: { value: '222.00' },
  });
  expect(document.lines[1]).toMatchObject({
    description: { value: 'Galvanised nail 50 mm' },
    quantity: { value: '8' },
    unitPriceExcl: { value: '6.25' },
    lineTotal: { value: '50.00' },
  });
  expect(document.subtotal.value).toBe('272.00');
  expect(document.vat.value).toBe('40.80');
  expect(document.total.value).toBe('312.80');
  for (const confidence of confidences(document)) {
    expect(confidence).toBeLessThan(LOW_CONFIDENCE);
  }
}

describe('standard invoice parser', () => {
  it('reads a clean fictional invoice', () => {
    expectInvoice(parseInvoiceText(INVOICE_TEXT));
  });

  it('reads the text layer of a PDF before any picture recognition', async () => {
    const pdf = invoicePdf();
    expect(extractPdfText(pdf)).toContain('North Quince Supplies (Pty) Ltd');
    expectInvoice(
      await standardReader.read({
        bytes: pdf,
        contentType: 'application/pdf',
        filename: 'north-quince.pdf',
      }),
    );
  });

  it('does not guess at a PDF that has no text layer', async () => {
    const empty = invoicePdf(['']);
    await expect(
      standardReader.read({
        bytes: empty,
        contentType: 'application/pdf',
        filename: 'scan.pdf',
      }),
    ).rejects.toThrow('reader_status_no_text');
  });

  it('reads a photographed fictional invoice', async () => {
    const bytes = await readFile(join(import.meta.dirname, 'fixtures/north-quince-photo.png'));
    const document = await standardReader.read({
      bytes,
      contentType: 'image/png',
      filename: 'north-quince.png',
    });
    expect(document.supplierVatNumber.value).toBe('4123456789');
    expect(document.documentNumber.value).toBe('NQ-2201');
    expect(document.documentDate.value).toBe('2026-03-04');
    expect(document.total.value).toBe('312.80');
    expect(document.lines.length).toBeGreaterThanOrEqual(1);
    for (const confidence of confidences(document)) {
      expect(confidence).toBeLessThan(LOW_CONFIDENCE);
    }
  }, 120_000);
});
