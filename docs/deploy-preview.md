# Hosted preview

This is a practice copy of Omnivate that you can open on a phone or a computer. The companies and people in it are fictional. It is not a place for real staff, customers, or money.

The preview costs **R0**. It uses Render's free website and Render's free database. You do not need a card for those free plans. This repository does not create the Render account and it does not deploy anything by itself.

## Before you start

You need:

- The GitHub account that can see this repository.
- A Render account. On [render.com](https://render.com), choose **Sign in with GitHub** and allow Render to see this repository when GitHub asks.

Use the `main` branch. The button below is also at the top of the README.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/viljoenlx-ship-it/Omnivate-Systems)

If the picture does not load, open this link instead: <https://render.com/deploy?repo=https://github.com/viljoenlx-ship-it/Omnivate-Systems>

## Click by click

1. Open the **Deploy to Render** button, or go to the Render dashboard and click **New**, then **Blueprint**.
2. If Render asks you to connect GitHub, sign in and let it see **Omnivate-Systems**.
3. Choose this repository. Leave the branch as **main**.
4. Render shows one website (`omnivate-preview`) and one database (`omnivate-preview-db`). Both are on the **Free** plan, in **Frankfurt**. Do not change the plan or the region.
5. You should not be asked to type any passwords. Render creates them.
6. Click **Deploy Blueprint** (the button may say **Apply**).
7. Wait. The first time often takes several minutes. The database is created first, then the website is built.
8. When the website says it is live, open it. The address looks like `https://omnivate-preview.onrender.com`. That is your preview link. It works from a phone or a PC.
9. You should see a small **Preview** badge. The page is the light theme.
10. Sign in with a person from the README. The password for every demo person is `local-demo-only`. On this preview that password is enough for every role, including an owner, a manager, an accountant, and HR.
11. The control panel is the same site with `/control` on the end, for example `https://omnivate-preview.onrender.com/control`. Sign in as `operator@omnivate.example` with the same password. This preview does not ask for an authenticator. The password opens Overview, which shows a short note that two-step sign-in is switched off. That account is fictional platform staff, not one of the companies. Set `MFA_ENFORCEMENT` to `on` before you put real client data on a copy of this service.

New commits on `main` update the preview on their own. You do not have to click deploy again for those.

## What you pay

R0 for this setup.

Render's free website and free database do not send you a bill. A workspace can have only one free database. If Render says you already have a free database, delete that old free database or upgrade it before this blueprint can create another.

## Limits

- The free database **stops working 30 days** after it is created. Render then gives you **14 days** to upgrade it. After that, Render **deletes the database and everything in it**. Render emails the account before this happens. There are no backups on the free database.
- The free website **goes to sleep after 15 minutes** with no visitors. The next visit wakes it. Render shows a loading page for about a minute, and this preview also reloads the fictional demo data before the page is ready, so the first open after a sleep is the slow one.
- Render includes **750 hours a month** for free websites. Time spent asleep does not count. If the hours run out, Render pauses free websites until the next month.
- The data is the fictional demo seed. Do not type real people or real companies into it. A restart puts the demo passwords back. It does not turn an authenticator off if someone has already set one up. Setting `MFA_ENFORCEMENT` to `off` does not delete that authenticator either.
- The preview is light theme only.
- The database is not open to the public internet. Only the website, inside Render, talks to it.

## If you want to keep it

Upgrading the Render **workspace** plan does not change a free website or a free database. Change the **compute plan** on the resource itself.

1. In the Render dashboard, open **omnivate-preview-db**.
2. Change its compute plan from **Free** to the smallest paid database, **0.1 CPU / 256 MB** (`0.1c-256mb`), before the 30 days are up. That database does not expire.
3. If you do not want the website to sleep, open **omnivate-preview** and change its compute plan from **Free** to the smallest paid website, **0.5 CPU / 512 MB** (`0.5c-512mb`).

Render bills paid plans in US dollars. The prices are on Render's pricing page and can change. The preview in this document stays on the free plans, which are R0.

## If deploy fails

- **Name already taken.** In Render, open the blueprint and choose a slightly different name for the website or the database, then deploy again.
- **You already have a free database.** A workspace can only have one. Remove or upgrade the other free database, then try again.
- **The site never goes green.** Open the website's logs in Render. The process prints an error and does not open the port when the database step fails. The usual fix is to click **Manual Deploy** once the database is marked available.

## For a technical reader

The blueprint is [`render.yaml`](../render.yaml). Region values Render accepts are `oregon`, `ohio`, `virginia`, `frankfurt`, and `singapore`. Frankfurt is the one this file uses. It is the closest of those to Cape Town (about 9,400 km). Johannesburg is a similar distance from Frankfurt and from Singapore. The file pins PostgreSQL 16, the same major version as local Docker and CI. Render's default is newer.

