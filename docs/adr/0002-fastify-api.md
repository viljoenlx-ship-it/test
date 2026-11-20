# ADR 0002: Fastify for the API

## Status

Accepted

## Context

The backend is Node.js and TypeScript. It will eventually host 36 modules, each with routes, but today it only needs a health check. The tenant transaction and audit write must stay obvious, because they are the security boundary.

## Decision

Use Fastify 5. `buildApp` takes its dependencies as arguments so tests can call `inject` without opening a port or a database. CORS allows `WEB_ORIGIN`: the Vite dev server locally, and the public Render URL on the hosted preview. The preview serves the built web app from this same process, under one origin.

Modules will later export a `register(app)` function and the API will register the ones a tenant has switched on. They will not start their own servers.

NestJS was not chosen. Its module and decorator layer would hide the tenant transaction before there is a single business module to justify it. Express was not chosen because Fastify's plugin model and schema support match the way modules will attach, and the types are stronger.

## Consequences

- The health route is small and tested without the network.
- A future module registers into the same process.
- Background workers, when they exist, should be separate Node processes that reuse `packages/kernel`, not routes inside the web server.
