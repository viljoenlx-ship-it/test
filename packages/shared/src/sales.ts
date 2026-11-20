/**
 * SAL-01 quotes and FIN-02 tax invoices share one line calculation.
 * Money is integer cents. Quantity is an exact count of ten-thousandths
 * (1.5 is 15000) so VAT never depends on a float.
 */

import { money, vatOn, type Money } from './money';

export const SALES_QUANTITY_SCALE = 10_000n;

export const SALES_DOCUMENT_PREFIX = {
  quote: 'QUO',
  invoice: 'INV',
  credit_note: 'CRN',
} as const;

export type SalesDocumentKind = keyof typeof SALES_DOCUMENT_PREFIX;

export const PAYMENT_METHODS = ['eft', 'cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  eft: 'EFT',
  cash: 'Cash',
  card: 'Card',
};

const QUOTE_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
} as const;

export type QuoteStatusLabel = (typeof QUOTE_LABELS)[keyof typeof QUOTE_LABELS];

export type InvoiceStatusLabel = 'Unpaid' | 'Partly Paid' | 'Paid' | 'Overdue';

export type AgingBucket = 'current' | 'days_30' | 'days_60' | 'days_90';

export type SalesLineAmounts = {
  extendedCents: bigint;
  discountCents: bigint;
  netCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
};

function fail(message: string): never {
  throw new Error(message);
}

/** Half a cent rounds away from zero, the same rule as vatOn. */
export function roundHalfAway(numerator: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    fail('Cannot round by zero.');
  }
  const half = divisor / 2n;
  return numerator >= 0n ? (numerator + half) / divisor : (numerator - half) / divisor;
}

export function johannesburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function johannesburgYear(now = new Date()): number {
  return Number(johannesburgToday(now).slice(0, 4));
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !Number.isInteger(days)) {
    fail('Use a calendar date and a whole number of days.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    fail('Use calendar dates.');
  }
  return Math.round((to - from) / 86_400_000);
}

/** "1", "1.5", and "1.5000" become scaled units. Zero and floats are rejected. */
export function parseSalesQuantity(input: string): bigint {
  if (typeof input !== 'string') {
    fail('Enter a quantity with up to four decimal places.');
  }
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(input.trim());
  if (!match) {
    fail('Enter a quantity with up to four decimal places.');
  }
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(4, '0');
  const scaled = whole * SALES_QUANTITY_SCALE + BigInt(fraction);
  if (scaled <= 0n || scaled > 1_000_000n * SALES_QUANTITY_SCALE) {
    fail('Enter a quantity above zero.');
  }
  return scaled;
}

export function formatSalesQuantity(scaled: bigint): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / SALES_QUANTITY_SCALE;
  const fraction = (absolute % SALES_QUANTITY_SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  const text = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function centsToDecimal(amountCents: bigint): string {
  const negative = amountCents < 0n;
  const absolute = negative ? -amountCents : amountCents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/**
 * Line discount is removed before VAT. VAT uses the tenant rate in basis points
 * (15% is 1500) and rounds half a cent away from zero.
 */
export function salesLineAmounts(input: {
  quantity: bigint;
  unitPriceCents: bigint;
  discountCents: bigint;
  vatBasisPoints: number;
}): SalesLineAmounts {
  if (input.unitPriceCents < 0n) {
    fail('Unit price cannot be negative.');
  }
  if (input.discountCents < 0n) {
    fail('Discount cannot be negative.');
  }
  const extended = roundHalfAway(input.quantity * input.unitPriceCents, SALES_QUANTITY_SCALE);
  if (input.discountCents > extended) {
    fail('Discount cannot be more than the line.');
  }
  const net = extended - input.discountCents;
  const vat = vatOn(money(net), input.vatBasisPoints).amountCents;
  return {
    extendedCents: extended,
    discountCents: input.discountCents,
    netCents: net,
    vatCents: vat,
    totalCents: net + vat,
  };
}

export function sumSalesLines(lines: readonly SalesLineAmounts[]): SalesLineAmounts {
  return lines.reduce<SalesLineAmounts>(
    (total, line) => ({
      extendedCents: total.extendedCents + line.extendedCents,
      discountCents: total.discountCents + line.discountCents,
      netCents: total.netCents + line.netCents,
      vatCents: total.vatCents + line.vatCents,
      totalCents: total.totalCents + line.totalCents,
    }),
    {
      extendedCents: 0n,
      discountCents: 0n,
      netCents: 0n,
      vatCents: 0n,
      totalCents: 0n,
    },
  );
}

/**
 * Discount that belongs to a credited quantity.
 * The last slice of a line takes whatever discount is still left, so a full
 * credit matches the invoice line exactly.
 */
export function creditDiscountCents(input: {
  originalQuantity: bigint;
  originalDiscountCents: bigint;
  alreadyCreditedQuantity: bigint;
  alreadyCreditedDiscountCents: bigint;
  quantity: bigint;
}): bigint {
  const remainingQty = input.originalQuantity - input.alreadyCreditedQuantity;
  if (input.quantity <= 0n || input.quantity > remainingQty) {
    fail('Credit quantity is more than the quantity left on the invoice.');
  }
  const remainingDiscount = input.originalDiscountCents - input.alreadyCreditedDiscountCents;
  if (input.quantity === remainingQty) {
    return remainingDiscount < 0n ? 0n : remainingDiscount;
  }
  const share = roundHalfAway(input.originalDiscountCents * input.quantity, input.originalQuantity);
  return share > remainingDiscount ? remainingDiscount : share;
}

export function documentNumber(kind: SalesDocumentKind, year: number, sequence: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1) {
    fail('A document number needs a year and a sequence.');
  }
  return `${SALES_DOCUMENT_PREFIX[kind]}-${year.toString()}-${sequence.toString().padStart(5, '0')}`;
}

export function quoteStatusLabel(
  status: string,
  validUntil: string | null,
  today: string,
): QuoteStatusLabel {
  if (status === 'sent' && validUntil && validUntil < today) {
    return 'Expired';
  }
  if (status === 'draft' || status === 'sent' || status === 'accepted' || status === 'declined') {
    return QUOTE_LABELS[status];
  }
  return 'Draft';
}

export function invoiceStatusLabel(input: {
  totalCents: bigint;
  balanceCents: bigint;
  allocatedCents: bigint;
  dueOn: string;
  today: string;
}): InvoiceStatusLabel {
  if (input.balanceCents <= 0n) {
    return 'Paid';
  }
  if (input.dueOn < input.today) {
    return 'Overdue';
  }
  if (input.allocatedCents > 0n && input.balanceCents < input.totalCents) {
    return 'Partly Paid';
  }
  return 'Unpaid';
}

/** Age is counted from the invoice date. 0–30, 31–60, 61–90, then 90 and over. */
export function agingBucket(ageDays: number): AgingBucket {
  if (ageDays <= 30) {
    return 'current';
  }
  if (ageDays <= 60) {
    return 'days_30';
  }
  if (ageDays <= 90) {
    return 'days_60';
  }
  return 'days_90';
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function salesMoney(cents: bigint): Money {
  return money(cents);
}
