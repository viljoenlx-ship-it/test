# ADR 0008: South Africa config preset

## Status

Accepted

## Context

Blueprint tab 9 defines platform defaults for tax, currency, the financial year, and related settings. The first tenants are South African. Per-tenant overrides are real product work and should not be invented as a settings module in the foundation.

## Decision

`southAfricaPreset` in `packages/shared` is the single default:

- currency `ZAR`
- standard VAT 1500 basis points (15%)
- time zone `Africa/Johannesburg`
- locale `en-ZA`
- accrual accounting
- financial year starts in March (month 3)
- weighted-average costing

The health payload echoes the currency, timezone, and VAT rate from this object so the API and the preset cannot drift. The seed writes the same timezone and currency onto the two demo tenants.

The database session stays on UTC. `timestamptz` stores an absolute instant. Johannesburg is a display and business-calendar zone, not a reason to set the PostgreSQL `TimeZone` parameter to something other than UTC.

## Consequences

- Tests lock the preset values.
- The control panel stores per-tenant overrides for currency, VAT basis points, time zone, and financial year start. Empty input is rejected. The preset in this file is still the default those fields reset to.
- Payroll tax tables (CFG-08) and B-BBEE thresholds (CFG-09) are not in the preset yet. They belong with HRP-03 and CMP-01, using this file as the pattern.
