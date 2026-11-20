# Architecture

Omnivate is one TypeScript codebase that will grow into 36 modules across eight domains. This document describes the foundation those modules plug into. The blueprint in `docs/blueprint/` decides what the modules are, which tier they sit in, and which other modules they require. This repository does not invent a second map.

## Layout

```text
apps/api             Fastify service. Health check, KRN-01, and the control panel API.
apps/web             Vite + React company app. Light theme. Calls the API. No server secrets.
apps/control-panel   Vite + React. Platform staff only. Served at /control.
packages/ui          Shared design system. Tokens, Radix components. No database.
packages/shared      Types and pure functions used by the API and both browsers.
packages/kernel      Server door for tenant scope, audit writes, permissions, and the module catalog.
packages/db          SQL migrations, Drizzle schema, seed, and the application connection pool.
modules/             One package per business module, plus modules/platform-control for the operator API.
docs/blueprint       Source of truth.
docs/progress        Build progress list shown on the control panel Overview.
docs/adr             Why the foundation is shaped this way.
```

`packages/shared` and `packages/ui` are safe to import from React. They have no database driver. `packages/kernel` imports the database, so both browser apps are linted against importing it. Future modules depend on the kernel, not on `packages/db` directly, so a request cannot forget to set the tenant. `modules/platform-control` is not one of the 36 blueprint modules. It is the operator door described in [ADR 0015](adr/0015-platform-operators.md) and [ADR 0016](adr/0016-operator-cross-tenant-access.md).

## How a request is scoped

`GET /health` does not take a tenant. A signed-in request looks like this:

1. The session cookie is an opaque token. The API hashes it and loads the session row. That row names the user and the tenant. A header such as `x-tenant-id` is ignored.
2. The kernel opens a transaction and runs `set_config('app.current_tenant_id', <id>, true)`. The third argument makes the setting local to that transaction.
3. Queries run. PostgreSQL row-level security hides every other tenant, including when a query forgets a `WHERE tenant_id = ...` clause.
4. The transaction commits. The connection returns to the pool with no tenant still attached.

If the setting is missing, policies match nothing. A bug fails closed.

A control-panel request is different, and only after the `omnivate_operator` cookie is checked. It never trusts `x-tenant-id`. A change to one company still calls `withTenant` for that company. A list of companies, the dashboard counts, and the cross-company audit are security-definer functions. `omnivate_app` cannot select operator passwords, and tenant policies are not opened up. See [ADR 0016](adr/0016-operator-cross-tenant-access.md).

The `postgres` superuser bypasses row-level security. Migrations and the seed use that login locally. The API refuses to start if `DATABASE_URL` is not the `omnivate_app` role. That role is not a superuser, cannot bypass row-level security, and does not own the tables, so it cannot disable the audit trigger. On the hosted preview the migration login is Render's database owner instead of a superuser. [ADR 0014](adr/0014-render-preview.md) records how that owner is kept off the API connection.

## Money and South African defaults

Money is a `bigint` count of cents plus the currency code `ZAR`. `zarFromDecimal` accepts strings such as `"10.50"` and rejects JavaScript numbers, because `0.1 + 0.2` is not `0.3`. VAT uses basis points. The standard rate is 1500, which is 15%. Half a cent rounds away from zero so a credit note can invert the tax on the invoice.

`southAfricaPreset` holds the platform defaults from blueprint tab 9: ZAR, 15% VAT, `Africa/Johannesburg`, accrual accounting, a financial year that starts in March, and weighted-average costing. Timestamps in PostgreSQL stay `timestamptz` (UTC). The preset timezone is for display and fiscal clocks. Each company stores its own currency, VAT basis points, time zone, and financial year start. The control panel validates them and can reset them to this preset. It does not copy the numbers into a second constant.

## Governance that exists now

