# ADR 0013: Segregation of duties as tenant rules

## Status

Accepted

## Context

GOV-07 says the same person must not create a supplier or employee and also approve the payout. Those actions do not exist until later modules. The rule still has to be configurable per tenant now, so those modules can plug in without a second mechanism.

## Decision

`sod_rules` stores an ordered pair of action keys (`action_a` < `action_b`), a short description, and an enabled flag. The pair is unique per tenant. Disabling a rule keeps the row.

`assertSegregation` loads enabled rules that mention the action about to happen. If `audit_events` already has the other action on the same `entity_id` by the same `actor_id`, it throws. Modules must audit with the same action key they register. The check runs in the tenant transaction, before the write.

KRN-01 does not seed a supplier or payroll pair. Those modules will add their own. The admin page can add and turn off rules so the mechanism is visible.

## Consequences

- A test can register `fixture.make` and `fixture.check` and prove the maker cannot check that record, while someone else can, and the same person can check a different record.
- A module that forgets to audit, or uses a different action string, will not trip the rule. The contract is the shared action key.
- The specific supplier and employee pairs are intentionally absent until those modules exist.
