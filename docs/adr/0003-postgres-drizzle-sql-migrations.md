# ADR 0003: PostgreSQL, Drizzle, and hand-written SQL migrations

## Status

Accepted

## Context

Tenant isolation, the audit trigger, and the posted-row trigger are database behaviour. They have to be reviewable as SQL. The application also needs typed queries.

## Decision

PostgreSQL 16 is the only datastore. Docker Compose runs it locally. GitHub Actions uses the same major version.

Drizzle is the query layer. The schema in `packages/db/src/schema.ts` mirrors the columns. It does not own migrations.

SQL files in `packages/db/migrations` are the source of truth, applied in order by a small runner that records versions in `schema_migrations`. Row-level security, triggers, and grants are written by hand. Drizzle Kit is not generating them, because those objects are the governance controls and should not be an incidental output of a schema diff.

Prisma was not chosen. Its engine makes `SET LOCAL` and policy definitions a side path. The foundation wants that SQL in the migration a reviewer reads.

## Consequences

- A column change updates the SQL file and `schema.ts` together.
- New tables do not automatically grant rights to `omnivate_app` and do not automatically get row-level security. Both are deliberate and covered by tests for the tables that exist today. A new module's migration must repeat the policy pattern, and its tests must prove isolation.
- The admin URL is a superuser. The API is not allowed to use it.
