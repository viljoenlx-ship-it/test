# FIN-03 — Creditors (Accounts Payable)

Supplier bills, debit notes, payment allocations, payment batches, remittance advice, and three-way matching.

This is a separately deployable Omnivate module. Its database objects use the `fin03_` prefix and tenant-scoped records. The shared schema migration currently lives in `modules/fin-department/migrations/20261120130000_fin03_fin06.sql`; the module packages remain independent at the application/domain layer.

Amounts are integer cents; dates use ISO `YYYY-MM-DD`; persisted posted/locked records are corrected through reversal or later-period adjustment, never silent mutation.
