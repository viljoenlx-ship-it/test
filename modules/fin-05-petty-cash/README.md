# FIN-05 — Petty Cash & Expense Claims

Petty cash funds, till floats, cash movements, staff expense claims, approvals, and reimbursements.

This is a separately deployable Omnivate module. Its database objects use the `fin05_` prefix and tenant-scoped records. The shared schema migration currently lives in `modules/fin-department/migrations/20261120130000_fin03_fin06.sql`; the module packages remain independent at the application/domain layer.

Amounts are integer cents; dates use ISO `YYYY-MM-DD`; persisted posted/locked records are corrected through reversal or later-period adjustment, never silent mutation.
