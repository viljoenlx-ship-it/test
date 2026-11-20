import type { ImportTarget } from '../target';
import { openingCustomersTarget, openingSuppliersTarget, openingTrialTarget } from './opening';
import { contactsTarget } from './register-contacts';
import { stockTarget } from './register-stock';

export const importTargets: readonly ImportTarget[] = [
  contactsTarget,
  stockTarget,
  openingCustomersTarget(),
  openingSuppliersTarget(),
  openingTrialTarget(),
];

export function targetById(id: string): ImportTarget | null {
  return importTargets.find((target) => target.id === id) ?? null;
}
