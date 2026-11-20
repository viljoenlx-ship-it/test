import type { DocumentReader, Field, ReaderDocument, ReaderLine } from './reader';

function field<T>(value: T, confidence = 0.96): Field<T> {
  return { value, confidence };
}

function line(
  description: string,
  supplierCode: string,
  quantity: string,
  unit: string,
  unitPriceExcl: string,
  vat: string,
  lineTotal: string,
  codeConfidence = 0.96,
): ReaderLine {
  return {
    description: field(description),
    supplierCode: field(supplierCode, codeConfidence),
    quantity: field(quantity),
    unit: field(unit),
    unitPriceExcl: field(unitPriceExcl),
    vat: field(vat),
    lineTotal: field(lineTotal),
  };
}

/**
 * Fixed fictional documents. The result depends only on the file name, so CI
 * and the preview do not need a reader key. Nothing here is a real supplier.
 */
export function demoDocument(filename: string): ReaderDocument {
  const name = filename.toLowerCase();
  if (name.includes('mismatch')) {
    return {
      documentType: 'tax_invoice',
      supplierName: field('Silver Mango Packaging (Pty) Ltd'),
      supplierVatNumber: field('4991001002'),
      documentNumber: field('SM-MISMATCH'),
      documentDate: field('2026-03-12'),
      dueDate: field('2026-04-11', 0.4),
      currency: field('ZAR'),
      lines: [
        line('Chipboard screw 4 x 50 mm', 'SM-SCR', '10', 'each', '10.00', '15.00', '100.00'),
      ],
      subtotal: field('80.00'),
      vat: field('10.00'),
      total: field('70.00'),
      pageCount: 1,
    };
  }
  if (name.includes('nomatch')) {
    return {
      documentType: 'delivery_note',
      supplierName: field('Fictional Quarry Co'),
      supplierVatNumber: field('4111111111'),
      documentNumber: field('FQ-200'),
      documentDate: field('2026-03-02'),
      dueDate: field(null, 0.5),
      currency: field('ZAR'),
      lines: [line('Unlisted river stone', 'FQ-STONE', '3', 'bag', '12.00', '5.40', '36.00')],
      subtotal: field('36.00'),
      vat: field('5.40'),
      total: field('41.40'),
      pageCount: 1,
    };
  }
  if (name.includes('delivery')) {
    return {
      documentType: 'delivery_note',
      supplierName: field('Silver Mango Packaging (Pty) Ltd'),
      supplierVatNumber: field('4991001002', 0.9),
      documentNumber: field('SM-DN-18'),
      documentDate: field('2026-03-18'),
      dueDate: field(null, 0.42),
      currency: field('ZAR'),
      lines: [line('Chipboard screw 4 x 50 mm', 'SM-SCR', '20', 'each', '0.85', '2.55', '17.00')],
      subtotal: field('17.00'),
      vat: field('2.55'),
      total: field('19.55'),
      pageCount: 1,
    };
  }
  return {
    documentType: 'tax_invoice',
    supplierName: field('Silver Mango Packaging (Pty) Ltd'),
    supplierVatNumber: field('4991001002'),
    documentNumber: field('SM-1044'),
    documentDate: field('2026-03-04'),
    dueDate: field('2026-04-03', 0.44),
    currency: field('ZAR'),
    lines: [
      line('Chipboard screw 4 x 50 mm', 'SM-SCR', '100', 'each', '0.85', '12.75', '85.00'),
      line('Portland cement 42.5 N, 50 kg', 'SM-CEM', '4', 'bag', '98.00', '58.80', '392.00'),
      line('Clear silicone sealant', 'SM-SIL', '6', 'tube', '45.00', '40.50', '270.00', 0.51),
    ],
    subtotal: field('747.00'),
    vat: field('112.05'),
    total: field('859.05'),
    pageCount: 1,
  };
}

export const demoReader: DocumentReader = {
  name: 'demo',
  read({ filename }) {
    return Promise.resolve(demoDocument(filename));
  },
};
