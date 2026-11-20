import { describe, expect, it } from 'vitest';
import { sodActionLabel, sodPreventionSentence } from '../src/sod-actions';
import { plainRoleName } from '../src/rbac';

describe('plain words for roles and segregation', () => {
  it('hides developer role names', () => {
    expect(plainRoleName({ key: 'tenant_owner', name: 'Tenant Owner / SysAdmin' })).toBe('Owner');
    expect(plainRoleName({ name: 'Sales / POS Cashier' })).toBe('Cashier');
    expect(plainRoleName({ name: 'External Portal User' })).toBe('Portal User');
    expect(plainRoleName({ key: 'warehouse_technician' })).toBe('Warehouse');
  });

  it('writes a segregation sentence without action codes', () => {
    expect(sodPreventionSentence('party.supplier.create', 'fin.creditor.payout.approve')).toBe(
      'The person who adds a supplier cannot approve a supplier payout.',
    );
    expect(sodActionLabel('supplier.create')).toBe('That Action');
    expect(sodActionLabel('party.supplier.create')).toBe('Add A Supplier');
  });
});