| Control                              | What the foundation does                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| GOV-01 Tenant isolation              | `tenant_id` on tenant-owned tables, row-level security forced, tested across two tenants                         |
| GOV-02 Append-only audit             | `audit_events` plus a trigger that rejects update and delete. KRN-01 fills `actor_id`                            |
| GOV-03 No hard delete of posted rows | `gov_reject_posted_delete()` on `foundation_postings`. Drafts can be deleted. Posted rows cannot                 |
| GOV-05 Identity and sessions         | Argon2id passwords, TOTP for owner, manager, accountant, and HR, 15-minute httpOnly sessions. No SMS, no SSO yet |
| GOV-07 Segregation of duties         | Per-tenant action pairs. A later module registers the two actions it must keep apart                             |

`foundation_notes` and `foundation_postings` are fixtures so the controls can be tested. They are not a product module. Real invoices, bills, journals, and payslips will use the same trigger function and the same `audit_events` table.

GOV-04, GOV-06, and GOV-08 through GOV-10 (field encryption, POPIA erasure, e-sign, backups, and tenant export) are specified in the blueprint and are not built. SSO and portal magic links are not part of KRN-01.

## How a future module plugs in

The catalog in `packages/shared/src/modules.ts` lists all 36 modules, their tier, commercial package, and hard prerequisites. It is metadata. Switching a module on is a product action that must call `assertCanActivate`. Switching one off must call `assertCanDeactivate`. KRN-01 cannot be disabled. A module cannot be disabled while another active module lists it as a prerequisite.

The industry matrix in the blueprint is a preset, not a second dependency graph. A retail tenant turns point of sale on. A services tenant leaves it off. Both presets still have to satisfy the hard prerequisites. For example, activating SAL-03 (point of sale) pulls in:

`KRN-01`, `KRN-02`, `KRN-03`, `FIN-01`, `FIN-02`, `FIN-04`, `FIN-05`, `SCM-01`, then `SAL-03`.

Packaging tiers, for when billing exists:

| Package                  | Modules                                                  |
| ------------------------ | -------------------------------------------------------- |
| Core Platform (Included) | KRN-01, KRN-02, KRN-03, KRN-04, KRN-06, ANA-03           |
| Essentials               | FIN-01 to FIN-06, SAL-01, SAL-02, SCM-01, SCM-02         |
| Operations add-on        | SAL-03, SAL-04, SAL-05, SCM-03, SCM-04, OPS-01 to OPS-04 |
| People & Compliance      | HRP-01 to HRP-05, CMP-01 to CMP-03                       |
| Growth add-on            | KRN-05, ANA-01, ANA-02                                   |

A new module package:

1. Lives in `modules/<id-and-name>/` and is named `@omnivate/module-<id>`.
2. Registers its routes with the Fastify app from a single `register` function. It does not listen on its own port.
3. Adds a SQL migration for its tables. Every tenant-owned table gets `tenant_id`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy comparing `tenant_id` to `app_current_tenant_id()`.
4. Grants the new table to `omnivate_app` explicitly. There is no default grant. Forgetting the grant fails closed.
5. Writes audit rows with `appendAuditEvent` inside `withTenant`, in the same transaction as the change.
6. Attaches `gov_reject_posted_delete()` to tables that can be posted.
7. Uses `amount_cents bigint` and the shared money helpers.
8. Adds tests: one tenant cannot read the other's rows, and the module's activation prerequisites match the catalog.

Cross-module behaviour from blueprint tab 2 (order-to-cash, procure-to-pay, and the rest) should be events or documented function calls between modules, not imports that reach into another module's tables. The kernel catalog is the place that knows a module exists. A module should not query a sibling's tables just because both are in the same database.

## What the running system is

```text
browser, company app (Vite, port 5173)
    |  /api/health, /api/auth/*, /api/krn/*, /api/branding/*
    v
browser, control panel (Vite, port 5174/control)
    |  /api/control/*, cookie omnivate_operator
    v
Fastify (port 3000)  -- omnivate_app -->  PostgreSQL 16
        |                     |
   two cookies           row-level security
   tenant from the session row, never from a header
   operator changes call withTenant for one company
```

`pnpm dev` is the one local command. GitHub Actions runs lint, format, typecheck, tests, and gitleaks on every pull request. It does not deploy.

The hosted preview is one process:

```text
browser (phone or PC)
    |  same origin: /, /login, /control, /api/health, /api/auth/*, /api/control/*
    v
Fastify on Render  -- omnivate_app -->  Render Postgres 16 (Frankfurt)
        |
        +-- company app and control panel, both static Vite builds
```

