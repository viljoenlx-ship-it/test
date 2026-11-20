import { formatZar, money, southAfricaPreset, vatOn, zarFromDecimal } from '@omnivate/shared';

export type TotalsInput = {
  lineTotalsCents: bigint[];
  subtotalCents: bigint | null;
  vatCents: bigint | null;
  totalCents: bigint | null;
  vatRateBasisPoints?: number;
};

export type TotalsCheck = {
  linesSumCents: bigint;
  expectedVatCents: bigint | null;
  warnings: string[];
};

function label(cents: bigint): string {
  return formatZar(money(cents));
}

/**
 * Warns when line totals, VAT at the company rate, or the document total disagree.
 * One cent is allowed so half-cent rounding does not raise a warning.
 */
export function checkTotals(input: TotalsInput): TotalsCheck {
  const linesSum = input.lineTotalsCents.reduce((sum, value) => sum + value, 0n);
  const warnings: string[] = [];
  const rate = input.vatRateBasisPoints ?? southAfricaPreset.vatStandardRateBasisPoints;
  const expectedVat =
    input.subtotalCents === null ? null : vatOn(money(input.subtotalCents), rate).amountCents;

  if (input.subtotalCents !== null && difference(linesSum, input.subtotalCents) > 1n) {
    warnings.push(
      `Line totals add up to ${label(linesSum)}, but the subtotal is ${label(input.subtotalCents)}.`,
    );
  }
  if (
    expectedVat !== null &&
    input.vatCents !== null &&
    difference(expectedVat, input.vatCents) > 1n
  ) {
    const percent = rate / 100;
    warnings.push(
      `VAT at ${percent}% of the subtotal would be ${label(expectedVat)}. The document shows ${label(input.vatCents)}.`,
    );
  }
  if (input.subtotalCents !== null && input.vatCents !== null && input.totalCents !== null) {
    const combined = input.subtotalCents + input.vatCents;
    if (difference(combined, input.totalCents) > 1n) {
      warnings.push(
        `Subtotal plus VAT is ${label(combined)}. The document total is ${label(input.totalCents)}.`,
      );
    }
  }
  if (input.subtotalCents === null || input.vatCents === null || input.totalCents === null) {
    warnings.push('Enter the subtotal, VAT, and total.');
  }
  return { linesSumCents: linesSum, expectedVatCents: expectedVat, warnings };
}

function difference(left: bigint, right: bigint): bigint {
  return left > right ? left - right : right - left;
}

export function decimalCents(value: string): bigint {
  return zarFromDecimal(value).amountCents;
}
