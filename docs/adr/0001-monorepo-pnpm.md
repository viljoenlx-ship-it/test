# ADR 0001: pnpm workspace, no task runner yet

## Status

Accepted

## Context

The blueprint has 36 modules with a dependency graph and separate commercial packages. The API and the web app need the same money, preset, and module types. A single package would make that sharing accidental. A published-package setup is too heavy before the first module exists.

## Decision

Use a pnpm workspace:

- `apps/api` and `apps/web` for processes
- `packages/shared`, `packages/kernel`, and `packages/db` for the foundation
- `modules/*` already included in the workspace, empty until a module is built

TypeScript is strict, including `noUncheckedIndexedAccess`. Packages are TypeScript source, run by `tsx` and Vite. They are not compiled to `dist` yet because nothing is published.

pnpm recursive scripts and one root `vitest`/`tsc`/`eslint` config are enough at this size. Turborepo can be added when the module count makes task caching worth a second tool.

## Consequences

- Shared types cannot drift between the browser and the API.
- A module is a new folder, not a new repository.
- Contributors need pnpm 10. The root `packageManager` field pins 10.33.4.
