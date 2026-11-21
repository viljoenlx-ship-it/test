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

/** True only for real ISO calendar dates. */
export function isIsoCalendarDate(value:string):boolean{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
