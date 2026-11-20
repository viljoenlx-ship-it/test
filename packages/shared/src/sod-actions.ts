/**
 * Actions a person can pair in Segregation Of Duties.
 * The key is stored. The label is what people see.
 */

export const SOD_ACTIONS = [
  {
    key: 'party.supplier.create',
    label: 'Add A Supplier',
    does: 'adds a supplier',
    cannot: 'add a supplier',
  },
  {
    key: 'fin.creditor.payout.approve',
    label: 'Approve A Supplier Payout',
    does: 'approves a supplier payout',
    cannot: 'approve a supplier payout',
  },
  {
    key: 'party.staff.create',
    label: 'Add A Staff Member',
    does: 'adds a staff member',
    cannot: 'add a staff member',
  },
  {
    key: 'hrp.payroll.payout.approve',
    label: 'Approve A Staff Payout',
    does: 'approves a staff payout',
    cannot: 'approve a staff payout',
  },
  {
    key: 'scm.adjustment.submit',
    label: 'Ask For A Stock Adjustment',
    does: 'asks for a stock adjustment',
    cannot: 'ask for a stock adjustment',
  },
  {
    key: 'scm.adjustment.approve',
    label: 'Approve A Stock Adjustment',
    does: 'approves a stock adjustment',
    cannot: 'approve a stock adjustment',
  },
  {
    key: 'krn04.sample.start',
    label: 'Start A Job Card',
    does: 'starts a job card',
    cannot: 'start a job card',
  },
  {
    key: 'krn04.sample.finish',
    label: 'Finish A Job Card',
    does: 'finishes a job card',
    cannot: 'finish a job card',
  },
] as const;

export type SodActionKey = (typeof SOD_ACTIONS)[number]['key'];

const BY_KEY = new Map<string, (typeof SOD_ACTIONS)[number]>(
  SOD_ACTIONS.map((action) => [action.key, action]),
);

export function isSodActionKey(value: string): value is SodActionKey {
  return BY_KEY.has(value);
}

/** Plain words for an action. Unknown keys stay hidden. */
export function sodActionLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? 'That Action';
}

/** A sentence people can edit before they save the rule. */
export function sodPreventionSentence(actionA: string, actionB: string): string {
  const left = BY_KEY.get(actionA);
  const right = BY_KEY.get(actionB);
  return `The person who ${left?.does ?? 'does the first action'} cannot ${right?.cannot ?? 'do the second action'}.`;
}
