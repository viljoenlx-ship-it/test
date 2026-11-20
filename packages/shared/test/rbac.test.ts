import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '../src/modules';
import {
  ACCESS_ROLES,
  ACCESS_SCOPES,
  APPROVAL_LIMITS,
  MFA_REQUIRED_ROLE_KEYS,
  roleRequiresMfa,
  seedGrantsForRole,
} from '../src/rbac';

describe('blueprint role matrix', () => {
  it('covers every module once and requires an authenticator for owner, manager, accountant, and HR', () => {
    const seen = ACCESS_SCOPES.flatMap((entry) => [...entry.modules]);
    expect(seen.slice().sort()).toEqual([...MODULE_IDS].slice().sort());
    expect(new Set(seen).size).toBe(MODULE_IDS.length);

    expect([...MFA_REQUIRED_ROLE_KEYS]).toEqual([
      'tenant_owner',
      'branch_manager',
      'accountant',
      'hr_compliance',
    ]);
    expect(roleRequiresMfa('tenant_owner')).toBe(true);
    expect(roleRequiresMfa('branch_manager')).toBe(true);
    expect(roleRequiresMfa('accountant')).toBe(true);
    expect(roleRequiresMfa('hr_compliance')).toBe(true);
    expect(roleRequiresMfa('sales_cashier')).toBe(false);
    expect(roleRequiresMfa('warehouse_technician')).toBe(false);
    expect(roleRequiresMfa('external_portal')).toBe(false);
    expect(ACCESS_ROLES.filter((role) => role.mfaRequired).map((role) => role.key)).toEqual([
      ...MFA_REQUIRED_ROLE_KEYS,
    ]);
  });

  it('gives the owner full admin except welfare counseling, with the CFG-11 caps', () => {
    const welfare = ACCESS_SCOPES.find((entry) => entry.scope === 'hrp.welfare');
    expect(welfare?.access.tenant_owner.actions).toEqual([]);
    expect(welfare?.access.hr_compliance.actions).toContain('counseling');
    expect(welfare?.access.branch_manager.approvalLimitCents).toBe(APPROVAL_LIMITS.supervisorCents);

    const procurement = ACCESS_SCOPES.find((entry) => entry.scope === 'scm.procurement');
    expect(procurement?.access.branch_manager.label).toBe('Approve POs');
    expect(procurement?.access.branch_manager.approvalLimitCents).toBe(
      APPROVAL_LIMITS.managerCents,
    );

    const ownerGrants = seedGrantsForRole('tenant_owner');
    expect(ownerGrants.some((grant) => grant.action === 'counseling')).toBe(false);
    expect(ownerGrants.some((grant) => grant.scope === 'krn' && grant.action === 'admin')).toBe(
      true,
    );
  });
});
