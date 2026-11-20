-- SAL-01 quotes and FIN-02 debtors (tax invoices, credit notes, receipts).
-- One header and line shape, the commercial document engine (ABS-03).
-- Money is bigint cents. Quantity is numeric and is also checked in the app
-- as an exact scaled integer. Issued tax documents are final. Corrections
-- are credit notes. Nothing in this module is hard-deleted.

CREATE TABLE o2c_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE RESTRICT,
  bank_name text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  branch_code text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE o2c_settings IS
  'Banking details printed on quotes, tax invoices, and credit notes. CFG-10 branding stays on the tenant.';

CREATE TABLE o2c_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  doc_kind text NOT NULL CHECK (doc_kind IN ('quote', 'invoice', 'credit_note')),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  last_number integer NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (tenant_id, doc_kind, year)
);

COMMENT ON TABLE o2c_sequences IS
  'Per-tenant document numbers. CFG-05 shape is PREFIX-YYYY-00001. A rolled-back issue does not consume a number.';

CREATE TABLE o2c_customer_terms (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE RESTRICT,
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, party_id)
);

COMMENT ON TABLE o2c_customer_terms IS
  'Days until a tax invoice is due. The customer itself is a KRN-02 party with the customer role.';

CREATE TABLE o2c_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('quote', 'invoice', 'credit_note')),
  status text NOT NULL,
  number text,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  customer_vat text NOT NULL DEFAULT '',
  customer_address text NOT NULL DEFAULT '',
  customer_contact text NOT NULL DEFAULT '',
  issued_on date,
  due_on date,
  valid_until date,
  vat_rate_basis_points integer NOT NULL CHECK (vat_rate_basis_points >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  notes text NOT NULL DEFAULT '',
  quote_id uuid REFERENCES o2c_documents (id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES o2c_documents (id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  deduct_stock boolean NOT NULL DEFAULT false,
  created_by uuid,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT o2c_documents_status CHECK (
    (kind = 'quote' AND status IN ('draft', 'sent', 'accepted', 'declined'))
    OR (kind IN ('invoice', 'credit_note') AND status IN ('draft', 'issued'))
  ),
  CONSTRAINT o2c_documents_number CHECK (
    (kind = 'quote' AND number IS NOT NULL)
    OR (kind IN ('invoice', 'credit_note') AND (
      (status = 'draft' AND number IS NULL AND issued_at IS NULL)
      OR (status = 'issued' AND number IS NOT NULL AND issued_on IS NOT NULL AND issued_at IS NOT NULL)
    ))
  )
);

COMMENT ON TABLE o2c_documents IS
  'SAL-01 quotes and FIN-02 tax invoices and credit notes. Issued rows are immutable. Drafts are edited in place.';

COMMENT ON COLUMN o2c_documents.number IS
  'Sequential per tenant and year. Invoice numbers are assigned only when the tax invoice is issued.';

CREATE UNIQUE INDEX o2c_documents_number_idx
  ON o2c_documents (tenant_id, kind, number)
  WHERE number IS NOT NULL;

CREATE UNIQUE INDEX o2c_documents_quote_once
  ON o2c_documents (quote_id)
  WHERE quote_id IS NOT NULL AND kind = 'invoice';

CREATE INDEX o2c_documents_party_idx ON o2c_documents (tenant_id, party_id, kind);
CREATE INDEX o2c_documents_invoice_idx ON o2c_documents (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE o2c_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES o2c_documents (id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  item_id uuid REFERENCES scm01_items (id) ON DELETE RESTRICT,
  source_line_id uuid REFERENCES o2c_lines (id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents bigint NOT NULL CHECK (discount_cents >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  archived_at timestamptz,
  CONSTRAINT o2c_lines_description CHECK (char_length(btrim(description)) BETWEEN 1 AND 200)
);

COMMENT ON TABLE o2c_lines IS
  'Document lines. A replaced draft line is archived, not deleted. Catalog lines point at SCM-01.';

CREATE INDEX o2c_lines_document_idx ON o2c_lines (document_id, position);

CREATE TABLE o2c_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE RESTRICT,
  paid_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('eft', 'cash', 'card')),
  reference text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE o2c_payments IS
  'A customer receipt. Append-only. It is allocated to one or more tax invoices, and a partial allocation is allowed.';

CREATE INDEX o2c_payments_party_idx ON o2c_payments (tenant_id, party_id, paid_on);

CREATE TABLE o2c_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES o2c_payments (id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES o2c_documents (id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

COMMENT ON TABLE o2c_allocations IS
  'How much of a receipt settles each tax invoice. Append-only. The sum cannot exceed the receipt or the open balance.';

CREATE INDEX o2c_allocations_invoice_idx ON o2c_allocations (invoice_id);

CREATE TABLE o2c_stock_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES o2c_documents (id) ON DELETE RESTRICT,
  line_id uuid NOT NULL REFERENCES o2c_lines (id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE o2c_stock_links IS
  'Catalog lines whose stock was issued on the SCM-01 ledger when the tax invoice was issued.';

CREATE FUNCTION o2c_reject_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sales records are kept. They are not deleted.'
    USING ERRCODE = '42501';
END;
$$;

CREATE FUNCTION o2c_guard_document() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.kind IN ('invoice', 'credit_note') AND OLD.status = 'issued' THEN
    RAISE EXCEPTION 'An issued tax document cannot be changed. Raise a credit note.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.kind = 'quote' AND OLD.status <> 'draft' THEN
    IF NEW.party_id IS DISTINCT FROM OLD.party_id
      OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
      OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
      OR NEW.vat_cents IS DISTINCT FROM OLD.vat_cents
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW.kind IS DISTINCT FROM OLD.kind
    THEN
      RAISE EXCEPTION 'A quote can only be edited while it is a draft.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION o2c_guard_line_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locked boolean;
BEGIN
  SELECT
    (d.kind IN ('invoice', 'credit_note') AND d.status = 'issued')
    OR (d.kind = 'quote' AND d.status <> 'draft')
  INTO locked
  FROM o2c_documents AS d
  WHERE d.id = NEW.document_id;

  IF locked THEN
    RAISE EXCEPTION 'Lines cannot be added to a finished document.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION o2c_guard_line() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locked boolean;
BEGIN
  SELECT
    (d.kind IN ('invoice', 'credit_note') AND d.status = 'issued')
    OR (d.kind = 'quote' AND d.status <> 'draft')
  INTO locked
  FROM o2c_documents AS d
  WHERE d.id = OLD.document_id;

  IF locked THEN
    RAISE EXCEPTION 'Lines on a finished document cannot be changed.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION o2c_reject_money_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Receipts and allocations are append-only.'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER o2c_documents_no_delete
  BEFORE DELETE ON o2c_documents
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_delete();

CREATE TRIGGER o2c_documents_guard
  BEFORE UPDATE ON o2c_documents
  FOR EACH ROW EXECUTE FUNCTION o2c_guard_document();

CREATE TRIGGER o2c_lines_no_delete
  BEFORE DELETE ON o2c_lines
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_delete();

CREATE TRIGGER o2c_lines_insert_guard
  BEFORE INSERT ON o2c_lines
  FOR EACH ROW EXECUTE FUNCTION o2c_guard_line_insert();

CREATE TRIGGER o2c_lines_guard
  BEFORE UPDATE ON o2c_lines
  FOR EACH ROW EXECUTE FUNCTION o2c_guard_line();

CREATE TRIGGER o2c_payments_append_only
  BEFORE UPDATE OR DELETE ON o2c_payments
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_money_change();

CREATE TRIGGER o2c_allocations_append_only
  BEFORE UPDATE OR DELETE ON o2c_allocations
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_money_change();

CREATE TRIGGER o2c_stock_links_no_delete
  BEFORE DELETE ON o2c_stock_links
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_delete();

CREATE TRIGGER o2c_terms_no_delete
  BEFORE DELETE ON o2c_customer_terms
  FOR EACH ROW EXECUTE FUNCTION o2c_reject_delete();

ALTER TABLE o2c_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_settings_isolation ON o2c_settings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_sequences_isolation ON o2c_sequences
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_customer_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_customer_terms FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_customer_terms_isolation ON o2c_customer_terms
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_documents_isolation ON o2c_documents
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_lines_isolation ON o2c_lines
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_payments_isolation ON o2c_payments
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_allocations_isolation ON o2c_allocations
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE o2c_stock_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE o2c_stock_links FORCE ROW LEVEL SECURITY;
CREATE POLICY o2c_stock_links_isolation ON o2c_stock_links
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON o2c_settings TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON o2c_sequences TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON o2c_customer_terms TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON o2c_documents TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON o2c_lines TO omnivate_app;
GRANT SELECT, INSERT ON o2c_payments TO omnivate_app;
GRANT SELECT, INSERT ON o2c_allocations TO omnivate_app;
GRANT SELECT, INSERT ON o2c_stock_links TO omnivate_app;
