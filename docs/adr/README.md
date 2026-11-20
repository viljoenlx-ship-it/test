# Architecture decision records

| ADR                                             | Decision                                 |
| ----------------------------------------------- | ---------------------------------------- |
| [0001](0001-monorepo-pnpm.md)                   | pnpm workspace                           |
| [0002](0002-fastify-api.md)                     | Fastify API                              |
| [0003](0003-postgres-drizzle-sql-migrations.md) | PostgreSQL, Drizzle, hand-written SQL    |
| [0004](0004-row-level-security.md)              | Row-level security for tenants           |
| [0005](0005-money-integer-cents.md)             | Money as integer cents                   |
| [0006](0006-audit-and-posted-records.md)        | Append-only audit and posted-row deletes |
| [0007](0007-react-vite-light-theme.md)          | Vite, React, light theme                 |
| [0008](0008-south-africa-preset.md)             | South Africa defaults                    |
| [0009](0009-ci-and-secret-scan.md)              | CI and secret scanning                   |
| [0010](0010-identity-passwords-memberships.md)  | People, memberships, argon2id            |
| [0011](0011-session-cookies.md)                 | Short-lived httpOnly session cookies     |
| [0012](0012-totp-mfa.md)                        | TOTP for owner and accountant            |
| [0013](0013-segregation-of-duties.md)           | Per-tenant segregation rules             |
| [0014](0014-render-preview.md)                  | Render blueprint for a hosted preview    |
| [0015](0015-platform-operators.md)              | Separate platform operator identity      |
| [0016](0016-operator-cross-tenant-access.md)    | Operator access without weakening RLS    |
| [0017](0017-design-system.md)                   | Shared UI: Radix, tokens, no Tailwind    |
| [0018](0018-mfa-role-set.md)                    | Authenticator also for manager and HR    |
