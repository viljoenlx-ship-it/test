-- Document capture. Original files live in the document store, not in these tables.
-- Extracted amounts stay here so a later supplier bill (phase 1b) can be posted.
-- Stock that is received is an SCM-01 movement. Undo is a reversing movement.
-- Money is bigint cents. There is no DELETE grant on documents.

CREATE TABLE doc_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE doc_settings IS
  'Per-company switch for document capture. Missing row means the feature is on.';

CREATE TABLE doc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (
    status IN ('queued', 'reading', 'ready', 'failed', 'posted', 'reversed')
  ),
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  billed_at timestamptz,
  storage_key text NOT NULL,
  document_type text CHECK (document_type IN ('tax_invoice', 'delivery_note')),
  supplier_name text NOT NULL DEFAULT '',
  supplier_vat text NOT NULL DEFAULT '',
  party_id uuid REFERENCES parties (id) ON DELETE SET NULL,
  supplier_match text NOT NULL DEFAULT 'none' CHECK (supplier_match IN ('vat', 'name', 'chosen', 'none')),
  document_number text NOT NULL DEFAULT '',
  document_date date,
  due_date date,
  currency_code char(3) NOT NULL DEFAULT 'ZAR',
  subtotal_cents bigint,
  vat_cents bigint,
  total_cents bigint,
  field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  branch_id uuid REFERENCES krn03_branches (id) ON DELETE RESTRICT,
  failure_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE doc_documents IS
  'One captured supplier invoice or delivery note. extracted is kept for a later creditor bill.';

COMMENT ON COLUMN doc_documents.extracted IS
  'Validated reader output. Kept so a supplier bill can be posted later. Not written to logs.';

COMMENT ON COLUMN doc_documents.storage_key IS
  'Key inside the tenant folder of the document store. The file bytes are not in this table.';

CREATE INDEX doc_documents_list_idx ON doc_documents (tenant_id, created_at DESC);
CREATE INDEX doc_documents_number_idx ON doc_documents (tenant_id, document_number);

CREATE TABLE doc_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES doc_documents (id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL DEFAULT '',
  supplier_code text NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  unit_price_cents bigint,
  vat_cents bigint,
  line_total_cents bigint,
  item_id uuid REFERENCES scm01_items (id) ON DELETE RESTRICT,
  match_method text NOT NULL DEFAULT 'none' CHECK (
    match_method IN ('supplier_code', 'barcode', 'sku', 'name', 'chosen', 'none')
  ),
  field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, document_id, line_no)
);

COMMENT ON TABLE doc_lines IS
  'Lines read from a supplier document. unit_price_cents is VAT-exclusive.';

CREATE TABLE doc_supplier_codes (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  supplier_code text NOT NULL,
  item_id uuid NOT NULL REFERENCES scm01_items (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, party_id, supplier_code)
);

COMMENT ON TABLE doc_supplier_codes IS
  'Remembers which stock item a supplier code meant, for the next document from that supplier.';

CREATE TABLE doc_receipt_links (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES doc_documents (id) ON DELETE RESTRICT,
  line_id uuid NOT NULL REFERENCES doc_lines (id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES scm01_movements (id) ON DELETE RESTRICT,
  PRIMARY KEY (document_id, line_id)
);

COMMENT ON TABLE doc_receipt_links IS
  'Ties a received line to the SCM-01 receipt. Undo posts a reversing movement. The link stays.';

CREATE INDEX doc_receipt_links_tenant_idx ON doc_receipt_links (tenant_id, document_id);

CREATE TABLE doc_page_usage (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  pages integer NOT NULL CHECK (pages >= 0),
  PRIMARY KEY (tenant_id, period)
);

COMMENT ON TABLE doc_page_usage IS
  'Pages sent to the reader, by calendar month in Africa/Johannesburg. The control panel shows this as Pages Read.';

ALTER TABLE doc_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_settings_isolation ON doc_settings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE doc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_documents_isolation ON doc_documents
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE doc_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_lines_isolation ON doc_lines
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE doc_supplier_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_supplier_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_supplier_codes_isolation ON doc_supplier_codes
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE doc_receipt_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_receipt_links FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_receipt_links_isolation ON doc_receipt_links
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE doc_page_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_page_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_page_usage_isolation ON doc_page_usage
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON doc_settings TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON doc_documents TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_lines TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_supplier_codes TO omnivate_app;
GRANT SELECT, INSERT ON doc_receipt_links TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON doc_page_usage TO omnivate_app;
