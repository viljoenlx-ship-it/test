# Modules

KRN-01 is `modules/krn-01-identity`, package `@omnivate/module-krn-01`. KRN-02 is `modules/krn-02-party-directory`, package `@omnivate/module-krn-02`. KRN-03 is `modules/krn-03-branches`, package `@omnivate/module-krn-03`. SCM-01 is `modules/scm-01-catalog`, package `@omnivate/module-scm-01`. The next ones follow the same shape.

```text
modules/krn-01-identity/
  package.json          # name: @omnivate/module-krn-01
  src/register.ts       # registerKrn01(app) adds routes to the shared Fastify app
  migrations/           # SQL applied by packages/db, in file-name order
```

Rules for a new package:

1. Pick a module whose hard prerequisites are already active. The catalog in `@omnivate/shared` is the gate. `activationClosure('SAL-03')` shows the chain point of sale would pull in.
2. Depend on `@omnivate/kernel` and `@omnivate/shared`. Do not import `@omnivate/db` from a module, and do not import the kernel from the web app.
3. Put `tenant_id` on every tenant-owned table. Enable and force row-level security with the same `app_current_tenant_id()` policy as `packages/db/migrations/0001_foundation.sql`.
4. Store money as `bigint` cents. Use the shared money helpers. Do not add a float column.
5. Write an `audit_events` row in the same transaction as the change, through `appendAuditEvent`.
6. If a row can be posted, attach the `gov_reject_posted_delete()` trigger. Posted invoices, bills, journals, and payslips are reversed, not deleted.
7. KRN-01 cannot be switched off. Company identity stays in KRN-01. Platform staff are a separate login in `modules/platform-control`. They are not a second tenant user table.

`pnpm-workspace.yaml` already includes `modules/*`. Adding a package there is enough for pnpm to pick it up.

The 36 modules, in blueprint order: KRN-01, KRN-02, KRN-03, KRN-04, KRN-05, KRN-06, FIN-01, FIN-02, FIN-03, FIN-04, FIN-05, FIN-06, SAL-01, SAL-02, SAL-03, SAL-04, SAL-05, SCM-01, SCM-02, SCM-03, SCM-04, OPS-01, OPS-02, OPS-03, OPS-04, HRP-01, HRP-02, HRP-03, HRP-04, HRP-05, CMP-01, CMP-02, CMP-03, ANA-01, ANA-02, ANA-03.

KRN-01, KRN-02, KRN-03, KRN-04, and SCM-01 are installed. Document capture is `@omnivate/module-doc-capture`. It is not one of the 36 blueprint modules. It reads a supplier invoice or delivery note and posts SCM-01 receipts. A later module registers its entity types and state machines with `@omnivate/module-krn-04`. See `docs/architecture.md`.

## FIN-02 — Debtors (Accounts Receivable)

FIN-02 is implemented in the shared order-to-cash package at `modules/o2c-sales`
(`@omnivate/module-o2c`). It shares the commercial document engine with SAL-01
quotes, while keeping invoice and debtor access checks, entity types, and report
sources keyed to FIN-02. The API is registered once by `apps/api/src/app.ts`;
the company app exposes the invoice workspace at `/invoices`.

The current FIN-02 path includes customer account details and payment terms,
draft and issued tax invoices, credit notes, sequential per-tenant document
numbers, PDF output, customer receipts and allocations, open invoice balances,
customer statements with ageing buckets, and ready-made aged-debtors reporting.
Issued tax documents are immutable; corrections use credit notes. Receipts and
invoice posting call FIN-01 posting functions, and stock-backed invoice lines
use SCM-01 movements. Tenant scoping and permission checks run through the
shared kernel.

This is an in-progress implementation, not a claim that every blueprint item
is complete. Automated invoice generation, overdue reminder workflows, and
recurring/scheduled invoice generation and outbound reminder email delivery remain follow-on work. Customer credit limits and holds, plus an auditable reminder queue, are now included. See `docs/fin-02-integration.md` for the integration map and current boundaries.
