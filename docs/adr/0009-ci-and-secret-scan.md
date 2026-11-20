# ADR 0009: CI checks and secret scanning

## Status

Accepted

## Context

The foundation is reviewed by a person who should not have to re-run lint, types, and tenant tests by hand on every change. Secrets do not belong in the repository. Real customer data does not either. CI checks the code. It does not deploy. A separate Render blueprint, started by hand, is the hosted preview.

## Decision

GitHub Actions runs, on every pull request and on pushes to `main`:

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck` (strict TypeScript)
- `pnpm build` for the Vite app
- `pnpm test` against PostgreSQL 16, including a check that the built web app and `/api/health` come from one process
- `gitleaks` v8.30.1 over the git history

The workflow has `contents: read` only. It does not deploy and it does not use cloud credentials.

Local database passwords live in `.env.example` and `docker-compose.yml` because a new checkout has to boot. They are the published local defaults (`postgres` / `omnivate_local_dev_only`), not production secrets. `.env` is gitignored. The migration quotes the app-role password with PostgreSQL `quote_literal`, so a generated password may contain the characters Render uses (`+`, `/`, `=`). The password is never written into the repository.

## Consequences

- A pull request is not ready while CI is red.
- Adding a production secret to a file fails the secret scan.
- CI does not deploy and has no cloud credentials. The hosted preview is a Render blueprint, described in [ADR 0014](0014-render-preview.md). GitHub Actions does not apply it.
