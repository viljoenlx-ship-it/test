# ADR 0016: How an operator touches one company without opening the others

## Status

Accepted

## Context

[ADR 0004](0004-row-level-security.md) says a platform tool must be an explicit break-glass path, not the API's normal connection. `omnivate_app` is not a superuser, does not bypass row-level security, and does not own the tables. Render cannot grant `BYPASSRLS`. A second database login that can see every company would weaken isolation if a normal request used it by mistake.

Operators still have to list companies, create one, and read the audit across companies. Those queries have no single `app.current_tenant_id`.

## Decision

The API process still has one login: `omnivate_app`. Tenant policies are unchanged. There is no `BYPASSRLS` role.

Two sanctioned paths:

1. **A change to one company** runs inside `withTenant(that company's id)`. Row-level security still hides every other company, including when the statement forgets a `WHERE`. Creating a company uses a new id, sets the transaction to that id, then inserts. The insert and update policies on `tenants` require `id = app_current_tenant_id()`. The application role may insert a tenant and update the business columns. It may not delete a tenant. `omnivate_app` may also insert roles for that company so the blueprint matrix can be seeded inside the same transaction. It still cannot read another company's rows.
2. **A read that has no single company** is a security-definer function owned by the migration role, with a fixed `search_path`. Each function is one operation: search companies, search the audit, or return dashboard counts. They take parameters. They do not accept SQL. `omnivate_app` can execute them and cannot select `platform_operators` directly.

Operator actions that belong to a company are written with `appendAuditEvent` in the same transaction, `actor_kind = 'operator'`, `operator_id` set, and `actor_id` null. Sign-in events have no company, so `tenant_id` may be null and those rows are inserted by `platform_insert_audit`. Tenant policies do not show a null `tenant_id`. The audit trigger still rejects update and delete.

Suspending or archiving a company sets `tenants.status`. Sign-in and existing sessions refuse anything other than `active`. Archive is the substitute for delete. There is no delete route.

Logos are files, not table rows. The database stores a key shaped `<tenant id>/<file id>.<ext>`. The browser never sends that key. Local disk is `data/branding` or `BRANDING_STORAGE_DIR`. On Render's free web service the disk is ephemeral, so a logo disappears when the service restarts. A persistent disk is later work.

## Consequences

- A test proves `omnivate_app` sees no companies until a tenant is set, cannot update a second company inside the first company's transaction, and is denied `SELECT` on `platform_operators`.
- The same test proves the search function returns both fictional companies.
- Do not add `USING (true)` for `omnivate_app`. The migration-owner policy from [ADR 0014](0014-render-preview.md) still names only the migration role.
