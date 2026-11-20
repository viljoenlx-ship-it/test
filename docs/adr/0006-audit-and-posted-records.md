# ADR 0006: Append-only audit and no hard delete of posted rows

## Status

Accepted

## Context

GOV-02 requires an append-only history of writes: who, when, and the before/after difference, kept for at least five to seven years. GOV-03 forbids deleting posted invoices, bills, journals, and payslips. They are reversed.

KRN-01 does not exist yet, so there is no actor. Finance modules do not exist yet, so there is no real invoice.

## Decision

`audit_events` stores the trail. `actor_id` references a KRN-01 user when a person did the thing, and stays null for the seed or an unknown sign-in. A `BEFORE UPDATE OR DELETE` trigger raises `GOV-02` for every role, including the superuser. The application is also granted update and delete so the error a developer sees is the governance error, not a missing grant. There is no function that updates or deletes an audit row.

`gov_reject_posted_delete()` raises `GOV-03` when `status = 'posted'`. Drafts can still be deleted. `foundation_postings` wears the trigger so the behaviour is tested. Future posted tables attach the same function.

Both tables are tenant-scoped with row-level security. The audit row is written in the same transaction as the change it describes, via `appendAuditEvent`.

Retention of five to seven years is a product rule. The database does not delete old audit rows. A purge job would violate GOV-02 and should not be added.

## Consequences

- Tests prove an insert works and that update and delete raise GOV-02.
- Tests prove a draft delete works and a posted delete raises GOV-03, and the posted row is still there.
- Resetting local data is `docker compose down -v`, not a `DELETE FROM audit_events`.
- The before/after payload is JSON. Field-level encryption for special personal information is GOV-04 and is not in this table yet. Do not put ID numbers or bank details in audit JSON until that control exists.
