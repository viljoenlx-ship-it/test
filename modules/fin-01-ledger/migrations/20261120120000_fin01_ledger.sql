-- FIN-01 lite. A chart of accounts and an immutable journal.
-- Money is bigint cents. A journal is posted once and reversed, never edited.
-- Automatic postings from sales and stock use a source key so a retry cannot double-post.

ALTER TABLE o2c_documents
  ADD COLUMN origin text NOT NULL DEFAULT 'trade';

ALTER TABLE o2c_documents
  ADD CONSTRAINT o2c_documents_origin CHECK (origin IN ('trade', 'opening'));

COMMENT ON COLUMN o2c_documents.origin IS
  'trade is a normal tax document. opening is a balance brought in from another system and posts to Opening Balance Equity.';

CREATE TABLE fin01_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (
    category IN ('asset', 'liability', 'equity', 'income', 'cost_of_sales', 'expense')
  ),
  system_key text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin01_accounts_code CHECK (code ~ '^[0-9]{3,8}$'),
  CONSTRAINT fin01_accounts_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT fin01_accounts_system_key CHECK (
    system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{1,40}$'
  )
);

COMMENT ON TABLE fin01_accounts IS
  'Chart of accounts. system_key marks accounts that automatic postings use. Those can be renamed, not deactivated.';

CREATE UNIQUE INDEX fin01_accounts_code_idx ON fin01_accounts (tenant_id, code);
CREATE UNIQUE INDEX fin01_accounts_system_idx
  ON fin01_accounts (tenant_id, system_key)
  WHERE system_key IS NOT NULL;
CREATE INDEX fin01_accounts_tenant_idx ON fin01_accounts (tenant_id, code);

CREATE TABLE fin01_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  last_number integer NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (tenant_id, year)
);

COMMENT ON TABLE fin01_sequences IS
  'Journal numbers for one company and calendar year. Shape JNL-YYYY-00001.';

CREATE TABLE fin01_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  number text NOT NULL,
  journal_date date NOT NULL,
  memo text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (
    source IN ('manual', 'invoice', 'credit_note', 'payment', 'stock', 'opening', 'trial')
  ),
  source_key text NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  reverses_journal_id uuid NULL REFERENCES fin01_journals (id) ON DELETE RESTRICT,
  posted_by uuid NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin01_journals_number CHECK (char_length(number) BETWEEN 4 AND 40),
  CONSTRAINT fin01_journals_memo CHECK (char_length(memo) <= 200)
);

COMMENT ON TABLE fin01_journals IS
  'Posted journals. Rows are reversed, not edited or deleted. source_key stops a repeated automatic posting.';

COMMENT ON COLUMN fin01_journals.journal_date IS
  'The accounting date. Reports use this date, in the company calendar, not the time the row was saved.';

CREATE UNIQUE INDEX fin01_journals_number_idx ON fin01_journals (tenant_id, number);
CREATE UNIQUE INDEX fin01_journals_source_idx ON fin01_journals (tenant_id, source_key);
CREATE INDEX fin01_journals_date_idx ON fin01_journals (tenant_id, journal_date);

CREATE TABLE fin01_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  journal_id uuid NOT NULL REFERENCES fin01_journals (id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES fin01_accounts (id) ON DELETE RESTRICT,
  party_id uuid NULL REFERENCES parties (id) ON DELETE RESTRICT,
  debit_cents bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  memo text NOT NULL DEFAULT '',
  CONSTRAINT fin01_journal_lines_debit CHECK (debit_cents >= 0),
  CONSTRAINT fin01_journal_lines_credit CHECK (credit_cents >= 0),
  CONSTRAINT fin01_journal_lines_one_side CHECK (
    (debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)
  ),
  CONSTRAINT fin01_journal_lines_memo CHECK (char_length(memo) <= 200)
);

COMMENT ON TABLE fin01_journal_lines IS
  'Immutable posted lines. debit_cents and credit_cents are whole cents. A line is one side only.';

CREATE INDEX fin01_journal_lines_journal_idx ON fin01_journal_lines (journal_id);
CREATE INDEX fin01_journal_lines_account_idx ON fin01_journal_lines (account_id);

