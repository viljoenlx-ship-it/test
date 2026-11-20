# ADR 0004: Tenant isolation with row-level security

## Status

Accepted

## Context

GOV-01 requires tenant isolation at the kernel data layer, not only in application `WHERE` clauses. A missed filter should return nothing, not another tenant's rows. This is a POPIA and multi-tenant SaaS boundary.

## Decision

Every tenant-owned table has `tenant_id`. Row-level security is enabled and forced. Policies compare that column (or `tenants.id`) to `app_current_tenant_id()`, which reads a transaction-local setting.

`withTenant` sets the value with `set_config(..., true)` inside a transaction. The application role `omnivate_app` is not a superuser, does not bypass row-level security, and does not own the tables.

There is no HTTP header that selects a tenant. KRN-01 sets the transaction tenant from the authenticated session row. Tests and the seed still use the admin connection when they must write across tenants.

The `postgres` superuser bypasses row-level security even when it is forced. That is a PostgreSQL rule. The README tells local readers to connect as `omnivate_app` if they want to see the policy work. The API process refuses a superuser connection string.

The hosted preview's migration login is the Render database owner, not a superuser. [ADR 0014](0014-render-preview.md) describes the policy that names only that role. `omnivate_app` is unchanged.

## Consequences

- The isolation test inserts two fixtures and proves tenant A cannot read tenant B's row, including by primary key.
- A query with no tenant set returns no rows.
- An insert for a different tenant fails the policy check.
- Platform admin tools are the explicit path in [ADR 0016](0016-operator-cross-tenant-access.md). They are not the API's normal connection.
