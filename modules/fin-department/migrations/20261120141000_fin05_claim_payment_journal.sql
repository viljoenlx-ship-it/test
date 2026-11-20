-- Keep both the expense accrual journal and reimbursement journal on the claim.
ALTER TABLE fin05_expense_claims
  ADD COLUMN IF NOT EXISTS payment_journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT;