One Node web service serves both Vite apps and the API. The company app is `/`. The control panel is `/control`. API routes are under `/api` on the same origin. `COOKIE_SECURE=true`. `WEB_ORIGIN` is Render's `RENDER_EXTERNAL_URL`, so invite links and CORS use the public https address. No secret is committed. `OMNIVATE_APP_PASSWORD` is `generateValue` (a base64 256-bit string). The start command builds `DATABASE_URL` from the internal owner URL plus that password, with the user forced to `omnivate_app`.

`MFA_ENFORCEMENT` is `on` or `off`. This blueprint sets it to `off` so a reviewer can sign in without an authenticator. The API reads it for company sign-in (owner, manager, accountant, and HR) and for the control panel operator. When it is `off`, a correct password opens a session. There is no setup screen and no code. An authenticator secret that is already stored is left as it is, so setting the variable back to `on` asks for that same authenticator again. The process logs a warning at startup while the switch is off. Overview shows "Two-step sign-in is switched off on this preview". The login pages do not. If the variable is missing, it is `on`. Set it to `on` before real client data.

`GITHUB_TOKEN` is optional for the site to run. The blueprint lists it with `sync: false`, so a deploy does not overwrite a token you type in the Render dashboard, and it does not create one for you. Build Progress asks GitHub which pull requests are open or merged. This repository is private, so GitHub answers as if the repository were missing unless the token can read it. Set that token on the Render service when you want Done and In Progress to follow the pull requests, including Checks Passing, Checks Running, and Checks Failing. Without the token, Overview still loads and shows `docs/progress/roadmap.json`. A public repository can be read without a token until the rate limit is used up. The company app never sees the token.

Document capture reads supplier invoices and delivery notes. Each company starts on Standard Reader, which stays on the server and does not need a key. `OPENAI_API_KEY` is `sync: false`, so Render asks for it and the value is not in this repository. Save that key only if a company should be able to use Premium Reader (the extra-fee reader) from the control panel. If Premium is selected and the key is missing, that company stays on Standard Reader and the control panel says so. `DOCUMENT_READER_MODEL` is optional and defaults to `gpt-4o-mini`. `DOCUMENT_STORAGE_DIR` is optional and defaults to `data/documents` on the web service disk. The free plan has no persistent disk, so an uploaded file is gone after a restart. The document row stays in Postgres. Do not put a real supplier invoice on this preview.

You do not type a new environment variable by hand except `OPENAI_API_KEY` when a company should use Premium Reader, and `GITHUB_TOKEN` when you want Build Progress to follow pull requests. `MFA_ENFORCEMENT` is already in the blueprint. Operator session length and the logo folder have defaults. Logos are files on the web service disk (`data/branding` unless `BRANDING_STORAGE_DIR` is set). The free web service has no persistent disk, so a logo is gone after a restart or a fresh deploy. Company rows stay in Postgres.

Render's free plan cannot run `preDeployCommand`. The start command waits for the database, creates or updates `omnivate_app`, migrates, loads the fictional seed, checks the live role, and only then listens. `/api/health` is the health check. A failed migration fails the deploy.

The owner URL is Render's **internal** connection string. It has no `sslmode`. The client does not force TLS, because the private network does not use it. An external URL would carry `sslmode=require`, and node-postgres follows that.

### The two database roles

| Login                   | Who it is on Render                                                  | What it may do                     |
| ----------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| Render's generated user | Database owner. Not a superuser.                                     | Migrations and the fictional seed. |
| `omnivate_app`          | Created by the start command. Password from `OMNIVATE_APP_PASSWORD`. | The API only.                      |

The API still refuses to start unless `DATABASE_URL` logs in as `omnivate_app`. The start command also connects and refuses to listen if that role is a superuser, has `BYPASSRLS`, or owns `audit_events`.

Local Docker uses the `postgres` superuser, who bypasses row-level security even when it is forced. Render does not give you a superuser, and only a superuser can grant `BYPASSRLS`. A non-superuser is also not allowed to _say_ `NOBYPASSRLS` in `CREATE ROLE` or `ALTER ROLE`. The role step omits those clauses. It also omits `NOCREATEDB` unless the migration login is allowed to say it. PostgreSQL's default is already off. `quote_literal` quotes the password, so `+`, `/`, and `=` are safe. The step then checks that `omnivate_app` is `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, and `NOINHERIT`.

`FORCE ROW LEVEL SECURITY` still applies to the owner. Security-definer functions are owned by that role, so without a bypass they would return no rows and sign-in would fail. After migrations, if the migration role cannot bypass row-level security, the migrator adds a policy named `omnivate_migration_owner` on each protected table. The policy applies **only** to that role. `omnivate_app` is not a member of it, is not the table owner, and still sees no rows unless the tenant is set. The owner can change policies because they own the tables. That is the same trust already given to the local superuser who runs migrations. It is not the API's login.

The API runs TypeScript through `tsx`, so the install keeps development dependencies. A later production build can compile to JavaScript and install production dependencies only.

GitHub Actions does not deploy and has no Render credentials. The decision record is [ADR 0014](adr/0014-render-preview.md).
