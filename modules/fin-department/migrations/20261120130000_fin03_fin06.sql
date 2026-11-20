-- FIN-03..FIN-06 shared finance sub-ledger foundation.
-- All money is integer cents. Tenant isolation is enforced in PostgreSQL.
-- Posted financial records are append-only; corrections use reversals/adjustments.

-- FIN-03: Accounts payable
CREATE TABLE fin03_supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  supplier_reference text NOT NULL,
  document_number text NOT NULL,
  bill_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ZAR',
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  ledger_journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  source_document_id uuid NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid NULL,
  posted_by uuid NULL,
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= bill_date),
  CHECK (total_cents = subtotal_cents + vat_cents),
  CHECK (char_length(btrim(document_number)) BETWEEN 1 AND 80),
  UNIQUE (tenant_id, supplier_id, document_number)
);
CREATE INDEX fin03_bills_due_idx ON fin03_supplier_bills(tenant_id, status, due_date);
CREATE INDEX fin03_bills_supplier_idx ON fin03_supplier_bills(tenant_id, supplier_id, bill_date DESC);

CREATE TABLE fin03_supplier_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL REFERENCES fin03_supplier_bills(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 240),
  account_id uuid NOT NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  quantity_milli bigint NOT NULL CHECK (quantity_milli > 0),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fin03_bill_lines_bill_idx ON fin03_supplier_bill_lines(tenant_id, bill_id);

CREATE TABLE fin03_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  reference text NOT NULL DEFAULT '',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  bank_account_id uuid NULL,
  journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fin03_supplier_payments_party_idx ON fin03_supplier_payments(tenant_id, supplier_id, payment_date DESC);
CREATE TABLE fin03_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES fin03_supplier_payments(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL REFERENCES fin03_supplier_bills(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_id, bill_id)
);
CREATE INDEX fin03_alloc_bill_idx ON fin03_payment_allocations(tenant_id, bill_id);

-- FIN-04: Bank accounts, imported statement lines, matching and reconciliation.
CREATE TABLE fin04_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  bank_name text NOT NULL DEFAULT '',
  masked_account_number text NOT NULL DEFAULT '',
  currency char(3) NOT NULL DEFAULT 'ZAR',
  gl_account_id uuid NOT NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  opening_balance_cents bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE fin04_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL REFERENCES fin04_bank_accounts(id) ON DELETE RESTRICT,
  file_name text NOT NULL DEFAULT '',
  file_sha256 char(64) NOT NULL,
  statement_from date NULL,
  statement_to date NULL,
  imported_by uuid NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, file_sha256),
  CHECK (statement_to IS NULL OR statement_from IS NULL OR statement_to >= statement_from)
);
CREATE TABLE fin04_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  import_id uuid NULL REFERENCES fin04_statement_imports(id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL REFERENCES fin04_bank_accounts(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL,
  value_date date NULL,
  description text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  external_id text NULL,
  matched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, external_id)
);
CREATE INDEX fin04_bank_txn_unmatched_idx ON fin04_bank_transactions(tenant_id, bank_account_id, transaction_date) WHERE matched = false;
CREATE TABLE fin04_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL REFERENCES fin04_bank_accounts(id) ON DELETE RESTRICT,
  statement_date date NOT NULL,
  statement_closing_cents bigint NOT NULL,
  book_closing_cents bigint NOT NULL,
  difference_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  completed_by uuid NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, statement_date)
);
CREATE TABLE fin04_reconciliation_matches (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL REFERENCES fin04_reconciliations(id) ON DELETE RESTRICT,
  bank_transaction_id uuid NOT NULL REFERENCES fin04_bank_transactions(id) ON DELETE RESTRICT,
  journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  matched_amount_cents bigint NOT NULL CHECK (matched_amount_cents <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, reconciliation_id, bank_transaction_id)
);

-- FIN-05: Cash floats, petty cash movements, and staff expense claims.
CREATE TABLE fin05_cash_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  branch_id uuid NULL REFERENCES branches(id) ON DELETE RESTRICT,
  custodian_party_id uuid NULL REFERENCES parties(id) ON DELETE RESTRICT,
  gl_account_id uuid NOT NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  float_limit_cents bigint NOT NULL CHECK (float_limit_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE fin05_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES fin05_cash_funds(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  category text NOT NULL CHECK (category IN ('float_topup','purchase','refund','cash_return','correction')),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 240),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  vat_cents bigint NOT NULL DEFAULT 0 CHECK (vat_cents >= 0 AND vat_cents <= amount_cents),
  receipt_reference text NOT NULL DEFAULT '',
  journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fin05_cash_txn_fund_idx ON fin05_cash_transactions(tenant_id, fund_id, transaction_date DESC);
CREATE TABLE fin05_expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claimant_party_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  claim_number text NOT NULL,
  claim_date date NOT NULL,
  purpose text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 240),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','paid')),
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  paid_at timestamptz NULL,
  journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  payment_journal_id uuid NULL REFERENCES fin01_journals(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = net_cents + vat_cents),
  UNIQUE (tenant_id, claim_number)
);
CREATE TABLE fin05_expense_claim_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL REFERENCES fin05_expense_claims(id) ON DELETE RESTRICT,
  expense_account_id uuid NOT NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 240),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  receipt_file_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FIN-06: VAT control, tax-period snapshots and immutable VAT201 filing record.
