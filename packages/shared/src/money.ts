/**
 * Money is an exact integer count of cents. Floating point is rejected so
 * VAT and ledger totals cannot drift. The foundation currency is ZAR.
 * Multi-currency (CFG-04) can add codes later; it must not introduce floats.
 */

declare const centsBrand: unique symbol;

export const ZAR = 'ZAR' as const;
export type CurrencyCode = typeof ZAR;

/** Whole South African cents. R1.00 is 100n. */
export type Cents = bigint & { readonly [centsBrand]: 'ZAR cents' };

export type Money = {
  readonly currency: CurrencyCode;
  readonly amountCents: Cents;
};

export function cents(value: bigint): Cents {
  return value as Cents;
}

export function money(amountCents: bigint): Money {
  return { currency: ZAR, amountCents: cents(amountCents) };
}

/**
 * Parse a decimal rand string into cents.
 * Accepts "10", "10.5", "10.50", and "-0.01".
 * Rejects floats, thousands separators, and more than two decimal places.
 */
export function zarFromDecimal(amount: string): Money {
  if (typeof amount !== 'string') {
    throw new Error('ZAR amounts must be decimal strings such as "10.50", never floats.');
  }

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) {
    throw new Error(
      `Invalid ZAR amount "${amount}". Use a string with at most two decimal places.`,
    );
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return money(sign * (whole * 100n + BigInt(fraction)));
}

export function addMoney(left: Money, right: Money): Money {
  return money(left.amountCents + right.amountCents);
}

export function subtractMoney(left: Money, right: Money): Money {
  return money(left.amountCents - right.amountCents);
}

/**
 * VAT in basis points. 15% is 1500. Half a cent rounds away from zero,
 * which keeps a credit note the exact inverse of the invoice it reverses.
 */
export function vatOn(net: Money, rateBasisPoints: number): Money {
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error('VAT rate must be a non-negative integer number of basis points.');
  }

  const numerator = net.amountCents * BigInt(rateBasisPoints);
  const divisor = 10_000n;
  const half = divisor / 2n;
  const rounded = numerator >= 0n ? (numerator + half) / divisor : (numerator - half) / divisor;
  return money(rounded);
}

/** Format cents as rands, for example R1 234.50. Grouping uses a normal space. */
export function formatZar(value: Money): string {
  const negative = value.amountCents < 0n;
  const absolute = negative ? -value.amountCents : value.amountCents;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}R${whole}.${fraction}`;
}
