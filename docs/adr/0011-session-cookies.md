# ADR 0011: Short-lived httpOnly session cookies

## Status

Accepted

## Context

GOV-05 asks for short-lived sessions. The tenant for a request must come from that session. A header such as `x-tenant-id` must not choose the company. The browser must not be able to read the session token from script.

## Decision

A session is an opaque random token. The cookie holds the token. The database stores only its SHA-256 hash, the user, the tenant, and `expires_at`. The cookie is `HttpOnly`, `SameSite=Lax`, and `Path=/`. `Secure` is set when `COOKIE_SECURE=true` (production HTTPS). Local Vite is plain HTTP, so the flag stays off there.

The default lifetime is 15 minutes (`SESSION_TTL_SECONDS`, allowed range 60 to 3600). Expiry is absolute from issue, not a sliding month. Logout sets `revoked_at`. Deactivating a member revokes their sessions in that tenant. The lookup function treats an expired, revoked, disabled, or deactivated session as signed out.

The API never reads a tenant from a request header. After the cookie is checked, the route calls `withTenant` with the tenant stored on the session row.

There is no JWT. A signed token would keep working until it expired, and a client could be tempted to trust claims inside it. A row can be revoked immediately.

## Consequences

- Tests can expire a session by setting `expires_at` in the past. They do not sleep.
- A stolen cookie is useful for at most the remaining lifetime, and only until logout or deactivation.
- Production must set `COOKIE_SECURE=true` behind HTTPS. Leaving it false on a public HTTP site would send the cookie in the clear.
