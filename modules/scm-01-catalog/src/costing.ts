/**
 * Weighted-average costing for the South Africa preset.
 * Quantities are integer micros (4 decimal places). Money is bigint cents.
 * Half a cent rounds away from zero, matching VAT rounding in @omnivate/shared.
 */

export const QTY_SCALE = 10_000n;

/** R10,000. CFG-11: above this, an adjustment needs Approve Adj. */
export const DEFAULT_ADJUSTMENT_APPROVAL_CENTS = 1_000_000n;

export function parseQuantity(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) {
    throw new Error('Enter a quantity with up to four decimal places.');
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = (match[3] ?? '').padEnd(4, '0');
  return sign * (whole * QTY_SCALE + BigInt(fraction));
}

/** One of something uses the singular. Zero and every other amount use the plural. */
export function unitWord(quantityMicros: bigint, singular: string, plural: string): string {
  const absolute = quantityMicros < 0n ? -quantityMicros : quantityMicros;
  return absolute === QTY_SCALE ? singular : plural.trim() || singular;
}

export function quantityPhrase(quantityMicros: bigint, singular: string, plural: string): string {
  const negative = quantityMicros < 0n;
  const absolute = negative ? -quantityMicros : quantityMicros;
  const text = `${formatQuantity(absolute)} ${unitWord(absolute, singular, plural)}`;
  return negative ? `-${text}` : text;
}

export function formatQuantity(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const whole = (absolute / QTY_SCALE).toString();
  const fraction = (absolute % QTY_SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  const text = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

/** Divide and round half away from zero. Denominator must be positive. */
export function divRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Cannot divide by zero or a negative quantity.');
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

/** Signed stock value in cents for a base-unit quantity at a unit cost. */
export function extendCost(quantityMicros: bigint, unitCostCents: bigint): bigint {
  return divRoundHalfAway(quantityMicros * unitCostCents, QTY_SCALE);
}

export function toBaseQuantity(enteredMicros: bigint, factorToBaseMicros: bigint): bigint {
  if (factorToBaseMicros <= 0n) {
    throw new Error('A unit conversion must be greater than zero.');
  }
  return divRoundHalfAway(enteredMicros * factorToBaseMicros, QTY_SCALE);
}

/**
 * New weighted-average unit cost after a receipt.
 * When nothing is on hand (or the balance is negative), the receipt cost becomes the average.
 */
export function weightedAverageOnReceipt(input: {
  onHandMicros: bigint;
  averageCostCents: bigint;
  receiptMicros: bigint;
  receiptUnitCostCents: bigint;
}): bigint {
  if (input.receiptMicros <= 0n) {
    throw new Error('A receipt quantity must be greater than zero.');
  }
  if (input.receiptUnitCostCents < 0n || input.averageCostCents < 0n) {
    throw new Error('Cost cannot be negative.');
  }
  if (input.onHandMicros <= 0n) {
    return input.receiptUnitCostCents;
  }
  const combined =
    input.onHandMicros * input.averageCostCents + input.receiptMicros * input.receiptUnitCostCents;
  return divRoundHalfAway(combined, input.onHandMicros + input.receiptMicros);
}

/**
 * Unwind a receipt. Issues and adjustments do not change the average, so reversing
 * them leaves it in place. When the reversal clears the balance, the last average is kept
 * for the next receipt to replace.
 */
export function weightedAverageAfterReceiptReversal(input: {
  onHandMicros: bigint;
  averageCostCents: bigint;
  reversalMicros: bigint;
  originalUnitCostCents: bigint;
}): bigint {
  if (input.reversalMicros <= 0n) {
    throw new Error('A reversal quantity must be greater than zero.');
  }
  const remaining = input.onHandMicros - input.reversalMicros;
  if (remaining <= 0n) {
    return input.averageCostCents;
  }
  const value =
    input.onHandMicros * input.averageCostCents -
    input.reversalMicros * input.originalUnitCostCents;
  if (value <= 0n) {
    return input.averageCostCents;
  }
  return divRoundHalfAway(value, remaining);
}

export function adjustmentNeedsApproval(
  absoluteValueCents: bigint,
  thresholdCents: bigint,
): boolean {
  return absoluteValueCents > thresholdCents;
}
