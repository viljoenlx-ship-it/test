# ADR 0018: Authenticator for owner, manager, accountant, and HR

## Status

Accepted (2026-11-19)

## Context

[ADR 0012](0012-totp-mfa.md) required an authenticator for the tenant owner and the accountant. Blueprint GOV-05 asks for TOTP or SMS for admin and finance roles, and mandatory 2FA for the owner and the accountant. Liam decided on 2026-11-19 that branch managers and HR / compliance officers carry the same risk: they approve money, people changes, or both. Cashiers, warehouse staff, and external portal users do not.

SMS stays out. The role flag `mfa_required` is still what sign-in checks.

## Decision

`MFA_REQUIRED_ROLE_KEYS` in `packages/shared/src/rbac.ts` is the only list of roles that must enrol in TOTP:

- `tenant_owner`
- `branch_manager`
- `accountant`
- `hr_compliance`

`sales_cashier`, `warehouse_technician`, and `external_portal` stay optional. A company can still turn the flag on for those roles. It cannot turn the flag off for a key in the list. The database trigger enforces the same four keys, including for the superuser.

The seed writes the flag from this constant. Changing who must use an authenticator means changing the constant and the trigger together.

## Consequences

- Demo owners, managers, accountants, and HR officers see the setup secret on first sign-in. The README password alone does not open a session for them.
- A cashier, warehouse person, or portal user still signs straight in.
- Platform operators are unchanged: every platform role already requires an authenticator.
