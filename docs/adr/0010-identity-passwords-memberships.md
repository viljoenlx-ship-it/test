# ADR 0010: People, memberships, and argon2id

## Status

Accepted

## Context

KRN-01 is the root module. A person can belong to more than one company, so a user row is not owned by a single tenant. The blueprint still requires tenant isolation, granular permissions, approval limits in cents, and no trust of a raw tenant header. GOV-05 asks for modern authentication. Passwords must not be recoverable.

## Decision

`users` is a global login. `memberships` is the tenant-owned link, with status `active` or `deactivated`. Row-level security on `users` shows a person only when they have a membership in `app.current_tenant_id()`. With no tenant set, the policy matches nothing.

Password hashes and TOTP secrets are not granted to `omnivate_app`. The API writes and reads them through security-definer functions owned by the migration role. Those functions answer one lookup the caller already has (an email, a token hash, an invite hash). They do not list a tenant.

Passwords are hashed with argon2id at the OWASP minimum: 19 MiB, two iterations, one lane. The PHC string stores its own parameters.

Roles and grants are seeded from blueprint tab 7. Each grant is a scope, an action, the module ids that scope covers, the matrix label, and an optional `approval_limit_cents`. Null means the grant is not amount-capped. Manager approval cells are capped at R50,000 (5,000,000 cents) and staff-loan approval at R10,000, from CFG-11. The permission guard denies by default. `admin` on a scope covers the other actions on that scope, except `counseling`, which stays an explicit grant so welfare notes stay hidden from the owner.

## Consequences

- A bug that forgets the tenant sees no people and no grants.
- A stolen `omnivate_app` login still cannot `SELECT password_hash`.
- Later modules call `requirePermission` and `maskFields`. They do not invent a second role table.
- Field encryption for the hidden values themselves remains GOV-04 and is not done here.