CREATE TABLE fin06_tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  label text NOT NULL,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  treatment text NOT NULL CHECK (treatment IN ('standard','zero','exempt','out_of_scope','capital_goods')),
  input_account_id uuid NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  output_account_id uuid NULL REFERENCES fin01_accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);
CREATE TABLE fin06_vat_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_code text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','prepared','filed','locked')),
  prepared_by uuid NULL,
  prepared_at timestamptz NULL,
  filed_by uuid NULL,
  filed_at timestamptz NULL,
  filing_reference text NOT NULL DEFAULT '',
  output_vat_cents bigint NOT NULL DEFAULT 0,
  input_vat_cents bigint NOT NULL DEFAULT 0,
  net_vat_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (net_vat_cents = output_vat_cents - input_vat_cents),
  UNIQUE (tenant_id, period_code),
  UNIQUE (tenant_id, starts_on, ends_on)
);
CREATE TABLE fin06_vat_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES fin06_vat_periods(id) ON DELETE RESTRICT,
  source_module text NOT NULL CHECK (source_module IN ('FIN-02','FIN-03','FIN-05','MANUAL')),
  source_id uuid NOT NULL,
  source_line_id uuid NULL,
  transaction_date date NOT NULL,
  tax_code_id uuid NOT NULL REFERENCES fin06_tax_codes(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('input','output')),
  taxable_cents bigint NOT NULL CHECK (taxable_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_module, source_id, source_line_id, direction)
);
CREATE INDEX fin06_vat_txn_period_idx ON fin06_vat_transactions(tenant_id, period_id, direction);

-- Common tenant RLS. FORCE prevents accidental owner-context reads by app role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fin03_supplier_bills','fin03_supplier_bill_lines','fin03_supplier_payments','fin03_payment_allocations',
    'fin04_bank_accounts','fin04_statement_imports','fin04_bank_transactions','fin04_reconciliations','fin04_reconciliation_matches',
    'fin05_cash_funds','fin05_cash_transactions','fin05_expense_claims','fin05_expense_claim_lines',
    'fin06_tax_codes','fin06_vat_periods','fin06_vat_transactions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- Posted supplier bills and completed reconciliations cannot be silently edited.
CREATE FUNCTION fin03_guard_posted_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'A posted supplier bill is immutable; issue a supplier credit note.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin03_bill_posted_immutable BEFORE UPDATE ON fin03_supplier_bills
  FOR EACH ROW EXECUTE FUNCTION fin03_guard_posted_bill();
CREATE TRIGGER fin03_bill_no_delete BEFORE DELETE ON fin03_supplier_bills
  FOR EACH ROW EXECUTE FUNCTION gov_reject_posted_delete();

CREATE FUNCTION fin04_guard_completed_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed bank reconciliation is immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin04_reconciliation_immutable BEFORE UPDATE OR DELETE ON fin04_reconciliations
  FOR EACH ROW EXECUTE FUNCTION fin04_guard_completed_reconciliation();

CREATE FUNCTION fin06_guard_filed_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'A locked VAT period is immutable; use an adjustment in a later period.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'filed' AND (NEW.status <> 'locked' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')) THEN
    RAISE EXCEPTION 'A filed VAT period may only transition to locked; use an adjustment in a later period.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin06_period_immutable BEFORE UPDATE OR DELETE ON fin06_vat_periods
  FOR EACH ROW EXECUTE FUNCTION fin06_guard_filed_period();
CREATE FUNCTION fin06_guard_filed_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_status text;
BEGIN
  SELECT status INTO p_status FROM fin06_vat_periods WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  IF p_status IN ('filed','locked') THEN
    RAISE EXCEPTION 'VAT transactions in a filed period are immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER fin06_vat_txn_immutable BEFORE UPDATE OR DELETE ON fin06_vat_transactions
  FOR EACH ROW EXECUTE FUNCTION fin06_guard_filed_transaction();
