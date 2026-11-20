# ADR 0012: TOTP for owner and accountant roles

## Status

Accepted

## Context

GOV-05 says TOTP or SMS for admin and finance roles, and mandatory 2FA for the owner and the accountant. SMS is a poor second factor (SIM swap) and this module does not send texts. SSO and magic links belong to later work (SSO is out of scope; magic links are KRN-05).

## Decision

MFA is a flag on the role, `mfa_required`. The seeded owner (`tenant_owner`) and accountant roles have it set. A database trigger rejects turning that flag off for those two keys, including for the superuser.

Sign-in is password first. If the role requires MFA and the person has not enrolled, the API returns a pending httpOnly cookie and a one-time TOTP secret (otpauth URI, SHA-1, 6 digits, 30 seconds). The session cookie is issued only after a valid code. If they already enrolled, the same pending cookie is a verify step and the secret is not shown again. Five wrong codes consume the challenge.

No SMS. No email one-time code. An owner can reset another person's authenticator; that writes an audit row and the next sign-in enrolls again. The secret is never written to `audit_events`.

## Consequences

- Demo owners and accountants see the setup secret on first sign-in. The README password alone does not open the admin page for those roles.
- A cashier is not asked for a code. A tenant can later mark another role as MFA-required by the column, but cannot clear it on owner or accountant.
- [ADR 0018](0018-mfa-role-set.md) extends the mandatory set to manager and HR. The constant `MFA_REQUIRED_ROLE_KEYS` is now the list.
- Recovery codes and SSO are not in this module. Losing the authenticator is fixed by an owner reset.
