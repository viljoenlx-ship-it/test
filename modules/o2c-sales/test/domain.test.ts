import { describe, expect, it } from 'vitest';
import { reminderStageForDaysOverdue, wouldExceedCreditLimit } from '../src/domain';

describe('FIN-02 debtor credit controls', () => {
  it('selects reminder stages at the configured overdue thresholds', () => {
    expect(reminderStageForDaysOverdue(0)).toBeNull();
    expect(reminderStageForDaysOverdue(1)).toBe('first');
    expect(reminderStageForDaysOverdue(6)).toBe('first');
    expect(reminderStageForDaysOverdue(7)).toBe('second');
    expect(reminderStageForDaysOverdue(29)).toBe('second');
    expect(reminderStageForDaysOverdue(30)).toBe('final');
  });

  it('allows an invoice up to the credit limit but blocks an over-limit invoice', () => {
    expect(wouldExceedCreditLimit(700n, 300n, 1000n)).toBe(false);
    expect(wouldExceedCreditLimit(700n, 301n, 1000n)).toBe(true);
  });
});
