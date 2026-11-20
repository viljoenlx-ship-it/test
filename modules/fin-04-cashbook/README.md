# FIN-04 — Cashbook & Bank Reconciliation

Bank accounts, statement imports, transaction matching, split allocations, reconciliation, and cash-flow visibility.

This is a separately deployable Omnivate module. Its database objects use the `fin04_` prefix and tenant-scoped records. The shared schema migration currently lives in `modules/fin-department/migrations/20261120130000_fin03_fin06.sql`; the module packages remain independent at the application/domain layer.

Amounts are integer cents; dates use ISO `YYYY-MM-DD`; persisted posted/locked records are corrected through reversal or later-period adjustment, never silent mutation.
