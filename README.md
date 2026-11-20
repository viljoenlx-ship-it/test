# Omnivate

Omnivate is a modular, multi-tenant business platform for South African SMEs. This repository has the foundation (tenant isolation, an append-only audit trail, a block on deleting posted records, exact money in cents) and the first module, KRN-01 Identity, Users & Zero-Trust RBAC.

You can sign in, set up an authenticator, invite a person, and keep contacts and branches. SCM-01 adds the catalog and stock ledger. The general ledger is only an outbox of stock journals.

The product map is [`docs/blueprint/Modular_ERP_Operations_Map_v7.md`](docs/blueprint/Modular_ERP_Operations_Map_v7.md). That file is the source of truth.

## Hosted preview

You can open this branch from a phone or a computer. The preview is fictional demo data, light theme only, and costs R0 on Render's free plan. The click-by-click steps are in [`docs/deploy-preview.md`](docs/deploy-preview.md).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/viljoenlx-ship-it/Omnivate-Systems)

That button signs you in to Render with GitHub, then asks you to approve a Blueprint for this repository. You do not type secrets. The link works once this setup is on the `main` branch.

## Prerequisites

- Node.js 22 or newer (`node -v`)
- pnpm 10.33.4. From the repo root, after Node is installed:

  ```bash
  corepack enable
  corepack prepare pnpm@10.33.4 --activate
  ```

- Docker Engine with Compose v2 (`docker compose version`)

## Run it locally

From the repository root:

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL, applies migrations, loads the fictional demo tenants, and starts both processes:

