import { zarFromDecimal } from '@omnivate/shared';
import type { Field, ReaderDocument, ReaderLine } from '../reader';

/**
 * Confidence stays under the review highlight line (0.75) on purpose.
 * A rule-based read should be checked, not trusted.
 */
const READ = 0.66;
const GUESSED = 0.42;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function field<T>(value: T, confidence = READ): Field<T> {
  return { value, confidence };
}

function money(value: string): string {
  const cleaned = value.replace(/[Rr\s]/g, '').replace(',', '.');
  const parsed = zarFromDecimal(cleaned.includes('.') ? cleaned : `${cleaned}.00`);
  const cents = parsed.amountCents;
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function isoDate(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function interpretDate(raw: string): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    return isoDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  }
  const named = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (named) {
    const month = MONTHS[named[2]?.toLowerCase() ?? ''];
    if (month) {
      return isoDate(Number(named[1]), month, Number(named[3]));
    }
  }
  const slash = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(text);
  if (slash) {
    return isoDate(Number(slash[1]), Number(slash[2]), Number(slash[3]));
  }
  return null;
}

function labeledDate(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (!match?.[1]) {
    return null;
  }
  return interpretDate(match[1]);
}

/** A South African VAT number is 10 digits and starts with 4. Spaces are ignored. */
export function findVatNumber(text: string): string {
  const compact = text.replace(/(\d)\s+(?=\d)/g, '$1');
  return /\b(4\d{9})\b/.exec(compact)?.[1] ?? '';
}

function findDocumentNumber(text: string): string {
  const pattern =
    /(?:invoice|document|delivery\s+note|inv)\.?\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9][A-Z0-9/-]{1,24})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const token = match[1] ?? '';
    if (!/\d/.test(token) || /^4\d{9}$/.test(token)) {
      continue;
    }
    return token;
  }
  return '';
}

function findSupplierName(text: string, vat: string): string {
  const rows = text
    .split(/\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  const company = rows.find((row) => /\((pty|cc)\)|\bltd\b|\bcc\b/i.test(row));
  if (company) {
    return company.replace(/\s+/g, ' ').slice(0, 160);
  }
  const vatRow = rows.findIndex((row) => row.replace(/\s/g, '').includes(vat) && vat.length > 0);
  if (vatRow > 0) {
    return rows[vatRow - 1]?.replace(/\s+/g, ' ').slice(0, 160) ?? '';
  }
  return rows.find((row) => !/tax invoice|delivery note|vat|date|invoice/i.test(row)) ?? '';
}

function moneyTokens(row: string): { value: string; start: number }[] {
  const found: { value: string; start: number }[] = [];
  const pattern = /(?:R\s*)?(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)([.,]\d{2})?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(row))) {
    const whole = (match[1] ?? '').replace(/[ \u00a0]/g, '');
    const fraction = match[2] ?? '';
    found.push({ value: `${whole}${fraction}`, start: match.index });
  }
  return found;
}

function lineVat(total: string): string {
  const cents = zarFromDecimal(total).amountCents;
  const vat = (cents * 1500n + 5000n) / 10000n;
  return money((Number(vat) / 100).toFixed(2));
}

function hasCents(value: string): boolean {
  return /[.,]\d{2}$/.test(value);
}

function splitLine(row: string): ReaderLine | null {
  if (/sub\s*total|^vat\b|^total\b|tax invoice|delivery note|\bdate\b/i.test(row)) {
    return null;
  }
  const tokens = moneyTokens(row);
  if (tokens.length < 2) {
    return null;
  }
  const tail = tokens.slice(-3);
  const last = tail[tail.length - 1];
  const mid = tail.length >= 2 ? tail[tail.length - 2] : undefined;
  const qtyToken = tail.length >= 3 ? tail[0] : undefined;
  if (!last || !mid || !hasCents(last.value) || !hasCents(mid.value)) {
    return null;
  }
  const total = money(last.value);
  const unitPrice = money(mid.value);
  const quantity = qtyToken ? qtyToken.value.replace(/[.,]00$/, '') : '1';
  const descEnd = (qtyToken ?? mid).start;
  let description = row.slice(0, descEnd).replace(/\s+/g, ' ').trim();
  const code = /\b([A-Z]{1,5}-[A-Z0-9]{2,})\b/.exec(description);
  const supplierCode = code?.[1] ?? '';
  if (code?.[0]) {
    description = description.replace(code[0], '').replace(/\s+/g, ' ').trim();
  }
  if (description.length < 2) {
    return null;
  }
  const unitMatch = /\b(each|bag|bags|kg|box|boxes|tube|tubes|metre|metres|m|tin|tins)\b/i.exec(
    description,
  );
  const agrees = quantityTimesPrice(quantity, unitPrice, total);
  return {
    description: field(description, agrees ? READ : GUESSED),
    supplierCode: field(supplierCode, supplierCode ? READ : GUESSED),
    quantity: field(quantity, agrees ? READ : GUESSED),
    unit: field(unitMatch?.[1]?.toLowerCase() ?? 'each', unitMatch ? READ : GUESSED),
    unitPriceExcl: field(unitPrice, agrees ? READ : GUESSED),
    vat: field(lineVat(total), GUESSED),
    lineTotal: field(total, agrees ? READ : GUESSED),
  };
}