`pnpm dev` does not use that path. Vite still serves the web app and proxies `/api` to Fastify with the prefix removed.

## KRN-01

`modules/krn-01-identity` (`@omnivate/module-krn-01`) registers its routes on the Fastify app. Its migration is `modules/krn-01-identity/migrations/0002_krn01_identity.sql`. The migrator loads that folder after `packages/db/migrations`.

Other modules should call `requirePermission` and `assertSegregation` from `@omnivate/kernel` inside `withTenant`. Both deny when the grant or the rule says no. `maskFields` hides a value unless the caller holds the exact permission key. `counseling` is never implied by `admin`.

KRN-01 cannot be deactivated. `assertCanDeactivate` rejects it, and a trigger on `tenant_modules` rejects it again, including for the superuser.

## KRN-03

`modules/krn-03-branches` (`@omnivate/module-krn-03`) is Multi-Branch & Inter-Company Structure. Its migration is `modules/krn-03-branches/migrations/0005_krn03_multi_branch.sql`. Creating a company inserts one primary legal entity and one active Head Office branch. Existing companies were backfilled by that migration. The company starts with multi-branch off, so people never see a branch picker.

Turning multi-branch on is a per-company setting. Owners (kernel admin on KRN-03) can do that, archive a branch, and add another legal entity. Branch managers can edit branch details and assign people. Accountants can read. Other roles cannot open the Branches page. Assignments are revoked, not deleted. Branches and legal entities are archived, not deleted. `omnivate_app` has no DELETE grant on these tables.

Later modules call `requireBranchAccess` from `@omnivate/kernel` inside `withTenant` before they write a row that belongs to a branch. With multi-branch off, that call resolves to Head Office. With it on, the person must be assigned to the branch unless they are an owner. The company app stores the current branch and shows it in the header only when more than one branch is in use.

A branch belongs to a legal entity in the same company. `krn03_entity_links` records that two entities are related. This module does not post inter-company transactions. KRN-03 feeds FIN-01, SCM-01, SAL-03, and ANA-03. Its hard prerequisite is KRN-01.

## Control panel

`apps/control-panel` is the platform operator UI. `modules/platform-control` registers its routes. Both use `@omnivate/ui` ([ADR 0017](adr/0017-design-system.md)).

An operator can create and edit a company, suspend or archive it, set branding and South Africa setting overrides, assign one blueprint package, and switch modules on or off through `assertCanActivate` / `assertCanDeactivate`. KRN-01 stays on. Turning a module on shows the prerequisites that will be pulled in before it is confirmed. The operator can list a company's people, invite one (the link is shown, no email is sent), change a role, deactivate, and reset an authenticator. Billing and support access are labelled coming soon and contain no sample figures.

Every operator change writes `audit_events` with the operator as the actor and the company as the target. The panel's audit screen filters by company, actor, action, and date.

Overview also shows Build Progress. One slim bar at the top is the share of the full product that is built. Each of the 36 blueprint modules counts as 1. The blueprint does not give a module a size, so they are not weighted. A row belongs to a module when its id is that module, or when `moduleId` says so. Done counts as 1, in progress as half, and still coming as 0. The module's score is the average of its rows, and the bar is the average of the modules named in the file. A row that is not one of the 36 modules does not move the bar. The list is `docs/progress/roadmap.json`. `GET /control/progress` is operator-only. It merges that file with pull requests on GitHub. A merged pull request is shown as Done, with the merge date. An open pull request is shown as In Progress, with whether checks are passing, running, or failing. An open pull request that is not in the file still appears, using its title. The page refreshes about once a minute. If GitHub does not answer, the file is shown on its own and the page still loads. This repository is private, so the live status needs `GITHUB_TOKEN`. The company app does not call this route. The token is optional for the site to start.

The company app header uses the tenant display name, logo, and colours. When the company has turned on more than one branch, the header also shows the current branch. A colour that would fail WCAG AA on white is kept on the mark only. The control panel company page has a Branches section with the same multi-branch switch.

## KRN-02

