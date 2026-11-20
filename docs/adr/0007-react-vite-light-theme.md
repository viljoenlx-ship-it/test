# ADR 0007: Vite and React, light theme only

## Status

Accepted

## Context

The web client is React and TypeScript. It needs to show that the API is alive and that shared types (demo tenants, VAT, timezone) are the same objects the server uses. The product brief asked for a light theme and an indigo-to-teal brand, with no theme toggle.

## Decision

Vite serves a React single-page app on port 5173 and proxies `/api` to the Fastify process. The app imports `@omnivate/shared` and does not import the kernel or the database package. ESLint rejects those imports.

The page is light only: `color-scheme: light`, no `prefers-color-scheme` dark styles, and no toggle. The indigo-to-teal gradient is a bar, and the wordmark is solid indigo on the light background so the title stays readable.

Next.js was not chosen. The API is a separate Node process because tenant transactions, migrations, and later workers should not live inside the React server. A portal that needs server rendering can be a later app. It should still talk to this API.

## Consequences

- `pnpm dev` runs both processes.
- The browser holds no database credentials.
- Visual theming stays light until a later product decision says otherwise.