CREATE TABLE fin01_cost_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  line_id uuid NOT NULL,
  document_id uuid NOT NULL,
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, line_id)
);

COMMENT ON TABLE fin01_cost_snapshots IS
  'Average unit cost used when an invoice posted cost of sales, so a credit note can reverse the same cost.';

CREATE INDEX fin01_cost_snapshots_document_idx ON fin01_cost_snapshots (document_id);

CREATE TABLE fin01_party_codes (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('customer', 'supplier')),
  code text NOT NULL,
  opening_cents bigint NULL,
  opening_on date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, party_id, role),
  CONSTRAINT fin01_party_codes_code CHECK (char_length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT fin01_party_codes_opening CHECK (
    (opening_cents IS NULL AND opening_on IS NULL)
    OR (opening_cents IS NOT NULL AND opening_cents >= 0 AND opening_on IS NOT NULL)
  )
);

COMMENT ON TABLE fin01_party_codes IS
  'The code from a spreadsheet, so the same customer or supplier can be imported again without a duplicate.';

CREATE UNIQUE INDEX fin01_party_codes_lookup
  ON fin01_party_codes (tenant_id, role, lower(code));

CREATE FUNCTION fin01_reject_journal_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A posted journal cannot be changed. Reverse it.'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER fin01_journals_no_update
  BEFORE UPDATE ON fin01_journals
  FOR EACH ROW
  EXECUTE FUNCTION fin01_reject_journal_change();

CREATE TRIGGER fin01_journals_no_delete
  BEFORE DELETE ON fin01_journals
  FOR EACH ROW
  EXECUTE FUNCTION gov_reject_posted_delete();

CREATE FUNCTION fin01_reject_line_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Posted journal lines cannot be changed. Reverse the journal.'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER fin01_journal_lines_append_only
  BEFORE UPDATE OR DELETE ON fin01_journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION fin01_reject_line_change();

CREATE FUNCTION fin01_reject_snapshot_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A stored unit cost cannot be changed.'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER fin01_cost_snapshots_append_only
  BEFORE UPDATE OR DELETE ON fin01_cost_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION fin01_reject_snapshot_change();

CREATE FUNCTION fin01_assert_balanced() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debits bigint;
  credits bigint;
  rows integer;
BEGIN
  SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0), COUNT(*)::integer
    INTO debits, credits, rows
  FROM fin01_journal_lines
  WHERE journal_id = NEW.id;

  IF rows < 2 OR debits <> credits OR debits <= 0 THEN
    RAISE EXCEPTION 'A journal must balance, with the same total on both sides.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER fin01_journals_must_balance
  AFTER INSERT ON fin01_journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fin01_assert_balanced();

ALTER TABLE fin01_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_accounts_isolation ON fin01_accounts
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE fin01_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_sequences_isolation ON fin01_sequences
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE fin01_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_journals FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_journals_isolation ON fin01_journals
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE fin01_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_journal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_journal_lines_isolation ON fin01_journal_lines
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE fin01_cost_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_cost_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_cost_snapshots_isolation ON fin01_cost_snapshots
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE fin01_party_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin01_party_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY fin01_party_codes_isolation ON fin01_party_codes
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON fin01_accounts TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON fin01_sequences TO omnivate_app;
GRANT SELECT, INSERT ON fin01_journals TO omnivate_app;
GRANT SELECT, INSERT ON fin01_journal_lines TO omnivate_app;
GRANT SELECT, INSERT ON fin01_cost_snapshots TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON fin01_party_codes TO omnivate_app;

REVOKE ALL ON FUNCTION fin01_reject_journal_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION fin01_reject_line_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION fin01_reject_snapshot_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION fin01_assert_balanced() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin01_reject_journal_change() TO omnivate_app;
GRANT EXECUTE ON FUNCTION fin01_reject_line_change() TO omnivate_app;
GRANT EXECUTE ON FUNCTION fin01_reject_snapshot_change() TO omnivate_app;
GRANT EXECUTE ON FUNCTION fin01_assert_balanced() TO omnivate_app;