function quantityTimesPrice(quantity: string, price: string, total: string): boolean {
  try {
    const qty = Number(quantity);
    const left = zarFromDecimal(price).amountCents * BigInt(Math.round(qty * 10000));
    const expected = left / 10000n;
    const actual = zarFromDecimal(total).amountCents;
    const gap = expected > actual ? expected - actual : actual - expected;
    return gap <= 1n;
  } catch {
    return false;
  }
}

function labeledMoney(text: string, label: RegExp): string | null {
  const flags = label.flags.includes('g') ? label.flags : `${label.flags}g`;
  const pattern = new RegExp(label.source, flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const token = (match[1] ?? '').trim();
    if (/^4\d{9}$/.test(token.replace(/\s/g, ''))) {
      continue;
    }
    try {
      return money(token);
    } catch {
      continue;
    }
  }
  return null;
}

/** Turns invoice text into reader fields. Amounts that are missing are estimated at 15% VAT. */
export function parseInvoiceText(text: string, pageCount = 1): ReaderDocument {
  const vat = findVatNumber(text);
  const number = findDocumentNumber(text);
  const supplier = findSupplierName(text, vat);
  const documentDate =
    labeledDate(text, /(?:invoice\s+date|document\s+date|(?<!due\s)date)\s*[:-]?\s*([^\n]+)/i) ??
    interpretDate(text);
  if (!documentDate) {
    throw new Error('reader_status_no_date');
  }
  const due =
    labeledDate(text, /due\s+date\s*[:-]?\s*([^\n]+)/i) ??
    labeledDate(text, /payment\s+due\s*[:-]?\s*([^\n]+)/i);
  const rows = text.split(/\n/);
  const lines = rows.map(splitLine).filter((line): line is ReaderLine => line !== null);
  const subtotalRead = labeledMoney(
    text,
    /sub[ \t]*total[ \t]*[:-]?[ \t]*(?:R[ \t]*)?(\d[\d \t]*[.,]\d{2})/i,
  );
  const vatRead = labeledMoney(
    text,
    /\bvat(?:[ \t]*@?[ \t]*15[ \t]*%)?[ \t]*[:-]?[ \t]*(?:R[ \t]*)?(\d[\d \t]*[.,]\d{2})/i,
  );
  const totalRead = labeledMoney(
    text,
    /(?:^|\n)[ \t]*(?:grand[ \t]+)?total\b[ \t]*[:-]?[ \t]*(?:R[ \t]*)?(\d[\d \t]*[.,]\d{2})/i,
  );
  const lineSum = lines.reduce(
    (sum, line) => sum + zarFromDecimal(line.lineTotal.value).amountCents,
    0n,
  );
  const subtotal = subtotalRead ?? money((Number(lineSum) / 100).toFixed(2));
  const vatAmount = vatRead ?? lineVat(subtotal);
  const total =
    totalRead ??
    money(
      (
        Number(zarFromDecimal(subtotal).amountCents + zarFromDecimal(vatAmount).amountCents) / 100
      ).toFixed(2),
    );
  const delivery = /delivery\s+note/i.test(text);
  return {
    documentType: delivery ? 'delivery_note' : 'tax_invoice',
    supplierName: field(supplier || 'Unknown supplier', supplier ? READ : GUESSED),
    supplierVatNumber: field(vat, vat ? READ : GUESSED),
    documentNumber: field(number || 'UNKNOWN', number ? READ : GUESSED),
    documentDate: field(documentDate, READ),
    dueDate: field(due, due ? READ : GUESSED),
    currency: field(
      /ZAR|\bR\s?\d/.test(text) ? 'ZAR' : 'ZAR',
      /ZAR|\bR\s?\d/.test(text) ? READ : GUESSED,
    ),
    lines,
    subtotal: field(subtotal, subtotalRead ? READ : GUESSED),
    vat: field(vatAmount, vatRead ? READ : GUESSED),
    total: field(total, totalRead ? READ : GUESSED),
    pageCount: Math.max(1, pageCount),
  };
}
