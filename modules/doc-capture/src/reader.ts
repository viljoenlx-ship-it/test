import { zarFromDecimal } from '@omnivate/shared';
import { DocumentError } from './errors';

export const LOW_CONFIDENCE = 0.75;

export type Field<T> = {
  value: T;
  confidence: number;
};

export type ReaderLine = {
  description: Field<string>;
  supplierCode: Field<string>;
  quantity: Field<string>;
  unit: Field<string>;
  unitPriceExcl: Field<string>;
  vat: Field<string>;
  lineTotal: Field<string>;
};

export type ReaderDocument = {
  documentType: 'tax_invoice' | 'delivery_note';
  supplierName: Field<string>;
  supplierVatNumber: Field<string>;
  documentNumber: Field<string>;
  documentDate: Field<string>;
  dueDate: Field<string | null>;
  currency: Field<string>;
  lines: ReaderLine[];
  subtotal: Field<string>;
  vat: Field<string>;
  total: Field<string>;
  pageCount: number;
};

export type DocumentReader = {
  readonly name: 'demo' | 'openai' | 'standard';
  read(input: { bytes: Buffer; contentType: string; filename: string }): Promise<ReaderDocument>;
};

export function isLowConfidence(value: number | undefined): boolean {
  return value === undefined || !Number.isFinite(value) || value < LOW_CONFIDENCE;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocumentError(`${label} was not an object.`);
  }
  return value as Record<string, unknown>;
}

function confidenceOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DocumentError('A confidence value was outside 0 to 1.');
  }
  return value;
}

function textField(value: unknown, label: string, max: number): Field<string> {
  const record = asRecord(value, label);
  if (typeof record.value !== 'string') {
    throw new DocumentError(`${label} was not text.`);
  }
  const text = record.value.trim().replace(/\s+/g, ' ');
  if (text.length > max) {
    throw new DocumentError(`${label} is too long.`);
  }
  return { value: text, confidence: confidenceOf(record.confidence) };
}

function moneyField(value: unknown, label: string): Field<string> {
  const field = textField(value, label, 20);
  try {
    zarFromDecimal(field.value);
  } catch {
    throw new DocumentError(`${label} was not a money amount.`);
  }
  return field;
}

function dateField(value: unknown, label: string, allowEmpty: boolean): Field<string | null> {
  const record = asRecord(value, label);
  const raw = record.value;
  const confidence = confidenceOf(record.confidence);
  if (raw === null || raw === '') {
    if (!allowEmpty) {
      throw new DocumentError(`${label} is missing.`);
    }
    return { value: null, confidence };
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new DocumentError(`${label} was not a date.`);
  }
  return { value: raw, confidence };
}

function quantityField(value: unknown): Field<string> {
  const field = textField(value, 'Quantity', 20);
  if (!/^(\d+)(\.\d{1,4})?$/.test(field.value) || Number(field.value) <= 0) {
    throw new DocumentError('A quantity was not a positive amount.');
  }
  return field;
}

/** Validates reader JSON. Rejects floats for money and confidence outside 0 to 1. */
export function parseReaderOutput(input: unknown): ReaderDocument {
  const body = asRecord(input, 'Reader output');
  const documentType = body.documentType;
  if (documentType !== 'tax_invoice' && documentType !== 'delivery_note') {
    throw new DocumentError('Document type was not a tax invoice or a delivery note.');
  }
  if (!Array.isArray(body.lines) || body.lines.length > 200) {
    throw new DocumentError('Lines were not a list.');
  }
  const pageCount = body.pageCount;
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1 || (pageCount as number) > 200) {
    throw new DocumentError('Page count was not a positive whole number.');
  }
  const currency = textField(body.currency, 'Currency', 3);
  if (!/^[A-Za-z]{3}$/.test(currency.value)) {
    throw new DocumentError('Currency was not a 3-letter code.');
  }
  const lines = body.lines.map((line) => {
    const row = asRecord(line, 'Line');
    return {
      description: textField(row.description, 'Description', 200),
      supplierCode: textField(row.supplierCode, 'Supplier code', 40),
      quantity: quantityField(row.quantity),
      unit: textField(row.unit, 'Unit', 40),
      unitPriceExcl: moneyField(row.unitPriceExcl, 'Unit price'),
      vat: moneyField(row.vat, 'VAT'),
      lineTotal: moneyField(row.lineTotal, 'Line total'),
    };
  });
  const due = dateField(body.dueDate, 'Due date', true);
  return {
    documentType,
    supplierName: textField(body.supplierName, 'Supplier name', 160),
    supplierVatNumber: textField(body.supplierVatNumber, 'VAT number', 20),
    documentNumber: textField(body.documentNumber, 'Document number', 40),
    documentDate: dateField(body.documentDate, 'Document date', false) as Field<string>,
    dueDate: due,
    currency: { value: currency.value.toUpperCase(), confidence: currency.confidence },
    lines,
    subtotal: moneyField(body.subtotal, 'Subtotal'),
    vat: moneyField(body.vat, 'VAT'),
    total: moneyField(body.total, 'Total'),
    pageCount: pageCount as number,
  };
}

export function headerConfidence(document: ReaderDocument): Record<string, number> {
  return {
    documentType: 1,
    supplierName: document.supplierName.confidence,
    supplierVat: document.supplierVatNumber.confidence,
    documentNumber: document.documentNumber.confidence,
    documentDate: document.documentDate.confidence,
    dueDate: document.dueDate.confidence,
    currency: document.currency.confidence,
    subtotal: document.subtotal.confidence,
    vat: document.vat.confidence,
    total: document.total.confidence,
  };
}

export function lineConfidence(line: ReaderLine): Record<string, number> {
  return {
    description: line.description.confidence,
    supplierCode: line.supplierCode.confidence,
    quantity: line.quantity.confidence,
    unit: line.unit.confidence,
    unitPrice: line.unitPriceExcl.confidence,
    vat: line.vat.confidence,
    lineTotal: line.lineTotal.confidence,
  };
}