`modules/krn-02-party-directory` (`@omnivate/module-krn-02`) is the contact master. A party is an organisation or a person, and can hold several roles (customer, supplier, staff, other) at once. Customers, suppliers, and staff are not separate tables.

The company app calls it Contacts. Reads need `krn.read` on KRN-02. Changes need `krn.operate`. That is the blueprint matrix for the kernel: owner, manager, and accountant can look; owner and manager can change; cashier, warehouse, HR, and portal users cannot. An ID or passport is stored for a person and masked with `maskFields` unless the caller holds the exact `krn.admin` grant. The audit JSON records that the value is present or changed, and does not store the number. POPIA consent is a flag plus the time it was given. Parties are archived, not deleted. The app role has no DELETE on `parties`.

Creating or adding a supplier role audits `party.supplier.create`. Creating or adding staff audits `party.staff.create`. Each demo company gets a segregation pair against `fin.creditor.payout.approve` and `hrp.payroll.payout.approve`, so the later payout modules can keep the maker and the approver apart. Duplicate checks on create and edit compare name, VAT number, and email.

## KRN-04

`modules/krn-04-workflows` (`@omnivate/module-krn-04`) is the kernel for custom fields, pipelines, and in-app alerts. Its migration is `modules/krn-04-workflows/migrations/0005_krn04_workflows.sql`. Other modules call it. They do not copy the tables.

A module registers the records it owns when it loads. Registration is code, not a tenant setting. The fictional sample job card in the seed is data so the settings screens have something to show. It is not a business module, and the demo entity used to prove the engine is registered in the KRN-04 tests only.

```ts
import {
  registerEntityType,
  registerStateMachine,
  installMachine,
  saveCustomFields,
  startRecord,
  moveRecord,
  dispatchRules,
} from '@omnivate/module-krn-04';

registerEntityType({
  key: 'sales.quote',
  moduleId: 'SAL-01',
  label: 'Quote',
  description: 'A price offered to a customer.',
});

registerStateMachine({
  key: 'sales.quote',
  entityType: 'sales.quote',
  moduleId: 'SAL-01',
  label: 'Quote',
  states: [
    { key: 'draft', label: 'Draft', kind: 'initial' },
    { key: 'sent', label: 'Sent', kind: 'terminal' },
  ],
  transitions: [
    {
      key: 'send',
      from: 'draft',
      to: 'sent',
      label: 'Send',
      permission: { scope: 'sal.pipeline', action: 'operate', moduleId: 'SAL-01' },
      auditAction: 'sales.quote.send',
    },
  ],
});
```

Then, inside `withTenant` and after `requirePermission`:

1. `installMachine` copies the module's stages into the company pipeline. The company can add stages. It cannot remove the module's stages. A move can name a maker-checker pair. Saving the pipeline registers that pair with KRN-01 segregation of duties, and the move audits with the same action key.
2. `saveCustomFields` checks the JSON against the company's field definitions. Money is integer cents. Unknown keys are rejected. Archived fields stay in the list and are not deleted.
3. `startRecord` and `moveRecord` change the stage, append transition history, and write `audit_events` with the stage before and after.
4. `dispatchRules` runs alerts that match the event (`fields.saved`, `record.opened`, or any key the module passes) or the move. Built-in actions are an in-app notification and a log entry. `registerWorkflowAction` refuses anything that sends email, WhatsApp, or another outbound message.

A calculated field stores a formula, not a typed value. The formula may use number, money, and decimal fields on the same record, including built-in fields a module registered (stock on hand, reorder level, selling price, cost). The parser in `@omnivate/shared` walks a tree. It does not call `eval`. Money stays in integer cents. The result is read-only for the company and is recomputed when an input changes. A formula that refers to itself, directly or through another calculated field, is rejected.

Operator automations live on the client page, next to custom fields. A rule is a sentence: when a record is created or a field changes, and the conditions match, then set a field, send an in-app alert, or move the record to a pipeline stage. Rules are ordered, can be turned off, and stop after five steps so a chain cannot loop. Each run writes `audit_events` and a row the operator can read as the last 20 runs. Company roles cannot create or edit these rules.

