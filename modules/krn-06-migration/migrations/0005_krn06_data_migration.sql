-- KRN-06 Data Migration & No-Lock-In Engine.
-- Import batches, remembered column maps, and a provisional store for contacts
-- and stock until KRN-02 and SCM-01 own those records. See WIRING.md.
-- Undo archives rows and posts reversing stock movements. It never hard-deletes.

CREATE TABLE krn06_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  target_id text NOT NULL,
  file_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('preview', 'running', 'completed', 'undone')),
  duplicate_policy text NOT NULL CHECK (duplicate_policy IN ('skip', 'update')),
  vat_treatment text NOT NULL CHECK (vat_treatment IN ('inclusive', 'exclusive', 'not_applicable')),
  vat_rate_basis_points integer NOT NULL,
  headers jsonb NOT NULL,
  column_map jsonb NOT NULL,
  actor_id uuid NULL,
  operator_id uuid NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  undone_at timestamptz NULL
);

COMMENT ON TABLE krn06_import_batches IS
  'One spreadsheet import. Counts live on the rows so a retry can resume the same batch.';

CREATE INDEX krn06_import_batches_tenant_idx ON krn06_import_batches (tenant_id, created_at DESC);

CREATE TABLE krn06_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES krn06_import_batches (id) ON DELETE RESTRICT,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  values jsonb NOT NULL,
  status text NOT NULL CHECK (status IN (
    'ready', 'invalid', 'duplicate', 'created', 'updated', 'skipped', 'failed', 'undone'
  )),
  messages jsonb NOT NULL,
  existing_id uuid NULL,
  existing_label text NULL,
  record_id uuid NULL,
  generation_after integer NULL,
  movement_count_after integer NULL,
  before_data jsonb NULL,
  delta_quantity_milli bigint NOT NULL DEFAULT 0,
  delta_value_cents bigint NOT NULL DEFAULT 0,
  UNIQUE (batch_id, row_number)
);

COMMENT ON TABLE krn06_import_rows IS
  'One spreadsheet row. row_number matches the file, including the header as row 1.';

CREATE INDEX krn06_import_rows_batch_idx ON krn06_import_rows (batch_id, status, row_number);

CREATE TABLE krn06_saved_mappings (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  target_id text NOT NULL,
  source_header text NOT NULL,
  field_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, target_id, source_header)
);

COMMENT ON TABLE krn06_saved_mappings IS
  'Column match remembered for this company and import type. source_header is normalised.';

-- Provisional party rows. KRN-02 replaces this table. See WIRING.md.
CREATE TABLE krn06_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  legal_name text NULL,
  kind text NOT NULL CHECK (kind IN ('customer', 'supplier', 'both', 'other')),
  email text NULL,
  phone text NULL,
  vat_number text NULL,
  address_line text NULL,
  city text NULL,
  postal_code text NULL,
  notes text NULL,
  started_on date NULL,
  archived_at timestamptz NULL,
  generation integer NOT NULL DEFAULT 1,
  last_batch_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE krn06_parties IS
  'Stand-in for the KRN-02 party directory. Archived, never hard-deleted by the product.';

CREATE UNIQUE INDEX krn06_parties_email_uidx
  ON krn06_parties (tenant_id, email)
  WHERE email IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX krn06_parties_vat_uidx
  ON krn06_parties (tenant_id, vat_number)
  WHERE vat_number IS NOT NULL AND archived_at IS NULL;

CREATE INDEX krn06_parties_tenant_idx ON krn06_parties (tenant_id);

-- Provisional catalog. SCM-01 replaces these two tables. See WIRING.md.
CREATE TABLE krn06_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  description text NULL,
  cost_cents bigint NOT NULL,
  quantity_milli bigint NOT NULL,
  archived_at timestamptz NULL,
  generation integer NOT NULL DEFAULT 1,
  last_batch_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN krn06_items.cost_cents IS
  'Unit cost in integer cents, exclusive of VAT. Never a float.';

COMMENT ON COLUMN krn06_items.quantity_milli IS
  'On-hand quantity in thousandths of the unit. 1.5 is 1500. Never a float.';

CREATE UNIQUE INDEX krn06_items_sku_uidx
  ON krn06_items (tenant_id, lower(sku))
  WHERE archived_at IS NULL;

CREATE INDEX krn06_items_tenant_idx ON krn06_items (tenant_id);

CREATE TABLE krn06_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES krn06_items (id) ON DELETE RESTRICT,
  batch_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('opening', 'adjustment', 'reversal')),
  quantity_milli bigint NOT NULL,
  value_cents bigint NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'ZAR',
  status text NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  posted_at timestamptz NOT NULL DEFAULT now(),
  reverses_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE krn06_stock_movements IS
  'Posted inventory ledger. Opening stock is reversed with a new row, never deleted or edited.';

CREATE INDEX krn06_stock_movements_item_idx ON krn06_stock_movements (item_id);

CREATE FUNCTION krn06_reject_movement_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'GOV-03: posted stock movements cannot be changed; post a reversal instead'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER krn06_stock_movements_immutable
  BEFORE UPDATE ON krn06_stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION krn06_reject_movement_update();

CREATE TRIGGER krn06_stock_movements_no_hard_delete
  BEFORE DELETE ON krn06_stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION gov_reject_posted_delete();

ALTER TABLE krn06_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_import_batches_isolation ON krn06_import_batches
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn06_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_import_rows_isolation ON krn06_import_rows
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn06_saved_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_saved_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_saved_mappings_isolation ON krn06_saved_mappings
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn06_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_parties_isolation ON krn06_parties
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn06_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_items FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_items_isolation ON krn06_items
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE krn06_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE krn06_stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY krn06_stock_movements_isolation ON krn06_stock_movements
  FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON krn06_import_batches TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn06_import_rows TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn06_saved_mappings TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn06_parties TO omnivate_app;
GRANT SELECT, INSERT, UPDATE ON krn06_items TO omnivate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON krn06_stock_movements TO omnivate_app;
