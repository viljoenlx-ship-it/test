# ADR 0014: Hosted preview on Render

## Status

Accepted

## Context

A non-technical reviewer needs to open the current `main` branch from a phone or a PC. The preview has to stay on Render's free website and free Postgres, in Frankfurt, and it has to keep the two database roles: migrations and the fictional seed as the owner, and the API as `omnivate_app`.

Render's Postgres user owns the database and is not a superuser. Only a superuser can grant `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` therefore applies to the owner. The security-definer functions in KRN-01 are owned by whoever runs the migration. On a superuser that bypasses policies. On Render it would not, and sign-in would return no rows.

Render's free web service also cannot use `preDeployCommand`. Free Postgres expires, and the free website sleeps when idle.

## Decision

`render.yaml` is a Blueprint: one free Node web service and one free Postgres 16 database, both in `frankfurt`. Render's valid regions are `oregon`, `ohio`, `virginia`, `frankfurt`, and `singapore`. Frankfurt is the closest of those to Cape Town.

The service builds the Vite app and serves it from the Fastify process. API routes are under `/api` in that mode. Local `pnpm dev` is unchanged: Vite still proxies `/api` and strips the prefix. `COOKIE_SECURE=true`. `WEB_ORIGIN` falls back to `RENDER_EXTERNAL_URL`. `OMNIVATE_APP_PASSWORD` is `generateValue`. Nothing secret is committed.

The start command, not CI, prepares the database:

1. Build `DATABASE_URL` as `omnivate_app` from the internal owner URL and the generated password.
2. Create or alter `omnivate_app` with `quote_literal`, without asking a non-superuser to mention `BYPASSRLS`.
3. Apply migrations. When the migration role cannot bypass row-level security, add policy `omnivate_migration_owner` on each protected table, granted only to that role.
4. Load the fictional seed.
5. Connect as `omnivate_app` and refuse to listen unless that role is not a superuser, does not bypass row-level security, and does not own `audit_events`.

The login page shows a Preview badge when `VITE_PREVIEW=true`. The theme stays light.

## Consequences

- The API still rejects any connection string whose user is not `omnivate_app`. Forced row-level security, the append-only audit trigger, and the refusal to start as the owner all stay in place.
- The migration owner can read and write every tenant through a policy that names only that role, and can change policies because it owns the tables. Locally the superuser can already do both by bypassing row-level security. `omnivate_app` is not a member of the owner role.
- A non-superuser cannot state `NOSUPERUSER` or `NOBYPASSRLS` in `CREATE ROLE`, and cannot state `NOCREATEDB` without having `CREATEDB`. The preview relies on PostgreSQL's defaults and checks the attributes afterwards. If Render's owner ever loses `CREATEROLE`, the process exits before it listens.
- Free instances have no `preDeployCommand`, so migrate and seed run at the start of the process. Waking a sleeping service does that again. The first page after 15 idle minutes is slow. The fictional seed is idempotent and resets demo passwords. It does not clear an authenticator that has already been enrolled.
- The preview runs TypeScript with `tsx`, so the image install includes development dependencies.
- The internal database URL is not given extra TLS settings. Forcing TLS would break Render's private-network connection, which does not use TLS. An external URL with `sslmode=require` is left for node-postgres to honour.
- Free Postgres expires 30 days after creation, then has 14 days to be upgraded before Render deletes it. It has no backups. The upgrade is a compute-plan change on the database (`0.1c-256mb` is the smallest paid plan), not a workspace-plan change. A paid website plan (`0.5c-512mb` or larger) is what stops the sleep.
- CI does not deploy.
