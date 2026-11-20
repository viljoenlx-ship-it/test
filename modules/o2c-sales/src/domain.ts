export type ReminderStage = 'first' | 'second' | 'final';

/** Reminder cadence: first at 1–6 days, second at 7–29, final at 30+. */
export function reminderStageForDaysOverdue(daysOverdue: number): ReminderStage | null {
  if (!Number.isFinite(daysOverdue) || daysOverdue < 1) return null;
  if (daysOverdue >= 30) return 'final';
  if (daysOverdue >= 7) return 'second';
  return 'first';
}

export function wouldExceedCreditLimit(
  outstandingCents: bigint,
  newInvoiceCents: bigint,
  creditLimitCents: bigint,
): boolean {
  return outstandingCents + newInvoiceCents > creditLimitCents;
}
