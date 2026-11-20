/**
 * South African spreadsheet values.
 * Money accepts an R sign, spaces as thousands separators, and a comma or a dot
 * as the decimal mark. Dates are day/month/year. Nothing here uses floating point.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const MONEY_MESSAGE = 'Use an amount such as 10.50, 10,50, or R 1 234,56.';

function fail<T>(message: string): Parsed<T> {
  return { ok: false, message };
}

/** Strip currency marks and spaces. Keeps a leading minus. */
function stripMoneyDecorations(raw: string): string | null {
  let text = raw
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!text) {
    return null;
  }
  let sign = '';
  if (text.startsWith('(') && text.endsWith(')')) {
    sign = '-';
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('-')) {
    sign = '-';
    text = text.slice(1).trim();
  }
  text = text.replace(/^zar/i, '').replace(/^r/i, '').replace(/\s+/g, '');
  if (!text || text === '-') {
    return null;
  }
  return sign + text;
}

/**
 * Turn a decorated amount into a plain "1234.56" string with at most two decimals.
 * A comma with one or two digits is the decimal mark. A dot with exactly three
 * digits, and no comma, is a thousands separator (1.234 means 1234).
 */
export function normaliseSaAmount(raw: string): string | null {
  const stripped = stripMoneyDecorations(raw);
  if (stripped === null) {
    return null;
  }
  const sign = stripped.startsWith('-') ? '-' : '';
  const text = sign ? stripped.slice(1) : stripped;
  if (!/^[\d.,]+$/.test(text)) {
    return null;
  }

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let whole = text;
  let fraction = '';

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const mark = text[decimalAt];
    whole = text.slice(0, decimalAt).replace(/[.,]/g, '');
    fraction = text.slice(decimalAt + 1);
    if (mark !== ',' && mark !== '.') {
      return null;
    }
  } else if (lastComma >= 0) {
    const parts = text.split(',');
    const tail = parts[parts.length - 1] ?? '';
    if (parts.length === 2 && tail.length > 0 && tail.length <= 2) {
      whole = parts[0] ?? '';
      fraction = tail;
    } else if (
      parts.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3))
    ) {
      whole = parts.join('');
    } else {
      return null;
    }
  } else if (lastDot >= 0) {
    const parts = text.split('.');
    const tail = parts[parts.length - 1] ?? '';
    if (parts.length === 2 && tail.length > 0 && tail.length <= 2) {
      whole = parts[0] ?? '';
      fraction = tail;
    } else if (
      parts.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3))
    ) {
      whole = parts.join('');
    } else {
      return null;
    }
  }

  if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d{1,2}$/.test(fraction))) {
    return null;
  }
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Integer cents. Rejects blanks as a failed parse; callers decide whether blank is allowed. */
export function parseSaMoney(raw: string): Parsed<bigint> {
  const normalised = normaliseSaAmount(raw);
  if (normalised === null) {
    return fail(MONEY_MESSAGE);
  }
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalised);
  if (!match) {
    return fail(MONEY_MESSAGE);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return { ok: true, value: sign * (whole * 100n + BigInt(fraction)) };
}

/**
 * Quantity in thousandths of the unit. At most three decimal places.
 * A comma is the decimal mark (1 000,5). A single dot is also a decimal mark,
 * so 1.234 is one and a bit, not one thousand. Grouped thousands use spaces,
 * which are removed before this runs, or a repeated separator (1.234.567).
 */
export function parseSaQuantity(raw: string): Parsed<bigint> {
  let text = raw
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, '');
  if (!text) {
    return fail('Use a number such as 10 or 1 000,5.');
  }
  if (text.startsWith('-') || text.startsWith('(')) {
    return fail('Opening quantity cannot be negative.');
  }
  text = text.replace(/^r/i, '');
  if (!/^[\d.,]+$/.test(text)) {
    return fail('Use a number such as 10 or 1 000,5.');
  }

  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  let whole = text;
  let fraction = '';

  if (commas > 0 && dots > 0) {
    const decimalAt = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    whole = text.slice(0, decimalAt).replace(/[.,]/g, '');
    fraction = text.slice(decimalAt + 1);
  } else if (commas > 1 || dots > 1) {
    const parts = text.split(commas > 1 ? ',' : '.');
    if (!parts.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3))) {
      return fail('Use a number such as 10 or 1 000,5.');
    }
    whole = parts.join('');
  } else if (commas === 1 || dots === 1) {
    const parts = text.split(commas === 1 ? ',' : '.');
    const tail = parts[1] ?? '';
    if (tail.length === 0) {
      return fail('Use a number such as 10 or 1 000,5.');
    }
    if (tail.length > 3) {
      return fail('Opening quantity can have at most 3 decimal places.');
    }
    whole = parts[0] ?? '';
    fraction = tail;
  }

  if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d{1,3}$/.test(fraction))) {
    return fail('Use a number such as 10 or 1 000,5.');
  }
  return { ok: true, value: BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0')) };
}

/** Day-first dates, plus ISO yyyy-mm-dd from our own templates. */
export function parseSaDate(raw: string): Parsed<string> {
  const text = raw.normalize('NFKC').trim();
  let day: number;
  let month: number;
  let year: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    day = Number(local[1]);
    month = Number(local[2]);
    year = Number(local[3]);
  } else {
    return fail('Use a date like 19/11/2026.');
  }
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) {
    return fail('Use a date like 19/11/2026.');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return fail('Use a date like 19/11/2026.');
  }
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return { ok: true, value: `${year}-${mm}-${dd}` };
}

export function formatSaDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function centsToDecimal(amount: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function milliToDecimal(milli: bigint): string {
  const negative = milli < 0n;
  const absolute = negative ? -milli : milli;
  const whole = absolute / 1000n;
  const fraction = (absolute % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** VAT-inclusive cents to exclusive cents. Half a cent rounds away from zero. */
export function exclusiveFromInclusive(grossCents: bigint, rateBasisPoints: number): bigint {
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error('VAT rate must be a non-negative integer number of basis points.');
  }
  const divisor = 10_000n + BigInt(rateBasisPoints);
  const numerator = grossCents * 10_000n;
  const half = divisor / 2n;
  return numerator >= 0n ? (numerator + half) / divisor : (numerator - half) / divisor;
}

/** Value of a quantity at a unit cost. quantity is thousandths, cost is cents. */
export function extendedCostCents(quantityMilli: bigint, unitCostCents: bigint): bigint {
  const numerator = quantityMilli * unitCostCents;
  const divisor = 1000n;
  const half = divisor / 2n;
  return numerator >= 0n ? (numerator + half) / divisor : (numerator - half) / divisor;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(raw: string): Parsed<string> {
  const email = raw.trim().toLowerCase();
  if (email.length > 200 || !EMAIL.test(email)) {
    return fail('Email does not look valid.');
  }
  return { ok: true, value: email };
}

export function parseVatNumber(raw: string): Parsed<string> {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(digits)) {
    return fail('VAT number should be 10 digits.');
  }
  return { ok: true, value: digits };
}