- Web app: [http://localhost:5173](http://localhost:5173)
- API health: [http://127.0.0.1:3000/health](http://127.0.0.1:3000/health)

The page is light theme only. Open [http://localhost:5173/login](http://localhost:5173/login) and use a demo person below.

The control panel, for the fictional platform operator, is [http://localhost:5174/control/](http://localhost:5174/control/). It is a separate sign-in. A company user cannot open it. Overview includes Build Progress: what is done, what is being built, and what is still coming. That list is [`docs/progress/roadmap.json`](docs/progress/roadmap.json).

Stop it with Ctrl+C. The database container keeps running. Stop it, and delete the local data volume, with:

```bash
docker compose down
docker compose down -v
```

`down -v` removes the database volume. That is the reset path. Posted demo rows cannot be deleted in place; that is intentional.

## Demo data

The seed creates two invented companies and seven fictional people in each. They are not real businesses or staff. Do not put real customer, staff, or financial data in this repository, the seed, or fixtures.

Every demo person uses the password `local-demo-only`. That password is for local development only.

Owners, managers, accountants, and HR officers are asked to set up an authenticator app (a 6-digit code) before they get a session. The setup secret is shown once on the next screen. Cashiers, warehouse staff, and portal users sign straight in. A session lasts 15 minutes.

| Company                                      | Person            | Email                                  | Role        |
| -------------------------------------------- | ----------------- | -------------------------------------- | ----------- |
| Aubergine Atlas Traders (Pty) Ltd, Cape Town | Thandi Molefe     | owner@aubergine-atlas.example          | Owner       |
|                                              | Johan Pieters     | manager@aubergine-atlas.example        | Manager     |
|                                              | Naledi Khumalo    | accountant@aubergine-atlas.example     | Accountant  |
|                                              | Sipho Dlamini     | cashier@aubergine-atlas.example        | Cashier     |
|                                              | Lerato Nkosi      | warehouse@aubergine-atlas.example      | Warehouse   |
|                                              | Ayesha Patel      | hr@aubergine-atlas.example             | HR          |
|                                              | Cape Coastal      | portal@aubergine-atlas.example         | Portal User |
| Blue Crayon Foundry (Pty) Ltd, Polokwane     | Kabelo Mokoena    | owner@blue-crayon-foundry.example      | Owner       |
|                                              | Annelise Venter   | manager@blue-crayon-foundry.example    | Manager     |
|                                              | Pieter Naidoo     | accountant@blue-crayon-foundry.example | Accountant  |
|                                              | Zanele Mthembu    | cashier@blue-crayon-foundry.example    | Cashier     |
|                                              | Francois Botha    | warehouse@blue-crayon-foundry.example  | Warehouse   |
|                                              | Nomsa Dube        | hr@blue-crayon-foundry.example         | HR          |
|                                              | Limpopo Packaging | portal@blue-crayon-foundry.example     | Portal User |

On the sign-in page, enter the email and password. If that email belongs to more than one company, choose the company. A company code is optional. Invites are not emailed. The people page shows the link, and the API process logs it.

## Control panel

The control panel is how a platform operator manages every fictional company. It is not part of a company's sign-in.

| Person                      | Email                     | Password          |
| --------------------------- | ------------------------- | ----------------- |
| Alex Maseko, Platform Owner | operator@omnivate.example | `local-demo-only` |

Alex is fictional. The first sign-in asks for an authenticator, the same way an owner does. The session lasts 10 minutes. Platform Support is a second role that can look but not change. No support person is seeded.

From the panel you can add a company, suspend it (that company can no longer sign in), set the name and colours people see, pick a package, switch modules on or off, invite a person, and read the audit. Billing and support access say "coming soon" because they are not built. Do not type a real business into the form.

On the hosted preview the same operator is at `/control` on the preview site. You do not set a new Render variable for this. Logos uploaded there live on the web service disk and disappear when the free service restarts. Details are in [docs/deploy-preview.md](docs/deploy-preview.md).

`pnpm db:seed` restores these demo passwords, roles, and active memberships. It does not turn an authenticator off once someone has enrolled. To wipe local data, use `docker compose down -v`.

## Common commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `pnpm dev`          | Database, migrations, seed, API, and web app         |
| `pnpm db:migrate`   | Create the app role and apply SQL migrations         |
| `pnpm db:seed`      | Load the two fictional tenants                       |
| `pnpm test`         | Unit tests and database tests. PostgreSQL must be up |
| `pnpm lint`         | ESLint                                               |
| `pnpm format`       | Prettier write                                       |
| `pnpm format:check` | Prettier check                                       |
| `pnpm typecheck`    | Strict TypeScript, no emit                           |
| `pnpm verify`       | Lint, format, types, and tests                       |

Database tests need the same Postgres the API uses. `pnpm dev` starts it. To run tests without the web app:

```bash
docker compose up -d --wait
pnpm test
```

Copy `.env.example` to `.env` first so the tests can find the database.

## See tenant isolation yourself

The `postgres` user is a superuser and **bypasses row-level security**. A query in that session can see every tenant. That is not the path the API uses. The API logs in as `omnivate_app`.

```bash
docker compose exec postgres psql "postgres://omnivate_app:omnivate_local_dev_only@localhost/omnivate"
```

```sql
SELECT count(*) FROM foundation_notes; -- 0. No tenant is set, so nothing is visible.

BEGIN;
SELECT set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', true);
SELECT body FROM foundation_notes; -- only the Cape Town demo
COMMIT;
```

The other demo id is `22222222-2222-4222-8222-222222222222`.

## Where to read next

- [docs/deploy-preview.md](docs/deploy-preview.md) — hosted preview for a phone or a PC
- [docs/architecture.md](docs/architecture.md) — layout, choices, and how a module plugs in
- [docs/adr](docs/adr) — short decision records
- [docs/blueprint](docs/blueprint) — the operations map
- [modules/README.md](modules/README.md) — where the 36 modules will go

## What is intentionally missing

Custom fields, finance, and the modules after SCM-01. Stock journals wait in an outbox for the general ledger. SSO, SMS codes, and portal magic links are not built. Contacts are in KRN-02. Branches are in KRN-03. ID numbers are masked, not encrypted. Governance controls GOV-04, GOV-06, and GOV-08 through GOV-10 are recorded in the blueprint and are not built yet. GitHub Actions does not deploy. The Render blueprint in [`render.yaml`](render.yaml) is a preview you start by hand.