Field definitions and automations are operator-only. The company app fills in values. The form component is `CustomFieldsForm` in `@omnivate/ui`, so a later module can drop the same fields onto its own screen. Calculated fields render as text the person cannot edit.

Do not store ID numbers or bank details in custom fields until GOV-04 field encryption exists.

## Document capture

`modules/doc-capture` (`@omnivate/module-doc-capture`) is Snap a Document. It is not one of the 36 blueprint modules. It stores a supplier tax invoice or delivery note and posts SCM-01 stock receipts. A supplier bill in accounts payable is later work. The extracted header and lines stay on the document so that bill can be posted without reading the file again.

The company app shows Snap a Document in the header and on Stock. A phone opens the camera (`capture=environment`) and the same control accepts a JPG, PNG, HEIC, or PDF, including a multi-page PDF. Original bytes go through a document store (`local` disk today, an S3-compatible store later). The key is the tenant id plus the document id.

`DocumentReader` is the server interface. Each company chooses Standard Reader or Premium Reader on the control panel. Standard is the default. It reads a PDF text layer on the server, and a photo with local character recognition. It does not call a paid API. Premium uses the OpenAI vision reader (`gpt-4o-mini` unless `DOCUMENT_READER_MODEL` is set) only when `OPENAI_API_KEY` is set. If Premium is chosen and the key is missing, Standard runs and the control panel says so. Pages Read are counted per reader. The company app does not name the reader. `DOCUMENT_READER_PROVIDER=demo` is a local test switch that returns fictional results.

Reading runs after the upload returns. Status is Queued, Reading Document, Ready for Review, or Could Not Read. The review screen shows the file beside the fields, highlights low-confidence fields, matches a KRN-02 supplier by VAT number then by name, and matches each line to an SCM-01 item by a remembered supplier code, a barcode, an item code, or a close name. Head Office is the default receiving branch. Totals are checked against the lines and against 15% VAT. The same supplier and document number is flagged. Receive Stock posts one SCM-01 receipt per line at the unit cost excluding VAT, in cents. Undo posts reversing movements. Every post and undo writes `audit_events`.

The control panel company page, on the Modules tab, has a Document Capture switch, the reader choice, and Pages Read for Standard and Premium in the current month in `Africa/Johannesburg`. Files are limited to 12 MB and the four types above. Document contents are not written to logs. The third-party processor is described in [document-capture.md](document-capture.md).

## FIN-01

`modules/fin-01-ledger` (`@omnivate/module-fin-01`) is a lean general ledger. It is not the full finance suite. There is no period lock, no bank reconciliation, and no supplier bill.

A company starts with a South African chart: assets, liabilities, equity, income, cost of sales, and expenses, including Debtors Control, Creditors Control, Inventory, Bank, VAT Input, VAT Output, Retained Earnings, and Opening Balance Equity. An owner or an accountant can add, rename, or deactivate an account. Accounts used by automatic postings can be renamed, not deactivated.

Journals are posted once. The database rejects a journal that does not balance, and it rejects any change to a posted line. The correction is a reversal. Each journal has an accounting date. Reports use that date.

Issuing a tax invoice posts Dr Debtors Control, Cr Sales, Cr VAT Output, and, for stock items, Dr Cost Of Sales, Cr Inventory at the average cost. A credit note reverses that. A customer payment posts Dr Bank, Cr Debtors Control. A stock receipt posts Dr Inventory and Cr Creditors Control when a supplier is known, otherwise Cr Goods Received Not Invoiced. A stock adjustment or write-off posts Inventory against Stock Adjustments. Opening stock from an import posts Inventory against Opening Balance Equity. Documents and movements that already existed are posted the first time someone opens the ledger, and a repeated source key does not post twice.

The company app has the chart, a manual journal on a computer, a trial balance, an income statement, a balance sheet, a VAT summary of output against input, and an account ledger. Each report exports to CSV and PDF.

KRN-06 adds spreadsheet templates for opening stock (with barcodes, prices, and a quantity per branch), customer opening invoices, supplier opening balances, and an opening trial balance. The preview shows row errors. A trial balance that does not balance is refused. Importing the same code, barcode, or invoice again does not create a duplicate.
