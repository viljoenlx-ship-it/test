# ADR 0015: Platform operators are a separate identity

## Status

Accepted

## Context

The companies on Omnivate are tenants. The people inside a company are KRN-01 users. Liam also needs a control panel that can see every company. That login must not be a tenant user with a hidden permission. A tenant session must not open the panel, and an operator session must not open a company.

GOV-05 asks for short sessions and a second factor for people who administer the system. SMS is out. The tenant cookie is already `omnivate_session`.

## Decision

Platform staff live in `platform_operators`, with their own roles (`platform_owner`, `platform_support`), sessions, and authenticator challenges. They are not rows in `users`. Row-level security is forced on those tables and `omnivate_app` is not granted them. The API reaches them only through security-definer functions that do one named lookup or insert.

The operator cookie is `omnivate_operator`. The tenant cookie is still `omnivate_session`. Routes read only their own cookie. Every operator role requires TOTP before a session is issued. A trigger rejects turning that flag off. The session default is 10 minutes and cannot be configured longer than 15 (`OPERATOR_SESSION_TTL_SECONDS`, 60 to 900). Five failed passwords in 15 minutes return 429. The attempts table cannot be deleted by the API role.

Platform Owner can change companies. Platform Support can read companies, people, and the audit, and cannot change them.

The control panel is a second Vite app, `apps/control-panel`, served at `/control` by the same Fastify process that serves the company app and `/api`. Local `pnpm dev` starts it on port 5174. [ADR 0017](0017-design-system.md) covers how both apps look.

## Consequences

- The seeded operator is fictional: `operator@omnivate.example`, password `local-demo-only`, authenticator on first sign-in.
- Losing the authenticator is fixed by a database reset in local development. There are no recovery codes yet.
- A later staff list can add operators. It should not reuse `users`.
