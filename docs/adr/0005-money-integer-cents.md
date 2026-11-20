# ADR 0005: Money as integer cents in ZAR

## Status

Accepted

## Context

Invoices, VAT, payroll, and journals cannot use binary floating point. The South African default currency is ZAR and the standard VAT rate is 15% (blueprint CFG-01 and CFG-04). Foreign currencies come later and must not weaken this rule.

## Decision

Persist money as `amount_cents bigint`. The TypeScript type is a branded `bigint` plus the currency code `ZAR`. Callers pass decimal strings (`"10.50"`), not numbers. VAT is an integer number of basis points. 15% is 1500. Rounding of half a cent is away from zero so a reversal inverts the original tax.

`numeric` was considered. `bigint` cents are simpler to audit and cannot store a fraction of a cent by accident. When multi-currency arrives with FIN-01, the currency code is already `char(3)` on the fixture table. The amount stays integer minor units. It does not become a float.

## Consequences

- Tests cover `0.10 + 0.20`, 15% of R100.00, half-cent rounding, and an amount past `Number.MAX_SAFE_INTEGER`.
- Formatting (`R1 234.50`) is a string built from the bigint, not from `Intl` on a `number`.
- JSON APIs that expose money should send cents as a string if the value might exceed the safe integer range. The health endpoint does not carry an amount.
